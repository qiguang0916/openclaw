# OpenClaw 目录文件说明文档 V1

> 文档版本：V1  
> 创建日期：2026-04-13  
> 适用目录：`/Users/qiguang/openclaw`

---

## 1. 文档说明

本文档记录 OpenClaw 项目目录结构、新增文件分类、以及历次测试报告汇总，供后续运维参考。

---

## 2. 项目整体目录结构

```
/Users/qiguang/openclaw/
├── src/                    # 核心源码
│   ├── cli/                # CLI 命令入口
│   ├── commands/           # 命令实现（含 doctor-memory-search 等）
│   ├── infra/              # 基础设施
│   ├── media/              # 媒体处理
│   ├── gateway/            # 网关协议（protocol/schema.ts）
│   ├── agents/             # Agent 实现（memory-search 等）
│   ├── channels/           # 渠道集成（Telegram、Discord、Slack 等）
│   ├── hooks/              # 钩子（session-memory 等）
│   ├── memory-host-sdk/    # 记忆 Host SDK
│   ├── plugins/            # 插件运行时（memory-runtime/state 等）
│   └── plugin-sdk/         # 插件 SDK 边界（plugin-entry.ts、core.ts）
│
├── extensions/             # 扩展/插件目录（遵循插件 SDK 边界）
│   ├── mempalace-memory/   # MemPalace 记忆插件（当前主记忆）
│   ├── memory-core/        # 核心记忆系统（legacy 兼容层）
│   ├── memory-lancedb/     # LanceDB 向量数据库集成（未激活）
│   ├── memory-wiki/        # Wiki 知识库集成（派生层）
│   └── [其他插件]/          # Matrix、Zalo、Voice 等
│
├── docs/                   # 文档（Mintlify 托管）
│   ├── channels/           # 渠道文档
│   ├── cli/                # CLI 文档
│   ├── concepts/           # 概念文档（memory.md 等）
│   ├── reference/          # 参考文档（memory-config.md 等）
│   ├── plugins/            # 插件文档
│   └── start/              # 入门文档
│
├── scripts/                # 构建/运维脚本
│   ├── lib/                # 脚本库
│   ├── mempalace-memory-regression.sh   # MemPalace 主回归脚本
│   ├── test-memory-regression.sh        # 记忆专项回归脚本
│   └── [其他脚本]/
│
├── ui/                     # Web UI
│   └── src/ui/
│       ├── controllers/    # UI 控制器（sessions.ts 等）
│       └── [其他 UI]/
│
├── test/                   # 测试辅助
├── packages/               # 内部包
├── apps/                   # 移动/桌面应用（iOS、macOS、Android）
├── skills/                 # 技能定义
├── plugins/                # 外部插件（Matrix、Zalo 等）
├── qa/                     # QA 测试
├── dist/                   # 构建输出（不提交）
├── dist-runtime/           # 运行时输出（不提交）
│
├── AGENTS.md               # Agent 配置文档
├── CHANGELOG.md            # 变更日志
├── CLAUDE.md               # Claude 开发规范
├── CONTRIBUTING.md         # 贡献指南
├── README.md               # 项目说明
├── SECURITY.md             # 安全政策
├── VISION.md               # 产品愿景
├── package.json            # 包配置
└── [构建配置文件]/
```

---

## 3. 扩展目录结构详解

### 3.1 extensions/mempalace-memory/（主记忆插件）

```
mempalace-memory/
├── openclaw.plugin.json    # 插件配置 Schema
├── package.json
├── index.ts                # 插件主入口
├── api.ts                  # 写入 API（saveSession/Dream/KgFact）
├── index.test.ts
├── api.test.ts
└── src/
    ├── bridge.ts           # MemPalace MCP 底层桥接（synthetic path 编解码）
    ├── tools.ts            # MCP 工具实现
    ├── manager.ts          # 统一 Manager（search/readFile/status）
    ├── config.ts           # 配置解析与路径推导
    ├── cli.ts              # CLI 命令面
    ├── cli-recall.ts       # recall CLI helper
    ├── dreaming.ts         # dreaming 核心逻辑
    ├── dreaming-helpers.ts # dreaming 纯辅助函数
    ├── dreaming-command.ts # dream status/run/verify 命令
    ├── dreaming-config.ts  # dreaming 配置
    ├── cli-dreaming.ts     # CLI dreaming helper
    ├── cli-dreaming.runtime.ts # runtime seam（便于 mock）
    ├── flush-plan.ts       # pre-compaction flush 计划
    ├── recall-events.ts    # recall event 记录
    ├── search-aliases.ts   # continuity cue 关键词映射
    ├── prompt-section.ts   # prompt 注入段落
    ├── runtime-provider.ts # runtime 提供者
    └── [*.test.ts]         # 各模块测试
```

### 3.2 extensions/memory-core/（遗留兼容层）

```
memory-core/
├── openclaw.plugin.json
├── package.json
├── index.ts                # legacy 入口
├── api.ts
├── runtime-api.ts
├── cli-metadata.ts
└── src/
    ├── dreaming*.ts        # legacy dreaming（保留兼容）
    ├── memory/             # 核心存储层（qmd-manager、embeddings 等）
    │   ├── qmd-manager.ts  # QMD 查询管理器
    │   ├── embeddings.ts   # 嵌入向量
    │   ├── hybrid.ts       # 混合搜索
    │   ├── mmr.ts          # 最大边际相关性
    │   └── [*.test.ts]
    ├── short-term-promotion.ts  # 短期记忆晋升
    ├── concept-vocabulary.ts    # 概念词汇
    └── [其他模块]
```

### 3.3 extensions/memory-lancedb/（未激活）

LanceDB 向量数据库集成，当前 `enabled: false`，保留备用。

### 3.4 extensions/memory-wiki/（知识库派生层）

Wiki 知识库编译与查询，从记忆系统生成人类可读的知识库页面，不是主事实源。

---

## 4. 用户数据目录结构

```
/Users/qiguang/.openclaw/
├── openclaw.json           # 主配置文件（34K）
├── openclaw.json.backup*   # 备份文件
├── memory/                 # 记忆 SQLite 数据库
│   ├── main.sqlite         # 主记忆库
│   ├── douyin.sqlite       # 抖音渠道记忆
│   ├── finance.sqlite      # 财务渠道记忆
│   ├── wechat.sqlite       # 微信渠道记忆
│   ├── xhs.sqlite          # 小红书渠道记忆
│   └── [其他渠道].sqlite
├── mempalace/              # MemPalace 存储
│   └── palace/
│       └── <uuid>/
│           ├── chroma.sqlite3      # ChromaDB（Drawers 存储）
│           └── [HNSWlib 向量索引]
├── agents/                 # Agent 配置（23 个）
├── workspace*/             # 工作空间（23 个）
│   └── workspace-openclaw-optimizer/  # 最活跃（Apr 13）
├── shared/                 # 共享知识库
│   └── content/            # 文档存储目录
├── extensions/             # 扩展配置
├── logs/                   # 日志
└── [其他配置目录]
```

---

## 5. 新增文件分类说明

以下文件是在此次优化过程中新增到项目根目录的，已在整理后移至共享知识库或删除。

### 5.1 已移至共享知识库的文档

| 原文件名                               | 移至                 | 说明                       |
| -------------------------------------- | -------------------- | -------------------------- |
| `记忆系统说明文档.md`                  | 共享知识库（已整合） | MemPalace 记忆系统实现说明 |
| `记忆系统v1.md`                        | 共享知识库（已整合） | 文档口径下记忆系统V1整理   |
| `mempalace-full-replacement-plan.md`   | 共享知识库（已整合） | MemPalace 完全替代计划     |
| `memory-system-unification-plan.md`    | 共享知识库（已整合） | 记忆系统统一计划           |
| `memory-system-current-status.md`      | 共享知识库（已整合） | 记忆系统当前状态           |
| `mempalace-unification-status.md`      | 共享知识库（已整合） | 统一完成状态               |
| `mempalace-runtime-upgrade-runbook.md` | 共享知识库（已整合） | 运行时升级手册             |
| `记忆系统测试分析报告V6.md`            | 本文档第 6 节        | 第六次测试分析（已汇总）   |
| `记忆系统测试分析报告V7.md`            | 本文档第 6 节        | 第七次测试分析（已汇总）   |
| `记忆系统测试分析报告V8.md`            | 本文档第 6 节        | 第八次测试分析（已汇总）   |
| `GitHub上传说明.md`                    | 共享知识库（已整合） | GitHub 上传操作说明        |

### 5.2 保留的配置文件

| 文件名                              | 位置       | 说明                                              |
| ----------------------------------- | ---------- | ------------------------------------------------- |
| `vitest.extension-memory.config.ts` | 项目根目录 | 记忆扩展 Vitest 配置                              |
| `vitest.extension-memory-paths.mjs` | 项目根目录 | 记忆扩展测试路径配置（已更新含 mempalace-memory） |

### 5.3 新增脚本文件

| 文件名                                   | 位置     | 说明                     |
| ---------------------------------------- | -------- | ------------------------ |
| `scripts/mempalace-memory-regression.sh` | scripts/ | MemPalace 主链路回归脚本 |
| `scripts/test-memory-regression.sh`      | scripts/ | 记忆专项单测回归脚本     |

---

## 6. 历次测试分析报告汇总

### 6.1 V6 测试报告（2026-04-12）

**测试范围**：记忆系统全链路首次审计

**测试结论**：

| 维度                  | 结论                                                 |
| --------------------- | ---------------------------------------------------- |
| MemPalace 主链路      | **可用** - status/search/get/dream 全部通过          |
| memory-core 兼容层    | **存在回归** - dreaming phases 4 个测试失败          |
| doctor-memory-search  | **存在问题** - 21 个测试中 5 个失败（误报/漏报）     |
| mempalace-memory 测试 | **部分挂起** - dreaming-command.test.ts 阻塞         |
| 测试门禁              | **覆盖缺口** - mempalace-memory 未纳入默认门禁       |
| CLI 输出              | **不够纯净** - JSON 模式下混入 credentials sync 日志 |

**关键失败点**：

1. **P0**：`vitest.extension-memory-paths.mjs` 未覆盖 `extensions/mempalace-memory`
2. **P0**：`memory-core` dreaming phases 4 个测试统一返回空候选（daily ingestion 失效）
3. **P1**：`doctor-memory-search` 误报/漏报（QMD active 仍警告、auto 模式 provider hint 不完整）
4. **P1**：`mempalace-memory/dreaming-command.test.ts` 长时间挂起占锁
5. **P2**：CLI JSON 输出被 credentials sync 日志污染

**CLI 实测通过情况**（真实运行态）：

```
openclaw memory status --agent openclaw-optimizer --json
→ provider=mempalace, vector.available=true, privateDrawers=6 ✓

openclaw memory search 'FINAL-USER-VERIFY-20260411' --agent openclaw-optimizer --json
→ 6条结果，最高分 score=0.423 ✓

openclaw memory dream run --agent openclaw-optimizer --json
→ aggregateCount=1, verified.drawer=true, verified.kgFacts=1 ✓

bash scripts/mempalace-memory-regression.sh openclaw-optimizer FINAL-USER-VERIFY-20260411
→ MemPalace regression OK ✓
```

**修复后状态（V6 报告内追加）**：

所有 P0/P1 问题在 V6 报告同期完成首轮修复：

- `mempalace-memory` 纳入默认测试门禁 ✓
- dreaming phases 日期敏感性修复（8/8 通过）✓
- doctor-memory-search 测试修复（21/21 通过）✓
- dreaming-command 挂起修复 ✓
- 测试模块拆分（dreaming-helpers、cli-dreaming）✓

最终聚合结果：`extensions/mempalace-memory` 8 个测试文件 24 个测试全部通过

---

### 6.2 V7 测试报告（2026-04-12）

**测试范围**：4 个记忆子系统全面测试（功能/易用/兼容/准确/性能/可测试性）

**代码资产盘点**：

- 测试文件总数：66
- 测试用例总量：约 463
- memory-core：36 文件，约 363 用例
- mempalace-memory：11 文件，约 30 用例
- memory-lancedb：3 文件，约 21 用例
- memory-wiki：16 文件，约 49 用例

**关键批次测试结果**：

| 批次  | 测试对象                       | 结果                                             |
| ----- | ------------------------------ | ------------------------------------------------ |
| TC-01 | mempalace-memory 全量          | 11 文件 30 用例全通过，耗时 13.48s，RSS 229MB    |
| TC-02 | memory-wiki + memory-lancedb   | 18 文件 69 用例 1 失败（wiki CLI 退出码）        |
| TC-03 | memory-core dreaming/promotion | 4 文件 64 用例 1 失败（dreaming 强化分数未提升） |
| TC-04 | memory-core/src/memory 批量    | 长时间无输出，超过 90-120s 未返回                |
| TC-05 | CLI 烟测                       | 触发 TS 构建，观察窗口内未返回业务结果           |
| TC-06 | 全量聚合                       | 占锁，需手工 kill 残留进程                       |

**质量评级**：

| 维度     | 评级   |
| -------- | ------ |
| 功能性   | B-     |
| 易用性   | C      |
| 兼容性   | B-     |
| 准确性   | C+     |
| 性能     | C      |
| 可测试性 | C-     |
| **综合** | **C+** |

**5 大优先修复问题**：

1. memory-core dreaming 强化不生效（排序得分不提升）
2. memory-wiki doctor 非健康态未可靠设置退出码
3. memory-core/src/memory 批量测试长跑无输出
4. 记忆测试聚合跑法会遗留 Vitest 子进程并持续占锁
5. 记忆 CLI 帮助/状态命令过重（首响应体验不佳）

---

### 6.3 V8 测试报告（2026-04-13）

**测试范围**：V7 报告关键失败点复核

**核心结论**：V7 报告中的两条产品级硬失败，在当前代码里都已不再复现：

| 问题                                                  | V7 状态   | V8 状态              |
| ----------------------------------------------------- | --------- | -------------------- |
| memory-core dreaming 强化分数不提升                   | 失败      | **未复现（已修复）** |
| memory-wiki doctor 退出码不正确                       | 失败      | **未复现（已修复）** |
| doctor 在 MemPalace 主槽位下误触发 legacy recall 审计 | V7 未覆盖 | **已修复**           |
| 记忆测试缺少统一回归入口                              | 存在      | **已优化**           |
| 批量测试长跑/heavy-check 锁争用                       | 存在      | 仍待专项             |

**新增修复**：

- `pnpm test:memory:regression` 统一入口（覆盖 3 类关键回归）
- `scripts/test-memory-regression.sh` 脚本

**实际复测结果**：

```bash
# memory-core dreaming phases
pnpm test extensions/memory-core/src/dreaming-phases.test.ts
→ 1 文件通过，8 测试通过 ✓

# memory-wiki doctor 退出码
pnpm test extensions/memory-wiki/src/cli.test.ts
→ 1 文件通过，3 测试通过 ✓

# doctor mempalace 槽位
pnpm test src/commands/doctor-memory-search.test.ts
→ 1 文件通过，24 测试通过 ✓
```

**当前已验证状态（V8 最终）**：

- 主链路可用且主线门禁已覆盖 `mempalace-memory`
- memory-core dreaming phase 回归已修复
- doctor-memory-search 误报/漏报已修复
- mempalace-memory 命令/dreaming/flush/CLI dreaming 测试全部通过

**仍需专项跟进**（非产品逻辑失败，属基础设施治理）：

1. memory-core/src/memory/\*\* 批量测试长跑与挂起定位
2. heavy-check 锁与残留子进程的失败后清理
3. openclaw memory --help / wiki status 轻命令首响应优化
4. MemPalace 外部运行时与 live lane 真实环境验证

---

### 6.4 测试状态综合对比

| 测试项                        | V6      | V7      | V8       | 当前状态 |
| ----------------------------- | ------- | ------- | -------- | -------: |
| mempalace-memory 功能回归     | ✓       | ✓       | ✓        |     稳定 |
| memory-core dreaming phases   | ✗ 4失败 | ✗ 1失败 | ✓        |   已修复 |
| memory-wiki CLI 契约          | ✓       | ✗ 1失败 | ✓        |   已修复 |
| doctor-memory-search          | ✗ 5失败 | -       | ✓ 24通过 |   已修复 |
| dreaming-command.test.ts      | ✗ 挂起  | -       | ✓        |   已修复 |
| memory-core 批量测试          | -       | ✗ 长跑  | -        |   待专项 |
| CLI 首响应                    | ✗ 过重  | ✗ 过重  | -        |   待专项 |
| 测试门禁覆盖 mempalace-memory | ✗       | -       | ✓        |   已修复 |

---

## 7. 目录整理说明

### 7.1 整理原则

1. openclaw 原始目录结构不变
2. 新增的文档、规划、测试报告移至共享知识库
3. 无用的临时文件、过程整理资料从根目录删除
4. 回归脚本保留在 `scripts/` 目录

### 7.2 整理结果

**从根目录移除的文件**（已整合到共享知识库）：

- `记忆系统v1.md`
- `记忆系统说明文档.md`
- `记忆系统测试分析报告V6.md`
- `记忆系统测试分析报告V7.md`
- `记忆系统测试分析报告V8.md`
- `GitHub上传说明.md`
- `memory-system-current-status.md`
- `memory-system-unification-plan.md`
- `mempalace-full-replacement-plan.md`
- `mempalace-runtime-upgrade-runbook.md`
- `mempalace-unification-status.md`

**保留在根目录的文件**：

- `vitest.extension-memory.config.ts`（测试配置，项目构建使用）
- `vitest.extension-memory-paths.mjs`（测试路径配置，项目构建使用）

**共享知识库存放位置**：`/Users/qiguang/.openclaw/shared/content/`

---

## 8. 快速参考

### 常用命令

```bash
# 记忆系统状态
openclaw memory status --agent openclaw-optimizer --json

# 记忆搜索
openclaw memory search "query" --agent openclaw-optimizer

# Dreaming
openclaw memory dream run --agent openclaw-optimizer --json
openclaw memory dream status --agent openclaw-optimizer

# 主回归
bash scripts/mempalace-memory-regression.sh openclaw-optimizer FINAL-USER-VERIFY-20260411

# 专项回归
pnpm test:memory:regression

# 构建部署
pnpm build:reload

# 类型检查
pnpm tsgo && pnpm check
```

### 关键文件速查

| 需求                      | 文件位置                                           |
| ------------------------- | -------------------------------------------------- |
| 主配置                    | `~/.openclaw/openclaw.json`                        |
| MemPalace 插件配置 Schema | `extensions/mempalace-memory/openclaw.plugin.json` |
| 流式输出修复              | `ui/src/ui/controllers/sessions.ts:39-47`          |
| MemPalace 桥接            | `extensions/mempalace-memory/src/bridge.ts`        |
| 记忆写入 API              | `extensions/mempalace-memory/api.ts`               |
| 配置解析                  | `extensions/mempalace-memory/src/config.ts`        |
| 回归脚本                  | `scripts/mempalace-memory-regression.sh`           |
