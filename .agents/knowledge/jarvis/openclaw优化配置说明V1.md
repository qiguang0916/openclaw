# OpenClaw 优化配置说明文档 V1

> 文档版本：V1  
> 创建日期：2026-04-13  
> 适用部署：本地 OpenClaw 部署（`/Users/qiguang/openclaw`）

---

## 1. 文档说明

本文档记录截至 2026-04-13 在 OpenClaw 本地部署上所做的所有重要优化与配置调整，涵盖：

- 控制台 UI 修复
- 记忆系统架构优化
- 测试基础设施优化
- 配置体系优化
- 代理（Agent）职责优化

---

## 2. 控制台 UI 优化

### 2.1 流式输出闪烁 Bug 修复（核心修复）

**问题描述**：在控制台会话中，模型返回内容经常展现几个文字后自动消失，过一会又展现几个字后又消失，循环出现（text flicker）。

**根本原因分析**：

```
sessions.changed 事件（工具调用期间频繁触发）
        ↓
loadSessions() 异步请求 sessions.list API
        ↓
clearStaleTerminalChatState() 检查 session 状态
        ↓
session.status 瞬间报告 non-running（工具执行间隙的短暂状态）
        ↓
chatRunId = null / chatStream = null（错误清空）
        ↓
流式文本消失 → 工具调用完成 → 下一轮流式开始 → 再次消失
```

**Bug 触发链**：

- 多工具调用 agentic 任务中，工具执行间隙 session 状态会短暂变为 non-running
- `clearStaleTerminalChatState` 错误将此解读为"会话已结束"
- 导致 `chatStream` 被清为 null，已展示的流式文本消失

**修复方案**：

文件：`ui/src/ui/controllers/sessions.ts`

在 `clearStaleTerminalChatState` 函数中增加流式保护 guard：

```typescript
// 修复前：session status 非 running 就立即清理
if (currentSession.status === "running") {
  return;
}
state.chatRunId = null;
// ... 清空 chatStream 等

// 修复后：增加流式保护
if (currentSession.status === "running") {
  return;
}
// Guard: chatStream 是 string（包括 ""）说明流式正在进行中
// session status 在工具执行间隙会短暂报 non-running，不应触发清理
// 正常结束由 chat final/aborted/error 事件负责；stale 兜底由 watchdog（30s 后）负责
if ("chatStream" in state && typeof state.chatStream === "string") {
  return;
}
state.chatRunId = null;
// ... 安全清空
```

**修复关键点**：

- `chatStream` 的类型语义：`null` = 未在流式，`""` = 流式已开始等待首个 delta，`"text"` = 流式进行中
- `typeof chatStream === "string"` 能准确覆盖所有流式进行中状态
- 若 final 事件丢失，由 stale watchdog（30 秒后）兜底清理，是可接受的折中

**验证方式**：

1. 刷新浏览器加载新 bundle
2. 启动使用多工具调用的 agentic 任务
3. 确认流式文本不再在工具调用间隙消失

**部署方式**：修复后需运行 `pnpm build:reload`（等同于 `pnpm build && openclaw gateway restart`）重建 bundle 并重启网关。

---

## 3. 记忆系统架构优化

### 3.1 从 memory-core 迁移到 MemPalace（主线统一）

**问题**：系统存在多个并行记忆路径（MEMORY.md、daily notes、MemPalace MCP、session-memory hook），导致：

- 用户不知道"到底记到哪里"
- Agent 不知道"到底应该查哪条线"
- 维护者不知道"当前主链到底是哪条"
- 新旧记忆可能双写造成分叉

**优化方案**：统一到 MemPalace 作为单一主记忆底座

**关键变更**：

```json
// ~/.openclaw/openclaw.json 核心配置变更
{
  "plugins": {
    "slots": {
      "memory": "mempalace-memory" // 从 "memory-core" 切换
    }
  },
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": false // 禁用 legacy memory-core 配置通道
      }
    }
  }
}
```

**效果**：

- `memory_search` 主路径 → MemPalace
- `memory_get` 主路径 → MemPalace
- pre-compaction memory flush → MemPalace
- `session-memory` hook → MemPalace-first（失败时 fallback 到文件）
- dreaming → MemPalace-native

### 3.2 Dreaming 系统优化

**问题**：原有 dreaming 与 memory-core 紧密耦合，无法支持 MemPalace 三层输出。

**优化**：实现 MemPalace-native dreaming，支持三层输出：

| dreaming 类型  | 输出目标        | 作用               |
| -------------- | --------------- | ------------------ |
| light dreaming | Diary           | 压缩会话连续性信息 |
| REM dreaming   | Drawer          | 生成合成关联证据   |
| deep dreaming  | Knowledge Graph | 强化持久化事实     |

**新增能力**：

- `dream status`：查看 dreaming 配置 + 最近摘要
- `dream run`：执行一轮完整 dreaming
- `dream verify`：seed recall → run → 回显验证

### 3.3 Session-Memory Hook 优化

**优化**：将 session-memory hook 改为 MemPalace-first

```
/new 或 /reset → 生成 session 摘要 → saveSessionMemoryToMempalace()
                                    ↓（失败时）
                               fallback 到 workspace memory/*.md
```

**效果**：会话摘要优先写入 MemPalace Drawer，确保跨会话语义搜索可达。

### 3.4 Synthetic Path 系统

**问题**：`memory_get` 原先依赖搜索缓存，无法跨会话精确读取。

**优化**：引入自描述 synthetic path 格式：

- `mempalace/private/drawer/<id>`
- `mempalace/shared/kg/<entity>`

**效果**：跨会话也可按 path 回源读取，search 结果与 get 内容完全可追溯。

### 3.5 KG 路径迁移兼容性

**问题**：MemPalace KG 路径从 `~/.mempalace/knowledge_graph.sqlite3` 迁移到 `~/.mempalace-data/knowledge_graph.sqlite3`，需要平滑过渡。

**优化**：在 `config.ts` 中增加自动软链接机制：

- 若旧路径存在，新路径不存在：自动创建软链接
- 若新路径已存在：检查大小，必要时重建软链接
- 若均不存在：使用新路径（新安装）

---

## 4. 测试基础设施优化

### 4.1 mempalace-memory 纳入默认测试门禁

**问题**：`vitest.extension-memory-paths.mjs` 未包含 `extensions/mempalace-memory`，主记忆实现出现回归时默认门禁无感知。

**修复**：将 `extensions/mempalace-memory` 加入 `vitest.extension-memory-paths.mjs`

**效果**：主记忆系统纳入默认专项测试入口，防止主线失守。

### 4.2 dreaming-phases 日期敏感性修复

**问题**：`memory-core` dreaming phases 测试依赖"当前真实日期"，导致测试结果不稳定。

**修复**：

- `extensions/memory-core/src/dreaming-phases.ts`
- `extensions/memory-core/src/dreaming-phases.test.ts`

**效果**：测试从 4 个失败恢复为 8 个全部通过，测试不再受日期影响。

### 4.3 doctor-memory-search 测试修复

**问题**：`doctor-memory-search.test.ts` 中 QMD mock 路径、auto provider metadata、recall doctor mock 互相串扰，导致 5 个测试失败。

**修复**：`src/commands/doctor-memory-search.test.ts`

**效果**：21 个测试全部通过，doctor 误报/漏报问题消除。

### 4.4 dreaming-command 测试挂起修复

**问题**：`mempalace-memory/src/dreaming-command.test.ts` 在 memory extension lane 下长时间挂起并占用测试锁。

**修复**：

- `extensions/mempalace-memory/src/dreaming-command.ts`
- `extensions/mempalace-memory/src/dreaming-command.test.ts`
- `extensions/mempalace-memory/index.ts`

**效果**：测试不再挂起，能在 extension-memory lane 下快速通过。

### 4.5 测试模块拆分优化

**问题**：`mempalace-memory` dreaming/flush/CLI dreaming 测试依赖过重，导致测试速度慢且脆弱。

**修复**：

| 拆分产物                  | 原始文件      | 作用                         |
| ------------------------- | ------------- | ---------------------------- |
| `dreaming-helpers.ts`     | `dreaming.ts` | 纯辅助函数，方便独立测试     |
| `cli-dreaming.ts`         | `cli.ts`      | CLI dreaming helper 独立文件 |
| `cli-dreaming.runtime.ts` | `cli.ts`      | 窄 runtime seam，便于 mock   |

**效果**：`extensions/mempalace-memory` 8 个测试文件 24 个测试全部通过。

### 4.6 统一回归脚本

**新增**：`scripts/mempalace-memory-regression.sh`

覆盖 5 个核心步骤：status/search/get/dream run/dream status

**新增**：`pnpm test:memory:regression` 快速脚本入口

覆盖三类关键回归：

1. `memory-core` dreaming 强化
2. `memory-wiki` doctor 退出码
3. `doctor` 在活动记忆槽位切换下的行为

---

## 5. 配置体系优化

### 5.1 Agent 隔离配置

**优化**：为各 Agent 配置独立的私有 palace，防止内存污染：

```json
{
  "plugins": {
    "entries": {
      "mempalace-memory": {
        "config": {
          "defaultPrivateRoot": "~/.mempalace/openclaw/agents",
          "sharedReadAgents": ["openclaw-optimizer", "jarvis-*"],
          "sharedWriteAgents": ["openclaw-optimizer", "jarvis-memory"],
          "perAgent": {
            "openclaw-optimizer": {
              "readShared": true,
              "writeShared": true
            }
          }
        }
      }
    }
  }
}
```

### 5.2 Dreaming 调度配置

**当前配置**（openclaw-optimizer）：

```
Enabled: on
Cron: 0 3 * * *（每天凌晨 3 点）
Lookback: 7 day(s)
Limit: 6
kgThemes: 3
```

**说明**：

- `limit: 6` = 每轮最多处理 6 条 recall 事件
- `kgThemes: 3` = deep dreaming 最多生成 3 个 KG 主题
- `lookbackDays: 7` = 回顾最近 7 天的 recall 事件

### 5.3 Continuity Cue Budget

**配置**：`continuityCueBudget: 2`（默认值）

**含义**：触发连续性召回时，最多进行 2 次轻量 recall 尝试，超过则升级给 jarvis-memory 处理。

**作用**：控制每轮对话的记忆检索 token 开销，防止无效多轮检索。

### 5.4 MCP Timeout 配置

**配置**：`timeoutMs: 10000`（10 秒）

**说明**：MemPalace Python 进程 MCP 工具调用超时。若 palace 数据量大或硬件较慢，可适当提高。

---

## 6. Agent 配置优化

### 6.1 记忆职责分工优化

**优化前**：所有 Agent 均依赖 legacy `memorySearch.extraPaths`，文件型记忆为主。

**优化后**：

| Agent               | 职责                             | 工具白名单                                          |
| ------------------- | -------------------------------- | --------------------------------------------------- |
| openclaw-optimizer  | 主 Jarvis，连续性召回 + 轻量写入 | memory_search、memory_get、mempalace\_\_\* 基础工具 |
| jarvis-memory       | 记忆写入专员，去重+持久化        | 完整 mempalace\_\_\* 工具集                         |
| jarvis-memory-admin | 记忆维护管理员，图结构维护       | 广泛读写 mempalace\_\_\* 工具                       |

### 6.2 Auto-write 策略优化

**写入原则**（只有以下内容才自动写入）：

- 稳定用户偏好
- 持久规则
- 长期项目事实
- 反复出现的关系事实
- 重要决策

**不写入**：

- 闲聊
- 一次性琐事
- 临时规划噪声

### 6.3 检索触发策略优化

**触发检索的关键词**（continuity cue）：

- 中文：之前、上次、还记得、按以前、我喜欢、我说过、我们定过
- 英文：history、preference、remember、timeline

**检索级联**（三步预算）：

1. 便宜本地查询（一次 KG 或 drawer 搜索）
2. 一次重试（换查询词）
3. 必要时升级给 jarvis-memory

**不触发**：普通聊天不触发检索，节省 token。

---

## 7. 构建与部署优化

### 7.1 build:reload 命令

```bash
pnpm build:reload
# 等同于：pnpm build && openclaw gateway restart
```

**用途**：修改 UI 代码后，重建 bundle 并重启网关，使新代码生效。

**注意**：bundle 文件名包含内容 hash（如 `server-Bg2QWqXF.js`），必须重启网关才能加载新 bundle。

### 7.2 验证命令

```bash
# 类型检查
pnpm tsgo

# 格式与 lint 检查
pnpm check

# 构建验证
pnpm build
```

---

## 8. Python 环境与版本统一

> 更新日期：2026-04-14

### 8.1 背景

MemPalace MCP Server 依赖 Python venv 环境。系统中存在多个 Python 安装和 mempalace 版本，若版本不一致会导致：

- 模型加载失败（`get_embedding_function` 找不到）
- embedding 模型不一致（不同工具使用不同模型，向量空间不兼容）
- chromadb 数据路径不一致

### 8.2 当前锁定版本矩阵

| 组件                      | 版本        | 路径                                                 |
| ------------------------- | ----------- | ---------------------------------------------------- |
| **Python**                | 3.12.9      | `/Users/qiguang/.mempalace-venvs/current/bin/python` |
| **mempalace**             | 3.1.0       | venv site-packages（`~/.mempalace-venvs/3.1.0`）     |
| **chromadb**              | 1.3.5       | venv site-packages                                   |
| **sentence-transformers** | 3.4.1       | venv site-packages                                   |
| **embedding 模型**        | BAAI/bge-m3 | 由 `MEMPALACE_EMBEDDING_MODEL` 锁定                  |

### 8.3 Venv 隔离机制

```
~/.mempalace-venvs/
├── 3.1.0/              # 以 mempalace 版本命名的 venv
│   └── pyvenv.cfg      # include-system-site-packages = false（完全隔离）
└── current -> 3.1.0/   # symlink，所有工具统一指向此路径
```

`include-system-site-packages = false` 确保 venv 不加载系统 Python 的旧版 mempalace（2.0.0），完全隔离。

### 8.4 统一环境变量

所有入口（LaunchAgent、openclaw.json MCP server）均显式设置以下环境变量：

| 变量                        | 值                                                   | 作用                                        |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `MEMPALACE_PALACE_PATH`     | `/Users/qiguang/.mempalace-data`                     | 数据根目录（chromadb、KG、socket）          |
| `MEMPALACE_SOCKET`          | `/Users/qiguang/.mempalace-data/mcp.sock`            | daemon Unix socket 路径                     |
| `MEMPALACE_PYTHON`          | `/Users/qiguang/.mempalace-venvs/current/bin/python` | connector 回退时使用的 Python               |
| `MEMPALACE_EMBEDDING_MODEL` | `BAAI/bge-m3`                                        | 显式锁定 embedding 模型，防止依赖默认值漂移 |
| `MEMPALACE_VENV`            | `/Users/qiguang/.mempalace-venvs/current`            | venv 根路径（便于脚本引用）                 |
| `ANONYMIZED_TELEMETRY`      | `FALSE`                                              | 禁用遥测                                    |

### 8.5 配置文件层级

```
~/.mempalace/config.json          ← mempalace 主配置（JSON，3.x 读取）
  palace_path: /Users/qiguang/.mempalace-data
  embedding_model: BAAI/bge-m3
  collection_name: mempalace_drawers

~/.mempalace-data/mempalace.yaml  ← 旧格式文件，mempalace 3.x 不读取，仅作记录
  （已更正 embedding_model 为 BAAI/bge-m3，但不生效）
```

**注意**：如需修改 embedding 模型，应同时更新：

1. `~/.mempalace/config.json` 中的 `embedding_model`
2. LaunchAgent plist 中的 `MEMPALACE_EMBEDDING_MODEL`
3. openclaw.json MCP server env 中的 `MEMPALACE_EMBEDDING_MODEL`

### 8.6 升级 mempalace 版本的步骤

```bash
# 1. 创建新 venv（以新版本号命名）
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 \
  -m venv ~/.mempalace-venvs/<新版本号>

# 2. 安装新版本
~/.mempalace-venvs/<新版本号>/bin/pip install mempalace==<新版本号>

# 3. 切换 current symlink
rm ~/.mempalace-venvs/current
ln -s ~/.mempalace-venvs/<新版本号> ~/.mempalace-venvs/current

# 4. 重载 daemon（LaunchAgent 会自动使用新 venv）
launchctl unload ~/Library/LaunchAgents/ai.mempalace.mcp-daemon.plist
launchctl load ~/Library/LaunchAgents/ai.mempalace.mcp-daemon.plist

# 5. 无需修改 openclaw.json 或 plist（路径通过 current symlink 自动指向新版本）
```

---

## 9. 优化时间线

| 日期       | 优化项                                      | 影响                                                                        |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-04-06 | vitest.extension-memory.config.ts 创建      | 记忆专项测试配置                                                            |
| 2026-04-12 | MemPalace 记忆系统统一（主线迁移）          | 主记忆路径从 memory-core 切换到 MemPalace                                   |
| 2026-04-12 | dreaming-phases 日期敏感性修复              | 消除日期相关测试不稳定                                                      |
| 2026-04-12 | doctor-memory-search 测试修复               | 21 个测试全部通过                                                           |
| 2026-04-12 | dreaming-command 挂起修复                   | 测试门禁不再阻塞                                                            |
| 2026-04-12 | 测试模块拆分（helpers/cli-dreaming）        | 测试速度与稳定性提升                                                        |
| 2026-04-12 | 统一回归脚本 mempalace-memory-regression.sh | 一键回归验证                                                                |
| 2026-04-13 | dreaming 系统完善（verified.drawer/KG）     | REM/deep dreaming 验证链路                                                  |
| 2026-04-13 | KG 路径软链接兼容机制                       | 平滑路径迁移                                                                |
| 2026-04-13 | 控制台流式输出闪烁 Bug 修复                 | 多工具调用时文本不再消失                                                    |
| 2026-04-13 | MemPalace MCP Daemon 冷启动优化             | Unix Socket 持久化 Daemon，响应从 9s+ 降至 0.03s                            |
| 2026-04-14 | Python 环境与版本统一                       | 锁定 Python 3.12.9 + mempalace 3.1.0 + chromadb 1.3.5，显式统一所有环境变量 |

---

## 10. 待优化事项

以下问题已识别，建议后续专项跟进：

| 优先级 | 问题                     | 描述                                                |
| ------ | ------------------------ | --------------------------------------------------- |
| P1     | CLI JSON 输出污染        | credentials sync 日志混入 JSON 输出，影响自动化脚本 |
| P1     | memory-core 批量测试长跑 | `memory-core/src/memory/**` 子目录测试存在挂起风险  |
| P2     | heavy-check 锁清理       | 测试失败后残留子进程和锁，需手动清理                |
| P2     | CLI 首响应过重           | `--help` / `status` 类轻命令仍触发 TS 构建          |
| P3     | MemPalace live lane 验证 | 需要真实外部运行时环境的端到端验证                  |
| P3     | 多会话并发压测           | 多 Agent 并发写入/检索场景验证                      |
