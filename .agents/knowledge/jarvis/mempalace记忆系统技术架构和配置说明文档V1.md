# MemPalace 记忆系统技术架构和配置说明文档 V1

> 文档版本：V1  
> 创建日期：2026-04-13  
> 最后更新：2026-04-14（补充 Daemon 架构与版本矩阵）  
> 适用部署：本地 OpenClaw 部署（`/Users/qiguang/openclaw`）  
> 维护负责：openclaw-optimizer / jarvis-memory

---

## 1. 文档说明

本文档面向后续系统维护人员，提供 OpenClaw MemPalace 记忆系统的完整技术说明，包括：

- 整体架构与设计决策
- 三层存储模型
- 关键运行链路
- 插件配置详解
- CLI 操作命令面
- 回归验证方法
- 维护原则

---

## 2. 核心结论

当前部署的记忆系统架构：

| 层次         | 系统                    | 角色                                               |
| ------------ | ----------------------- | -------------------------------------------------- |
| **主路径**   | `mempalace-memory` 插件 | Active memory plugin，所有核心记忆操作均走此路径   |
| **兼容层**   | `memory-core`           | Legacy file-backed compatibility shell，不再是主体 |
| **知识库层** | `memory-wiki`           | 派生知识编译层，非主存储                           |
| **实验层**   | `memory-lancedb`        | 备选向量数据库后端，当前未激活                     |

一句话总结：**MemPalace 是主记忆主体，memory-core 是兼容/回滚层。**

---

## 3. 技术框架

### 3.1 系统定位

MemPalace 是一个三层结构的记忆后端，提供：

1. **Drawers**（ChromaDB）：verbatim evidence，原文证据存储
2. **Knowledge Graph**（SQLite）：durable facts，结构化长期事实
3. **Diary**：agent reflection，Agent 反思与会话连续性

### 3.2 整体架构图

```
用户 / Jarvis / Agent
        │
        ▼
┌──────────────────────┐
│  统一记忆接口         │
│  memory_search       │
│  memory_get          │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  mempalace-memory    │  ← Active Memory Plugin
│  插件                │
└──────┬───────┬───────┘
       │       │
       ▼       ▼
   Drawers   Knowledge Graph   Diary
 (ChromaDB)   (SQLite)       (reflection)

       ↑
  MemPalace MCP Server
  (python -m mempalace.mcp_server)

并行管道：
├── pre-compaction memory flush → MemPalace
├── session-memory hook → MemPalace（失败时 fallback 到文件）
└── dreaming (light/REM/deep) → MemPalace

兼容层（不再是主路径）：
└── memory-core → MEMORY.md / memory/YYYY-MM-DD.md / DREAMS.md
```

### 3.3 存储层详解

#### 3.3.1 Drawers（ChromaDB）

- **存储位置**：`~/.openclaw/mempalace/palace/<uuid>/chroma.sqlite3`
- **作用**：
  - verbatim evidence（原始语料）
  - 会话摘要（session-memory 输出）
  - REM dreaming 合成结果
  - 语义检索的主要对象
- **写入时机**：
  - `memory_search` 结果缓存
  - `session-memory` hook 触发时
  - dreaming REM 阶段输出
- **检索方式**：向量相似度搜索

#### 3.3.2 Knowledge Graph（SQLite）

- **存储位置**：
  - 私有 KG：`~/.mempalace/openclaw/agents/<agentId>/knowledge_graph.sqlite3`
  - 共享 KG：`~/.mempalace-data/knowledge_graph.sqlite3`（或 `~/.mempalace/knowledge_graph.sqlite3` 的软链接）
- **作用**：
  - durable facts（持久事实）
  - 结构化长期关系
  - deep dreaming 强化输出
  - 用户偏好、项目稳定事实
- **写入时机**：
  - `ensureKgFactInMempalace()` 调用
  - deep dreaming 阶段输出
- **检索方式**：实体/关系结构化查询

#### 3.3.3 Diary（日记层）

- **作用**：
  - agent reflection
  - light dreaming 压缩连续性信息
  - 会话切换笔记
- **写入时机**：
  - dreaming light 阶段输出
  - `saveDreamingDiaryToMempalace()` 调用
- **注意**：Diary 不是事实来源，仅为连续性辅助

#### 3.3.4 事件日志

- **路径**：`memory/.dreams/events.jsonl`
- **事件类型**：
  - `memory.recall.recorded`：每次 recall 事件
  - `memory.dream.completed`：每次 dreaming 完成
- **用途**：
  - `dream status` 命令的数据来源
  - 维护审计与回归验证依据

---

## 4. 关键运行链路

### 4.1 语义检索链路（memory_search）

```
用户问题 / continuity cue 触发
        ↓
  memory_search
        ↓
  mempalace-memory 插件
     ├── Drawers 向量搜索
     └── KG 结构化搜索
        ↓
  合并排序结果
        ↓
  写 memory.recall.recorded 事件
        ↓
  返回结果给 agent / CLI
```

**触发条件**（cheap continuity routing）：

- 包含关键词：之前、上次、还记得、按以前、我喜欢、我说过、我们定过
- 英文关键词：history、preference、remember、timeline

**非触发条件**：普通对话不触发 recall，节省 token 开销。

### 4.2 精确读取链路（memory_get）

```
synthetic path（如 mempalace/private/drawer/xxx）
        ↓
  memory_get
        ↓
  manager.readFile()
        ↓
  解析 synthetic path
     ├── Drawer 回源读取
     └── KG 精确回源读取
        ↓
  返回精确文本
```

synthetic path 格式：`mempalace/private/drawer/<id>` 或 `mempalace/shared/kg/<entity>`

### 4.3 Pre-compaction Memory Flush

```
上下文接近 compaction 阈值
        ↓
  resolveMemoryFlushPlan()
        ↓
  mempalace-memory flush plan
        ↓
  声明允许使用的工具白名单
        ↓
  通过 MemPalace 工具写入（diary/drawer）
```

flush 不再强依赖 `memory/YYYY-MM-DD.md`，由 active memory plugin 驱动。

### 4.4 Session-Memory Hook

```
/new 或 /reset 命令触发
        ↓
  session-memory hook
        ↓
  生成 session 摘要
        ↓
  saveSessionMemoryToMempalace()
        ↓
  写 Drawer（优先）
  ↓ (失败时)
  回退到 workspace memory/*.md（兼容保底）
```

### 4.5 Dreaming 链路

```
memory.recall.recorded 事件（燃料）
        ↓
  openclaw memory dream run
        ↓
  ┌─────────────────────────────┐
  │ light dreaming              │
  │ → Diary（压缩连续性）        │
  │ → memory.dream.completed    │
  └─────────────────────────────┘
  ┌─────────────────────────────┐
  │ REM dreaming                │
  │ → Drawer（合成证据）         │
  │ → memory.dream.completed    │
  └─────────────────────────────┘
  ┌─────────────────────────────┐
  │ deep dreaming               │
  │ → KG 强化（durable facts）  │
  │ → memory.dream.completed    │
  └─────────────────────────────┘
        ↓
  返回验证结果（verified.drawer / verified.kgFacts）
```

---

## 5. 隔离模型（Agent 间内存隔离）

### 5.1 设计原则

不同 Agent 之间内存默认隔离，防止互相污染。

### 5.2 两级作用域

#### 私有 Palace（per-agent）

```
~/.mempalace/openclaw/agents/<agentId>/
├── palace/        # ChromaDB drawers
├── knowledge_graph.sqlite3  # 私有 KG
└── wal/           # write-ahead log
```

示例：

- `~/.mempalace/openclaw/agents/openclaw-optimizer/`
- `~/.mempalace/openclaw/agents/jarvis-memory/`
- `~/.mempalace/openclaw/agents/pub-chief/`

**默认行为**：读写均去私有 palace。

#### 共享 Palace（shared-user）

```
~/.mempalace/openclaw/shared-user/
├── palace/
├── knowledge_graph.sqlite3
└── wal/
```

**存储内容**：

- 跨 Agent 的用户稳定偏好
- 长期身份事实
- 全局规则
- 明确允许共享的持久化跨项目事实

### 5.3 Agent 分类与权限

| 类别        | 代表 Agent                                        | 私有读写 | 共享读 | 共享写 |
| ----------- | ------------------------------------------------- | -------- | ------ | ------ |
| A：个人助手 | openclaw-optimizer, jarvis-memory, jarvis-browser | ✓        | ✓      | 选择性 |
| B：任务专家 | pub-\*, content agents, coding agents             | ✓        | 有时   | 通常不 |
| C：管理维护 | jarvis-memory-admin                               | 广泛读写 | ✓      | ✓      |

---

## 6. 插件配置详解

### 6.1 插件注册

插件 ID：`mempalace-memory`  
插件类型：`memory`  
配置位置：`~/.openclaw/openclaw.json` 的 `plugins.entries.mempalace-memory`

激活方式：

```json
{
  "plugins": {
    "slots": {
      "memory": "mempalace-memory"
    },
    "entries": {
      "mempalace-memory": {
        "enabled": true,
        "config": { ... }
      }
    }
  }
}
```

### 6.2 完整配置 Schema

```json
{
  "plugins": {
    "entries": {
      "mempalace-memory": {
        "enabled": true,
        "config": {
          "sharedPalacePath": "~/.mempalace/openclaw/shared-user",
          "sharedKnowledgeGraphPath": "~/.mempalace-data/knowledge_graph.sqlite3",
          "defaultPrivateRoot": "~/.mempalace/openclaw/agents",
          "sharedReadAgents": ["openclaw-optimizer", "jarvis-*"],
          "sharedWriteAgents": ["openclaw-optimizer", "jarvis-memory"],
          "mcpServerName": "mempalace",
          "timeoutMs": 10000,
          "continuityCueBudget": 2,
          "dreaming": {
            "enabled": true,
            "cron": "0 3 * * *",
            "timezone": "America/Los_Angeles",
            "lookbackDays": 7,
            "limit": 6,
            "kgThemes": 3
          },
          "perAgent": {
            "openclaw-optimizer": {
              "privatePalacePath": "~/.mempalace/openclaw/agents/openclaw-optimizer",
              "readShared": true,
              "writeShared": true
            },
            "jarvis-memory": {
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

### 6.3 配置参数详解

| 参数                                      | 类型         | 默认值                                      | 说明                                                     |
| ----------------------------------------- | ------------ | ------------------------------------------- | -------------------------------------------------------- |
| `enabled`                                 | boolean      | true                                        | 插件开关                                                 |
| `sharedPalacePath`                        | string       | -                                           | 共享 palace 根路径                                       |
| `sharedKnowledgeGraphPath`                | string       | `~/.mempalace-data/knowledge_graph.sqlite3` | 共享 KG SQLite 路径                                      |
| `defaultPrivateRoot`                      | string       | `~/.mempalace/openclaw/agents`              | 私有 palace 根目录                                       |
| `sharedReadAgents`                        | string[]     | []                                          | 允许读共享 palace 的 agent pattern 列表（支持 `*` 通配） |
| `sharedWriteAgents`                       | string[]     | []                                          | 允许写共享 palace 的 agent pattern 列表                  |
| `mcpServerName`                           | string       | `"mempalace"`                               | MCP server 名称（对应 `mcp.servers.<name>`）             |
| `timeoutMs`                               | integer      | 10000                                       | MCP 工具调用超时（ms）                                   |
| `continuityCueBudget`                     | integer(1-3) | 2                                           | 触发连续性召回的最大轻量 recall 次数                     |
| `dreaming.enabled`                        | boolean      | -                                           | 是否启用 dreaming                                        |
| `dreaming.cron`                           | string       | -                                           | dreaming 调度 cron 表达式                                |
| `dreaming.timezone`                       | string       | -                                           | 调度时区                                                 |
| `dreaming.lookbackDays`                   | integer      | -                                           | 召回窗口（天）                                           |
| `dreaming.limit`                          | integer      | -                                           | 每轮处理的最大 recall 事件数                             |
| `dreaming.kgThemes`                       | integer      | -                                           | deep dreaming 的 KG 主题数量                             |
| `perAgent.<id>.privatePalacePath`         | string       | 自动推导                                    | 指定 agent 的私有 palace 路径                            |
| `perAgent.<id>.privateKnowledgeGraphPath` | string       | 自动推导                                    | 指定 agent 的私有 KG 路径                                |
| `perAgent.<id>.readShared`                | boolean      | 按 sharedReadAgents 判定                    | 覆盖共享读权限                                           |
| `perAgent.<id>.writeShared`               | boolean      | 按 sharedWriteAgents 判定                   | 覆盖共享写权限                                           |
| `perAgent.<id>.defaultWing`               | string       | -                                           | 默认 wing（MemPalace 内部分区）                          |
| `perAgent.<id>.defaultRoom`               | string       | -                                           | 默认 room（MemPalace 内部分区）                          |

### 6.4 MCP Server 配置（持久化 Daemon 模式）

MemPalace MCP Server 采用**持久化 Daemon + 轻量连接器**架构，解决 SentenceTransformer 模型（BAAI/bge-m3）9–20 秒冷启动超时问题。

#### 架构说明

```
LaunchAgent（开机自启）
    ↓
mcp-daemon.py（持久化进程）
  ├── 启动时预加载 BAAI/bge-m3 模型（~20s，只做一次）
  └── 监听 Unix Socket: ~/.mempalace-data/mcp.sock

OpenClaw 调用时
    ↓
mcp-connect.py（轻量连接器，0.027s）
  ├── 检查 socket 是否存在
  ├── 存在 → 桥接 stdin/stdout ↔ socket（快速路径）
  └── 不存在 → 直接启动 mcp_server（兼容回退，有冷启动延迟）
```

#### openclaw.json 当前配置

```json
{
  "mcp": {
    "servers": {
      "mempalace": {
        "enabled": true,
        "command": "/Users/qiguang/.mempalace-venvs/current/bin/python",
        "args": ["/Users/qiguang/.mempalace-data/mcp-connect.py"],
        "env": {
          "MEMPALACE_PALACE_PATH": "/Users/qiguang/.mempalace-data",
          "MEMPALACE_SOCKET": "/Users/qiguang/.mempalace-data/mcp.sock",
          "MEMPALACE_PYTHON": "/Users/qiguang/.mempalace-venvs/current/bin/python",
          "MEMPALACE_EMBEDDING_MODEL": "BAAI/bge-m3",
          "MEMPALACE_VENV": "/Users/qiguang/.mempalace-venvs/current",
          "ANONYMIZED_TELEMETRY": "FALSE"
        }
      }
    }
  }
}
```

#### LaunchAgent 配置

**文件**：`~/Library/LaunchAgents/ai.mempalace.mcp-daemon.plist`

```xml
<key>ProgramArguments</key>
<array>
    <string>/Users/qiguang/.mempalace-venvs/current/bin/python</string>
    <string>/Users/qiguang/.mempalace-data/mcp-daemon.py</string>
</array>
<key>EnvironmentVariables</key>
<dict>
    <key>MEMPALACE_PALACE_PATH</key>
    <string>/Users/qiguang/.mempalace-data</string>
    <key>MEMPALACE_SOCKET</key>
    <string>/Users/qiguang/.mempalace-data/mcp.sock</string>
    <key>MEMPALACE_EMBEDDING_MODEL</key>
    <string>BAAI/bge-m3</string>
    <key>MEMPALACE_VENV</key>
    <string>/Users/qiguang/.mempalace-venvs/current</string>
    <key>ANONYMIZED_TELEMETRY</key>
    <string>FALSE</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
```

#### 版本矩阵（锁定版本）

| 组件                  | 版本        | 备注                                              |
| --------------------- | ----------- | ------------------------------------------------- |
| Python                | 3.12.9      | venv 隔离，`include-system-site-packages = false` |
| mempalace             | 3.1.0       | venv 路径：`~/.mempalace-venvs/3.1.0`             |
| chromadb              | 1.3.5       | 数据路径由 `MEMPALACE_PALACE_PATH` 控制           |
| sentence-transformers | 3.4.1       | 自动加载，无需手动配置                            |
| Embedding 模型        | BAAI/bge-m3 | 由 `MEMPALACE_EMBEDDING_MODEL` 显式锁定           |

#### Daemon 管理命令

```bash
# 查看 daemon 状态
launchctl list | grep mempalace

# 重启 daemon（配置变更后执行）
launchctl unload ~/Library/LaunchAgents/ai.mempalace.mcp-daemon.plist
launchctl load ~/Library/LaunchAgents/ai.mempalace.mcp-daemon.plist

# 查看 socket 和日志
ls -la ~/.mempalace-data/mcp.sock
tail -20 ~/.mempalace-data/mcp-daemon.log

# 验证连通性（响应 <0.05s 为正常）
python3 -c "
import socket, json, time
t0 = time.time()
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.connect('$HOME/.mempalace-data/mcp.sock')
req = json.dumps({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','clientInfo':{'name':'test'}}})
sock.send((req+'\n').encode())
resp = json.loads(sock.makefile('rb').readline())
print(f'OK: {resp[\"result\"][\"serverInfo\"]}, 耗时 {time.time()-t0:.3f}s')
sock.close()
"
```

**注意**：`MEMPALACE_PALACE_PATH` 在 compat single palace mode 下用于同时作为私有和共享 palace 路径。

### 6.5 compatSinglePalaceMode

当以下条件全部满足时，自动启用兼容单 palace 模式：

- 未配置 `sharedPalacePath`
- 未配置 `defaultPrivateRoot`
- 未配置 per-agent `privatePalacePath`
- MCP server 配置了 `MEMPALACE_PALACE_PATH`

此模式下私有/共享 palace 均指向同一路径，适用于单用户单 Agent 简单部署。

---

## 7. 关键实现文件

### 7.1 插件入口

| 文件             | 路径                                                  | 职责                                                                                                                  |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 主入口           | `extensions/mempalace-memory/index.ts`                | 注册 CLI、memory_search、memory_get、dreaming、flush plan、runtime                                                    |
| 配置解析         | `extensions/mempalace-memory/src/config.ts`           | 解析所有配置，推导 palace 路径，处理 KG 路径软链接                                                                    |
| 底层桥接         | `extensions/mempalace-memory/src/bridge.ts`           | 调用 MemPalace MCP tool / Python bridge；drawer/KG 搜索读取；synthetic path 编码解码                                  |
| 统一 Manager     | `extensions/mempalace-memory/src/manager.ts`          | 对外暴露 search() / readFile() / status()；聚合 drawers + KG；管理 runtime cache                                      |
| 写入 API         | `extensions/mempalace-memory/api.ts`                  | saveSessionMemoryToMempalace / saveDreamingDiaryToMempalace / saveDreamingDrawerToMempalace / ensureKgFactInMempalace |
| Dreaming 核心    | `extensions/mempalace-memory/src/dreaming.ts`         | light/REM/deep dreaming phase 产物生成                                                                                |
| Dreaming helpers | `extensions/mempalace-memory/src/dreaming-helpers.ts` | 纯辅助函数，从 dreaming.ts 拆出，方便测试                                                                             |
| Dreaming 命令    | `extensions/mempalace-memory/src/dreaming-command.ts` | dream status/run/verify 命令实现                                                                                      |
| CLI dreaming     | `extensions/mempalace-memory/src/cli-dreaming.ts`     | CLI dreaming helper（从 cli.ts 拆出）                                                                                 |
| CLI main         | `extensions/mempalace-memory/src/cli.ts`              | memory CLI 命令面                                                                                                     |
| Recall events    | `extensions/mempalace-memory/src/recall-events.ts`    | recall event 记录逻辑                                                                                                 |
| Flush plan       | `extensions/mempalace-memory/src/flush-plan.ts`       | pre-compaction flush 工具白名单声明                                                                                   |
| 搜索别名         | `extensions/mempalace-memory/src/search-aliases.ts`   | 搜索关键词 continuity cue 映射                                                                                        |

### 7.2 兼容层文件

| 文件          | 路径                                             | 职责                                       |
| ------------- | ------------------------------------------------ | ------------------------------------------ |
| 兼容入口      | `extensions/memory-core/index.ts`                | legacy dreaming、file-backed compatibility |
| 兼容 dreaming | `extensions/memory-core/src/dreaming-command.ts` | 在 MemPalace 主槽位下逐步让位              |

---

## 8. CLI 操作命令面

### 8.1 状态查询

```bash
# 查看记忆系统状态
openclaw memory status --agent openclaw-optimizer
openclaw memory status --agent openclaw-optimizer --json

# 深度健康检查
openclaw memory status --agent openclaw-optimizer --deep
```

输出关键字段：

- `provider`：应为 `mempalace`
- `model`：应为 `mcp`
- `files`/`chunks`：drawer 数量
- `vector.available`：向量搜索是否可用

### 8.2 检索操作

```bash
# 语义搜索
openclaw memory search "query text" --agent openclaw-optimizer
openclaw memory search "query text" --agent openclaw-optimizer --json

# 精确读取
openclaw memory get "mempalace/private/drawer/<id>" --agent openclaw-optimizer
```

### 8.3 Dreaming 操作

```bash
# 查看 dreaming 配置与最近一次摘要
openclaw memory dream status --agent openclaw-optimizer

# 执行一轮 dreaming
openclaw memory dream run --agent openclaw-optimizer
openclaw memory dream run --agent openclaw-optimizer --json

# Seed recall 后跑 dreaming，再验证
openclaw memory dream verify "query" --agent openclaw-optimizer
```

`dream run --json` 关键输出字段：
| 字段 | 说明 |
|------|------|
| `aggregateCount` | 处理的 recall 事件数量 |
| `diary.topic` | light dreaming 写入的日记主题 |
| `drawer.drawerId` | REM dreaming 写入的 drawer ID |
| `kgFacts` | deep dreaming 写入的 KG 事实数量 |
| `verified.drawer` | REM drawer 是否验证成功 |
| `verified.kgFacts` | deep KG facts 是否验证成功（数量） |

**健康标准**：`aggregateCount >= 1` 时，`verified.drawer = true` 且 `verified.kgFacts >= 1`

---

## 9. Agent 职责分工

### 9.1 openclaw-optimizer（主 Jarvis）

- **角色**：用户主要交互 Agent
- **职责**：连续性召回；轻量直接写入稳定偏好/事实；复杂操作委托给 jarvis-memory
- **读取权限**：私有 palace + 共享 palace
- **写入权限**：私有 palace（简单事实）+ 共享 palace（稳定用户偏好）
- **不应**：执行繁重维护；大范围修改图结构/分类

### 9.2 jarvis-memory（记忆写入专员）

- **角色**：主要记忆写入负责人
- **职责**：去重检查；持久事实摄入；证据归档；写入校验；结构化记忆更新
- **读取权限**：私有 palace + 共享 palace
- **写入权限**：私有 palace + 共享 palace（明确允许时）

### 9.3 jarvis-memory-admin（记忆维护管理员）

- **角色**：记忆维护负责人
- **职责**：图维护；分类/房间/翼清理；去重；修复；迁移支持
- **注意**：不应出现在默认用户对话链中

---

## 10. 回归验证

### 10.1 主回归脚本

```bash
# 完整 MemPalace 主链路回归
bash scripts/mempalace-memory-regression.sh openclaw-optimizer FINAL-USER-VERIFY-20260411
```

脚本依次验证：

1. `memory status`
2. `memory search`
3. `memory get`
4. `memory dream run`
5. `memory dream status`

输出 `MemPalace regression OK` 表示全部通过。

### 10.2 记忆专项回归

```bash
# 内存扩展专项测试
pnpm test:memory:regression

# 分组测试
pnpm test extensions/mempalace-memory
pnpm test extensions/memory-core/src/dreaming-phases.test.ts
pnpm test extensions/memory-wiki/src/cli.test.ts
pnpm test src/commands/doctor-memory-search.test.ts
```

### 10.3 手工验收链

```bash
openclaw memory search "query" --agent openclaw-optimizer
openclaw memory get "<synthetic-path>" --agent openclaw-optimizer
openclaw memory dream run --agent openclaw-optimizer --json
openclaw memory dream status --agent openclaw-optimizer
```

---

## 11. 当前遗留兼容层

以下内容仍然存在但不再是主体，仅作兼容/回滚/历史支持：

| 遗留项                 | 描述                                            |
| ---------------------- | ----------------------------------------------- |
| `memory-core`          | legacy dreaming、file-backed compatibility      |
| builtin / QMD lane     | legacy file-backed backend                      |
| `MEMORY.md`            | 长期记忆文件（仍注入 prompt，但不再是主事实源） |
| `memory/YYYY-MM-DD.md` | 日记型短期记忆文件                              |
| `DREAMS.md`            | dreaming 解释性日志                             |
| `memory promote`       | legacy 晋升命令                                 |
| `memory rem-harness`   | legacy REM 工具                                 |
| legacy `/dreaming`     | 旧版 dreaming 命令                              |

**维护原则**：不要将这些再写回"主路径"，只作兼容/回滚使用。

---

## 12. 回滚方案

若 MemPalace 主路径出现问题，可快速回滚：

1. 修改配置：`plugins.slots.memory` 从 `"mempalace-memory"` 改回 `"memory-core"`
2. 恢复 `agents.defaults.memorySearch.enabled = true`
3. 禁用 `mempalace-memory` 插件：`plugins.entries.mempalace-memory.enabled = false`
4. 保留 palace 数据在磁盘，不删除（为后续重试保留）

**回滚原则**：绝不删除用户记忆数据。

---

## 13. 维护原则

1. **不引入新的主记忆分叉**：新能力优先接入 `mempalace-memory`
2. **不将 memory-core 包装成主体**：它是兼容层
3. **新增记忆能力时的三问**：
   - 写到 drawer/KG/diary 哪一层？
   - 是否需要 recall event？
   - 是否需要 dream completed event？
4. **先写 helper，再挂 CLI/command**：更容易测试和维护
5. **改完记忆链必须跑回归**：至少跑 `scripts/mempalace-memory-regression.sh`
6. **改完需运行验证**：`pnpm check && pnpm tsgo`

---

## 14. 已知待优化项

以下问题仍待专项跟进（不与产品逻辑失败混同）：

1. `memory-core/src/memory/**` 批量测试的长跑与挂起定位
2. heavy-check 锁与残留子进程的失败后清理
3. CLI JSON 输出被 credentials sync 日志污染（需转移到 stderr 或提供 quiet 开关）
4. MemPalace 外部运行时与 live lane 的真实环境验证
5. `memory-wiki` 作为 MemPalace 派生编译层的集成完善
