# OpenClaw Agents 配置说明文档 V1

> 文档版本：V1  
> 创建日期：2026-04-14  
> 配置文件：`~/.openclaw/openclaw.json`  
> 适用部署：本地 OpenClaw 部署（`/Users/qiguang/openclaw`）  
> 维护负责：openclaw-optimizer / jarvis-memory

---

## 1. 文档说明

本文档全面描述 OpenClaw `agents` 配置体系，包括：

- `agents.defaults` 全局默认配置
- 38 个 agent 的完整逐项说明
- 工具权限机制（allow / alsoAllow / deny / profile）
- 记忆系统集成方式
- 知识目录结构
- 模型别名与路由
- Subagents 编排关系

---

## 2. 整体配置结构

```
~/.openclaw/openclaw.json
└── agents
    ├── defaults           ← 全局默认，适用于所有 agent（不被继承，是基线）
    └── list[]             ← 38 个 agent 的显式配置
```

**重要约束**：`agents.defaults.tools` 不会自动继承给有显式 `tools.allow` 的 agent。工具权限是每个 agent 独立配置的。

---

## 3. agents.defaults 详解

```json
"agents": {
  "defaults": {
    "model": "anthropic/claude-sonnet-4-6",
    "thinkingDefault": "low",
    "contextInjection": "continuation-skip",
    "heartbeat": { "every": "0m" },
    "models": { ... },
    "subagents": { ... },
    "compaction": { ... },
    "contextPruning": { ... },
    "memorySearch": { ... },
    "workspace": "...",
    "skills": [],
    "bootstrapMaxChars": 30000,
    "bootstrapTotalMaxChars": 60000,
    "bootstrapPromptTruncationWarning": "off",
    "sandbox": { "mode": "off" }
  }
}
```

### 3.1 模型默认值

| 字段               | 值                            | 说明                                |
| ------------------ | ----------------------------- | ----------------------------------- |
| `model`            | `anthropic/claude-sonnet-4-6` | 全局默认模型                        |
| `thinkingDefault`  | `low`                         | 默认思考深度（off/low/medium/high） |
| `contextInjection` | `continuation-skip`           | 上下文注入策略，跳过不连续注入      |

### 3.2 模型别名表

所有 agent 均可使用以下别名代替完整模型 ID：

| 别名          | 模型 ID                                  | 说明                               |
| ------------- | ---------------------------------------- | ---------------------------------- |
| `sonnet`      | `anthropic/claude-sonnet-4-6`            | 主力模型，开启 fastMode+long cache |
| `hard`        | `anthropic/claude-opus-4-6`              | 最强推理，short cache              |
| `codex`       | `openai-codex/gpt-5.4`                   | OpenAI 代码模型，fastMode          |
| `cheap`       | `deepseek/deepseek-chat`                 | 低成本模型                         |
| `mini`        | `minimax/MiniMax-M2.7`                   | MiniMax 模型                       |
| `local`       | `ollama/gemma4:e4b`                      | 本地 Ollama 模型                   |
| `doubao`      | `volcengine/doubao-seed-1-8-251228`      | 豆包标准版                         |
| `doubao-pro`  | `volcengine/doubao-seed-2-0-pro-260215`  | 豆包专业版                         |
| `doubao-lite` | `volcengine/doubao-seed-2-0-lite-260215` | 豆包轻量版                         |
| `doubao-code` | `volcengine-plan/doubao-seed-code`       | 豆包代码版                         |

### 3.3 Subagents 全局默认

```json
"subagents": {
  "model": "deepseek/deepseek-chat",
  "thinking": "off",
  "maxSpawnDepth": 1,
  "maxConcurrent": 4,
  "runTimeoutSeconds": 300,
  "archiveAfterMinutes": 60,
  "requireAgentId": true
}
```

| 字段                  | 值                       | 说明                          |
| --------------------- | ------------------------ | ----------------------------- |
| `model`               | `deepseek/deepseek-chat` | Subagent 默认使用 cheap 模型  |
| `maxSpawnDepth`       | `1`                      | 最大嵌套深度，防止无限递归    |
| `maxConcurrent`       | `4`                      | 最多同时运行 4 个 subagent    |
| `runTimeoutSeconds`   | `300`                    | 单个 subagent 最长运行 5 分钟 |
| `archiveAfterMinutes` | `60`                     | 1 小时后归档非活跃 subagent   |
| `requireAgentId`      | `true`                   | 必须指定 agentId 才能 spawn   |

### 3.4 Compaction（上下文压缩）

```json
"compaction": {
  "mode": "safeguard",
  "model": "deepseek/deepseek-chat",
  "identifierPolicy": "strict",
  "timeoutSeconds": 300
}
```

- `mode: safeguard`：上下文接近限制时触发压缩，保护会话不被截断
- `model`：使用低成本模型执行压缩摘要
- `identifierPolicy: strict`：严格模式，减少摘要中的信息丢失

### 3.5 Context Pruning（上下文裁剪）

```json
"contextPruning": {
  "mode": "cache-ttl",
  "ttl": "55m",
  "keepLastAssistants": 2
}
```

- `mode: cache-ttl`：按缓存 TTL 裁剪过期上下文
- `ttl: 55m`：55 分钟后过期的上下文条目将被裁剪
- `keepLastAssistants: 2`：始终保留最近 2 条 assistant 回复

### 3.6 MemorySearch 默认配置

```json
"memorySearch": {
  "provider": "ollama",
  "model": "nomic-embed-text:latest",
  "fallback": "none",
  "query": {
    "hybrid": {
      "mmr": { "lambda": 0.7, "enabled": true },
      "temporalDecay": { "enabled": true, "halfLifeDays": 30 }
    },
    "maxResults": 10
  },
  "extraPaths": [
    "/Users/qiguang/.openclaw/workspace-comic-team-independent/knowledge",
    "/Users/qiguang/openclaw/.agents/knowledge/common"
  ],
  "enabled": true
}
```

| 字段                             | 说明                                                    |
| -------------------------------- | ------------------------------------------------------- |
| `provider: ollama`               | 使用本地 Ollama 做 embedding                            |
| `model: nomic-embed-text:latest` | legacy embedding 模型（MemPalace 主路径用 BAAI/bge-m3） |
| `fallback: none`                 | 无回退方案                                              |
| `mmr.lambda: 0.7`                | MMR 多样性参数（0=纯相关性，1=纯多样性）                |
| `temporalDecay`                  | 时间衰减：30 天半衰期，旧记忆降权                       |
| `maxResults: 10`                 | 每次搜索最多返回 10 条                                  |
| `extraPaths`                     | 额外知识路径，bootstrap 时加载到上下文                  |

**extraPaths 机制**：路径中的 Markdown 文件会在会话启动时加载进 agent 的 bootstrap 上下文（受 `bootstrapMaxChars`/`bootstrapTotalMaxChars` 限制）。

### 3.7 Bootstrap 限制

| 字段                               | 值      | 说明                           |
| ---------------------------------- | ------- | ------------------------------ |
| `bootstrapMaxChars`                | `30000` | 单个知识文件最多加载字符数     |
| `bootstrapTotalMaxChars`           | `60000` | 所有知识文件总计最多加载字符数 |
| `bootstrapPromptTruncationWarning` | `off`   | 关闭截断警告                   |

---

## 4. 工具权限机制

每个 agent 的 `tools` 字段控制其可用工具。有三种模式：

### 4.1 显式 allow 模式

```json
"tools": {
  "allow": ["memory_search", "read", "write", "exec"]
}
```

- **精确白名单**：只有列出的工具可用，其他全部禁止
- **不继承 defaults**：per-agent `allow` 是完全独立的列表
- **不可与 alsoAllow 共存**

### 4.2 Profile + alsoAllow 模式

```json
"tools": {
  "profile": "coding",
  "deny": ["sessions_spawn", "agents_list"],
  "alsoAllow": ["memory_search", "memory_write"]
}
```

- **profile**：使用预定义工具集（`coding`/`minimal`/`messaging` 等）
- **alsoAllow**：在 profile 基础上追加额外工具
- **deny**：从 profile 中移除不需要的工具
- **不可与 allow 共存**（schema 层校验）

### 4.3 Profile + allow 组合（部分 agent）

```json
"tools": {
  "profile": "minimal",
  "allow": ["read", "web_search", "memory_search"]
}
```

注意：`profile` + `allow` 同时存在时，行为取决于具体 profile 实现。

### 4.4 记忆工具标准集

2026-04-14 起，所有 38 个 agent 均配置了以下记忆工具：

| 工具            | 用途                                       |
| --------------- | ------------------------------------------ |
| `memory_search` | 语义检索：找过去的对话、决策、偏好         |
| `memory_get`    | 精确读取：通过 synthetic path 读取完整内容 |
| `memory_write`  | 写入：保存重要事实/决策/偏好到 drawer      |
| `memory_update` | 更新：修改已有 drawer 或 KG 事实           |
| `memory_delete` | 删除：移除过期或错误的记忆                 |

每个 agent 使用各自独立的私有 palace（`~/.mempalace/openclaw/agents/<agentId>/`）。

---

## 5. 记忆隔离架构

```
~/.mempalace/openclaw/
├── agents/
│   ├── openclaw-optimizer/      ← 贾维斯私有 palace
│   │   ├── palace/             (ChromaDB drawers)
│   │   ├── knowledge_graph.sqlite3
│   │   └── wal/
│   ├── jarvis-memory/
│   ├── pub-chief/
│   ├── dy-chief/
│   └── ...（每 agentId 一个）
└── shared-user/                 ← 跨 agent 共享 palace
    ├── palace/
    └── knowledge_graph.sqlite3

~/.mempalace-data/
└── knowledge_graph.sqlite3      ← 共享 KG（软链接或独立文件）
```

**共享读写权限**（来自 mempalace-memory 插件配置）：

- 私有读写：所有 agent 默认
- 共享读：`openclaw-optimizer`、`jarvis-*`
- 共享写：`openclaw-optimizer`、`jarvis-memory`

---

## 6. Agent 分组与编排总览

```
个人助手组（Jarvis 系列）
├── openclaw-optimizer（主入口/贾维斯）
│   └── subagents: 无（allowAgents: []）
├── jarvis-browser
├── jarvis-feishu
├── jarvis-memory（记忆写入专员）
├── jarvis-memory-admin（记忆维护管理员）
├── jarvis-media
└── jarvis-scheduler

公众号内容生产组（pub 系列）
└── pub-chief（Lead，可调度以下）
    ├── pub-topic
    ├── pub-topic-theme
    ├── pub-write
    ├── pub-fact
    ├── pub-style
    ├── pub-score
    └── pub-fix

抖音内容生产组（dy 系列）
└── dy-chief（Lead，可调度以下）
    ├── dy-benchmark
    ├── dy-script
    ├── dy-video
    ├── dy-review
    └── dy-score

AI漫剧生产组（comic 系列）
└── comic-team-lead（团队领导，可调度以下）
    ├── operations-assistant
    └── comic-director（生产总监，可调度以下）
        ├── script-analyzer
        ├── character-designer
        ├── scene-planner
        ├── storyboard-generator
        ├── image-generator
        ├── audio-synthesizer
        ├── video-compositor
        ├── quality-reviewer
        └── release-manager

研发工程组（dev 系列）
└── dev-lead（开发总控，可调度以下）
    ├── system-architect
    ├── codex-builder
    └── codex-acp-builder

独立 Agent
└── ai-content-workflow（AI内容创作工作流）
```

---

## 7. 个人助手组（Jarvis 系列）

### 7.1 openclaw-optimizer（贾维斯）

**定位**：主入口个人助手，最全面的工具权限，用户日常交互的核心 agent。

| 字段        | 值                                            |
| ----------- | --------------------------------------------- |
| `id`        | `openclaw-optimizer`                          |
| `name`      | 贾维斯                                        |
| `model`     | `anthropic/claude-sonnet-4-6`                 |
| `workspace` | `~/.openclaw/workspace-openclaw-optimizer`    |
| `agentDir`  | `~/.openclaw/agents/openclaw-optimizer/agent` |

**知识路径（memorySearch.extraPaths）**：

- `/Users/qiguang/openclaw/.agents/knowledge/jarvis` — 贾维斯专属知识库
- `/Users/qiguang/openclaw/.agents/knowledge/finance` — 财务相关知识
- `/Users/qiguang/aibiji-obssidian` — Obsidian 笔记库

**工具白名单**：

```
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
MemPalace 原生: mempalace_add_drawer, mempalace_kg_add, mempalace_diary_write
文件: read, edit, write
执行: exec, process
网络: web_search, web_fetch
Gateway: gateway
会话管理: agents_list, sessions_spawn, sessions_list, sessions_history,
          sessions_send, sessions_yield, session_status
```

**沙箱额外允许**（sandbox.tools.alsoAllow）：

```
memory_write, memory_update, memory_delete
```

**Skills**：`summarize`

**Subagents**：`allowAgents: []`（不调度 subagent，自主处理所有任务）

**记忆权限**：私有读写 + 共享读写（唯一有完整 mempalace\_\* 原生工具的主助手）

---

### 7.2 jarvis-browser（贾维斯浏览器专家）

**定位**：处理需要浏览器自动化、网页抓取的任务。

| 字段        | 值                                                                 |
| ----------- | ------------------------------------------------------------------ |
| `id`        | `jarvis-browser`                                                   |
| `model`     | `anthropic/claude-sonnet-4-6`                                      |
| `workspace` | `~/.openclaw/workspace-openclaw-optimizer`（共享贾维斯 workspace） |

**工具白名单**：

```
浏览器: browser, web_search, web_fetch
文件: read, write
执行: exec, process
其他: session_status
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
```

**Skills**：`agent-browser`、`playwright-browser-automation`、`multi-search-engine`

---

### 7.3 jarvis-feishu（贾维斯飞书专家）

**定位**：处理飞书（Lark）相关的所有操作，包含 IM、日历、任务、多维表格、文档等完整飞书工具集。

| 字段        | 值                                                       |
| ----------- | -------------------------------------------------------- |
| `id`        | `jarvis-feishu`                                          |
| `model`     | `deepseek/deepseek-chat`（低成本，飞书操作不需要强推理） |
| `workspace` | `~/.openclaw/workspace-openclaw-optimizer`               |

**工具白名单（飞书工具）**：

| 类别      | 工具                                                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IM 消息   | `feishu_im_user_message`, `feishu_im_user_fetch_resource`, `feishu_im_user_get_messages`, `feishu_im_user_get_thread_messages`, `feishu_im_user_search_messages`, `feishu_im_bot_image`               |
| 用户搜索  | `feishu_get_user`, `feishu_search_user`, `feishu_chat`, `feishu_chat_members`                                                                                                                         |
| 日历      | `feishu_calendar_calendar`, `feishu_calendar_event`, `feishu_calendar_event_attendee`, `feishu_calendar_freebusy`                                                                                     |
| 任务      | `feishu_task_task`, `feishu_task_tasklist`, `feishu_task_section`, `feishu_task_comment`, `feishu_task_subtask`                                                                                       |
| 多维表格  | `feishu_bitable_app`, `feishu_bitable_app_table`, `feishu_bitable_app_table_record`, `feishu_bitable_app_table_field`, `feishu_bitable_app_table_view`                                                |
| 文档/Wiki | `feishu_search_doc_wiki`, `feishu_drive_file`, `feishu_doc_comments`, `feishu_doc_media`, `feishu_wiki_space`, `feishu_wiki_space_node`, `feishu_fetch_doc`, `feishu_create_doc`, `feishu_update_doc` |
| 表格      | `feishu_sheet`                                                                                                                                                                                        |
| OAuth     | `feishu_oauth`, `feishu_oauth_batch_auth`                                                                                                                                                             |
| 交互      | `message`, `feishu_ask_user_question`                                                                                                                                                                 |
| 基础      | `read`, `write`, `web_search`, `web_fetch`                                                                                                                                                            |
| 记忆      | `memory_search`, `memory_get`, `memory_write`, `memory_update`, `memory_delete`                                                                                                                       |

---

### 7.4 jarvis-memory（贾维斯记忆专家）

**定位**：专职记忆写入员，负责去重检查、持久事实摄入、证据归档、写入校验。主 agent（贾维斯）处理不了的复杂记忆操作委托给此 agent。

| 字段        | 值                                    |
| ----------- | ------------------------------------- |
| `id`        | `jarvis-memory`                       |
| `model`     | `deepseek/deepseek-chat`              |
| `workspace` | `~/.openclaw/workspace-jarvis-memory` |

**工具白名单**：

```
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
文件: read, write
网络: web_search, web_fetch
```

**Skills**：`self-improving-agent`、`proactive-agent`

**记忆权限**：私有读写 + 共享读写（配置为 sharedWriteAgents 之一）

---

### 7.5 jarvis-memory-admin（贾维斯记忆管理专家）

**定位**：记忆系统维护管理员，负责知识图谱结构维护、分类清理、去重、修复。不应出现在正常用户对话链中。

| 字段        | 值                                    |
| ----------- | ------------------------------------- |
| `id`        | `jarvis-memory-admin`                 |
| `model`     | `deepseek/deepseek-chat`              |
| `workspace` | `~/.openclaw/workspace-jarvis-memory` |

**工具白名单**：

```
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
文件: read, write
```

（无 web_search/web_fetch，专注于内部记忆系统维护）

---

### 7.6 jarvis-media（贾维斯媒体专家）

**定位**：处理图像生成、音乐生成、视频生成、TTS、PDF 等媒体相关任务。

| 字段        | 值                                                                  |
| ----------- | ------------------------------------------------------------------- |
| `id`        | `jarvis-media`                                                      |
| `model`     | `volcengine/doubao-seed-2-0-pro-260215`（豆包专业版，多模态能力强） |
| `workspace` | `~/.openclaw/workspace-openclaw-optimizer`                          |

**工具白名单**：

```
媒体: image, pdf, image_generate, music_generate, video_generate, tts
文件: read, write
执行: exec, process
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
```

---

### 7.7 jarvis-scheduler（贾维斯调度专家）

**定位**：处理定时任务、消息发送、会话调度等异步/定时相关工作。

| 字段        | 值                                         |
| ----------- | ------------------------------------------ |
| `id`        | `jarvis-scheduler`                         |
| `model`     | `deepseek/deepseek-chat`                   |
| `workspace` | `~/.openclaw/workspace-openclaw-optimizer` |

**工具白名单**：

```
调度: cron, message
会话: sessions_list, sessions_send, sessions_history, session_status
文件: read, write
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
```

**Skills**：`cron-mastery`、`proactive-agent`

---

## 8. 公众号内容生产组（pub 系列）

**架构**：`pub-chief` 作为 Lead，通过 subagents 调度 7 个专职 agent 组成完整内容生产流水线。

### 8.1 pub-chief（公众号 lead）

**定位**：公众号内容生产总指挥，协调各专职 agent 完成从选题到发布的全流程。

| 字段        | 值                                   |
| ----------- | ------------------------------------ |
| `id`        | `pub-chief`                          |
| `name`      | 公众号 lead                          |
| `default`   | `true`（系统默认 agent）             |
| `model`     | `anthropic/claude-sonnet-4-6`        |
| `workspace` | `~/.openclaw/workspace-pub-chief`    |
| `agentDir`  | `~/.openclaw/agents/pub-chief/agent` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/pub/lead`

**Subagents（可调度）**：`pub-topic`、`pub-topic-theme`、`pub-write`、`pub-fact`、`pub-style`、`pub-score`、`pub-fix`

**工具**：仅记忆工具（`memory_search/get/write/update/delete`），不操作文件和网络，专注于协调调度。

---

### 8.2 pub-topic（选题）

**定位**：选题策略 agent，发现值得写的话题。

| 字段        | 值                                   |
| ----------- | ------------------------------------ |
| `id`        | `pub-topic`                          |
| `model`     | `deepseek/deepseek-chat`             |
| `workspace` | `~/.openclaw/workspace-pub-topic`    |
| `agentDir`  | `~/.openclaw/agents/pub-topic/agent` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/pub/topic`

**Skills**：`content-strategy`

**工具**：仅记忆工具

---

### 8.3 pub-topic-theme（主题发现）

**定位**：深化选题，提炼主题方向与角度。

| 字段        | 值                                         |
| ----------- | ------------------------------------------ |
| `id`        | `pub-topic-theme`                          |
| `model`     | `deepseek/deepseek-chat`                   |
| `workspace` | `~/.openclaw/workspace-pub-topic-theme`    |
| `agentDir`  | `~/.openclaw/agents/pub-topic-theme/agent` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/pub/topic-theme`

**Skills**：`content-strategy`

**工具**：仅记忆工具

---

### 8.4 pub-write（内容创作）

**定位**：执行文章撰写，将主题转化为完整的内容。

| 字段        | 值                                                          |
| ----------- | ----------------------------------------------------------- |
| `id`        | `pub-write`                                                 |
| `model`     | `volcengine/doubao-seed-1-8-251228`（豆包，中文写作能力强） |
| `workspace` | `~/.openclaw/workspace-pub-write`                           |
| `agentDir`  | `~/.openclaw/agents/pub-write/agent`                        |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/pub/write`

**Skills**：`content-writer`

**工具**：仅记忆工具

---

### 8.5 pub-fact（事实审查）

**定位**：核实文章中的事实准确性。

| 字段        | 值                                  |
| ----------- | ----------------------------------- |
| `id`        | `pub-fact`                          |
| `model`     | `deepseek/deepseek-chat`            |
| `workspace` | `~/.openclaw/workspace-pub-fact`    |
| `agentDir`  | `~/.openclaw/agents/pub-fact/agent` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/pub/fact`

**Skills**：`verify-claims`

**工具**：仅记忆工具

---

### 8.6 pub-style（文风审查）

**定位**：审查并优化文章的语言风格、措辞表达。

| 字段        | 值                                                      |
| ----------- | ------------------------------------------------------- |
| `id`        | `pub-style`                                             |
| `model`     | `volcengine/doubao-seed-1-8-251228`（豆包，中文语感好） |
| `workspace` | `~/.openclaw/workspace-pub-style`                       |
| `agentDir`  | `~/.openclaw/agents/pub-style/agent`                    |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/pub/style`

**Skills**：`edit`

**工具**：仅记忆工具

---

### 8.7 pub-score（评分）

**定位**：对内容质量进行评分，提供量化反馈。

| 字段        | 值                                   |
| ----------- | ------------------------------------ |
| `id`        | `pub-score`                          |
| `model`     | `minimax/MiniMax-M2.7`               |
| `workspace` | `~/.openclaw/workspace-pub-score`    |
| `agentDir`  | `~/.openclaw/agents/pub-score/agent` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/pub/score`

**工具**：仅记忆工具

---

### 8.8 pub-fix（修复）

**定位**：根据审查结果修复文章，包含文本人性化处理。

| 字段        | 值                                 |
| ----------- | ---------------------------------- |
| `id`        | `pub-fix`                          |
| `model`     | `deepseek/deepseek-chat`           |
| `workspace` | `~/.openclaw/workspace-pub-fix`    |
| `agentDir`  | `~/.openclaw/agents/pub-fix/agent` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/pub/fix`

**Skills**：`edit`、`humanizer-zh`

**工具**：仅记忆工具

---

## 9. 抖音内容生产组（dy 系列）

**架构**：`dy-chief` 作为 Lead，调度 5 个专职 agent 完成抖音内容从对标拆解到短视频发布的流水线。

### 9.1 dy-chief（抖音 lead）

**定位**：抖音内容生产总指挥，协调各专职 agent。

| 字段        | 值                                  |
| ----------- | ----------------------------------- |
| `id`        | `dy-chief`                          |
| `name`      | 抖音 lead                           |
| `model`     | `anthropic/claude-sonnet-4-6`       |
| `workspace` | `~/.openclaw/workspace-dy-chief`    |
| `agentDir`  | `~/.openclaw/agents/dy-chief/agent` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/douyin/lead`

**Subagents（可调度）**：`dy-benchmark`、`dy-script`、`dy-video`、`dy-review`、`dy-score`

**工具**：仅记忆工具

---

### 9.2 dy-benchmark（对标拆解）

**定位**：分析拆解对标账号/视频，提炼可复用的内容规律。

| 字段        | 值                                   |
| ----------- | ------------------------------------ |
| `id`        | `dy-benchmark`                       |
| `model`     | `deepseek/deepseek-chat`             |
| `workspace` | `~/.openclaw/workspace-dy-benchmark` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/douyin/benchmark`

**工具**：仅记忆工具

---

### 9.3 dy-script（标题脚本）

**定位**：生成抖音视频标题、脚本、字幕文本。

| 字段        | 值                                                        |
| ----------- | --------------------------------------------------------- |
| `id`        | `dy-script`                                               |
| `model`     | `volcengine/doubao-seed-1-8-251228`（豆包，中文内容生成） |
| `workspace` | `~/.openclaw/workspace-dy-script`                         |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/douyin/script`

**工具**：仅记忆工具

---

### 9.4 dy-video（短视频生成）

**定位**：执行视频内容生成工作。

| 字段        | 值                                                            |
| ----------- | ------------------------------------------------------------- |
| `id`        | `dy-video`                                                    |
| `model`     | `volcengine/doubao-seed-2-0-pro-260215`（豆包专业版，多模态） |
| `workspace` | `~/.openclaw/workspace-dy-video`                              |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/douyin/video`

**工具**：仅记忆工具

---

### 9.5 dy-review（短视频审查）

**定位**：审查短视频内容的质量与合规性。

| 字段        | 值                                |
| ----------- | --------------------------------- |
| `id`        | `dy-review`                       |
| `model`     | `minimax/MiniMax-M2.7`            |
| `workspace` | `~/.openclaw/workspace-dy-review` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/douyin/review`

**工具**：仅记忆工具

---

### 9.6 dy-score（评分）

**定位**：对抖音内容质量评分。

| 字段        | 值                               |
| ----------- | -------------------------------- |
| `id`        | `dy-score`                       |
| `model`     | `deepseek/deepseek-chat`         |
| `workspace` | `~/.openclaw/workspace-dy-score` |

**知识路径**：`/Users/qiguang/openclaw/.agents/knowledge/douyin/score`

**工具**：仅记忆工具

---

## 10. AI漫剧生产组（comic 系列）

**架构**：两层编排——`comic-team-lead` → `comic-director` → 9 个生产专职 agent。

### 10.1 comic-team-lead（AI漫剧团队领导）

**定位**：最高层团队领导，负责客户沟通、团队管理、整体调度。

| 字段        | 值                                                       |
| ----------- | -------------------------------------------------------- |
| `id`        | `comic-team-lead`                                        |
| `model`     | `anthropic/claude-sonnet-4-6`                            |
| `workspace` | `~/.openclaw/workspace-comic-team-independent/team-lead` |

**知识路径**：

- `.../knowledge/team-management`
- `.../knowledge/client-communication`

**Subagents（可调度）**：`comic-director`、`operations-assistant`

**工具**：

```
消息: message, feishu_im_user_message, feishu_ask_user_question
调度: cron, sessions_list, sessions_send, sessions_spawn
文件: read, write, exec
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
```

---

### 10.2 operations-assistant（运营助理）

**定位**：处理运营日常事务，飞书表格数据管理。

| 字段        | 值                                                                  |
| ----------- | ------------------------------------------------------------------- |
| `id`        | `operations-assistant`                                              |
| `model`     | `deepseek/deepseek-chat`                                            |
| `workspace` | `~/.openclaw/workspace-comic-team-independent/operations-assistant` |

**知识路径**：`.../knowledge/operations`

**工具**：

```
文件: read, write, exec
调度: cron
飞书: feishu_sheet
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
```

---

### 10.3 comic-director（AI漫剧生产总监）

**定位**：生产总监，协调 9 个制作专职 agent 完成漫剧生产全流程。

| 字段        | 值                                                            |
| ----------- | ------------------------------------------------------------- |
| `id`        | `comic-director`                                              |
| `model`     | `anthropic/claude-sonnet-4-6`                                 |
| `workspace` | `~/.openclaw/workspace-comic-team-independent/comic-director` |

**知识路径**：`.../knowledge/project-management`

**Subagents（可调度）**：`script-analyzer`、`character-designer`、`scene-planner`、`storyboard-generator`、`image-generator`、`audio-synthesizer`、`video-compositor`、`quality-reviewer`、`release-manager`

**工具**：

```
会话: sessions_list, sessions_send, sessions_spawn
文件: read, write, exec
调度: cron
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
```

---

### 10.4 生产专职 Agent 一览

| Agent                  | 名称     | 模型                | 特殊工具                |
| ---------------------- | -------- | ------------------- | ----------------------- |
| `script-analyzer`      | 剧本分析 | claude-sonnet-4-6   | pdf, read, write, exec  |
| `character-designer`   | 角色设计 | doubao-seed-2-0-pro | image_generate          |
| `scene-planner`        | 场景规划 | doubao-seed-2-0-pro | image, image_generate   |
| `storyboard-generator` | 分镜生成 | deepseek-chat       | read, write, exec       |
| `image-generator`      | 图像生成 | doubao-seed-2-0-pro | image_generate, process |
| `audio-synthesizer`    | 音频合成 | MiniMax-M2.7        | tts, music_generate     |
| `video-compositor`     | 视频合成 | deepseek-chat       | video_generate, process |
| `quality-reviewer`     | 质量审查 | claude-sonnet-4-6   | image, process          |
| `release-manager`      | 发布管理 | claude-sonnet-4-6   | message, cron           |

所有生产 agent 均额外包含记忆工具（memory_search/get/write/update/delete）。

---

## 11. 研发工程组（dev 系列）

### 11.1 dev-lead（项目开发总控）

**定位**：研发项目负责人，协调架构设计与代码实现。使用 medium 级别思考。

| 字段              | 值                               |
| ----------------- | -------------------------------- |
| `id`              | `dev-lead`                       |
| `name`            | 项目开发总控                     |
| `model`           | `anthropic/claude-sonnet-4-6`    |
| `thinkingDefault` | `medium`                         |
| `workspace`       | `~/.openclaw/workspace-dev-lead` |

**Subagents（可调度）**：`system-architect`、`codex-builder`、`codex-acp-builder`

**工具（profile: minimal + allow）**：

```
minimal profile 基础工具集，并额外允许：
read, agents_list, sessions_spawn, sessions_list, sessions_history,
web_search, web_fetch,
memory_search, memory_get, memory_write, memory_update, memory_delete
```

---

### 11.2 system-architect（系统分析与架构）

**定位**：负责技术分析与架构设计，使用高思考深度，只读模式。

| 字段              | 值                                       |
| ----------------- | ---------------------------------------- |
| `id`              | `system-architect`                       |
| `model`           | `anthropic/claude-sonnet-4-6`            |
| `thinkingDefault` | `high`                                   |
| `workspace`       | `~/.openclaw/workspace-system-architect` |

**工具（profile: minimal + allow）**：

```
read, web_search, web_fetch,
memory_search, memory_get, memory_write, memory_update, memory_delete
```

（无 write/edit/exec 权限，纯分析角色）

---

### 11.3 codex-builder（代码实现工程师）

**定位**：高质量代码实现，使用 OpenAI Codex 模型，高思考深度，不能调度 subagents。

| 字段              | 值                                    |
| ----------------- | ------------------------------------- |
| `id`              | `codex-builder`                       |
| `model`           | `openai-codex/gpt-5.4`                |
| `thinkingDefault` | `high`                                |
| `workspace`       | `~/.openclaw/workspace-codex-builder` |

**工具配置**（profile + deny + alsoAllow）：

```json
{
  "profile": "coding",
  "deny": [
    "sessions_spawn",
    "subagents",
    "agents_list",
    "sessions_send",
    "sessions_list",
    "sessions_history",
    "sessions_yield"
  ],
  "alsoAllow": ["memory_search", "memory_get", "memory_write", "memory_update", "memory_delete"]
}
```

- 继承 `coding` profile 的完整代码开发工具集
- 禁用所有 session/subagent 相关能力（只做代码，不调度）
- 通过 alsoAllow 追加记忆工具

---

### 11.4 codex-acp-builder（ACP代码实现工程师）

**定位**：通过 ACP（Agent Communication Protocol）运行的 Codex 编码工程师，持久化 runtime 模式。

| 字段              | 值                                        |
| ----------------- | ----------------------------------------- |
| `id`              | `codex-acp-builder`                       |
| `model`           | `openai-codex/gpt-5.4`                    |
| `thinkingDefault` | `high`                                    |
| `workspace`       | `~/.openclaw/workspace-codex-acp-builder` |

**工具配置**：与 `codex-builder` 相同

**ACP Runtime 配置**：

```json
"runtime": {
  "type": "acp",
  "acp": {
    "agent": "codex",
    "backend": "acpx",
    "mode": "persistent",
    "cwd": "/Users/qiguang/openclaw"
  }
}
```

- `type: acp`：通过 ACP 协议运行
- `backend: acpx`：使用 acpx 后端
- `mode: persistent`：持久化模式，保持进程存活
- `cwd`：工作目录固定在 openclaw 仓库根

---

## 12. 独立 Agent

### 12.1 ai-content-workflow（AI内容创作工作流）

**定位**：跨平台内容创作工作流，整合公众号+抖音+飞书的内容生产能力。

| 字段        | 值                                                |
| ----------- | ------------------------------------------------- |
| `id`        | `ai-content-workflow`                             |
| `model`     | `anthropic/claude-sonnet-4-6`                     |
| `workspace` | `/Users/qiguang/claude-agent/ai-content-workflow` |

**知识路径**：

- `/Users/qiguang/openclaw/.agents/knowledge/pub` — 公众号知识
- `/Users/qiguang/openclaw/.agents/knowledge/douyin` — 抖音知识
- `/Users/qiguang/aibiji-obssidian/03_Present/AI技术学习/ai提效` — AI 效率笔记

**Skills**：`content-strategy`、`analyze`

**工具**：

```
文件: read, write, edit
执行: exec, process
消息: message, feishu_im_user_message, feishu_ask_user_question
飞书数据: feishu_sheet, feishu_bitable_app_table_record
网络: web_search, web_fetch
会话: sessions_spawn, sessions_list, sessions_send
调度: cron
记忆: memory_search, memory_get, memory_write, memory_update, memory_delete
```

---

## 13. 知识目录结构

```
/Users/qiguang/openclaw/.agents/knowledge/
├── common/                          ← 所有 agent 共享知识（via defaults.memorySearch.extraPaths）
│   ├── README.md
│   └── 记忆工具使用行为协议V1.md      ← 所有 agent 的记忆使用行为指引
├── jarvis/                          ← 贾维斯（openclaw-optimizer）专属
│   ├── README.md
│   ├── agents配置说明文档V1.md        ← 本文档
│   ├── mempalace记忆系统技术架构和配置说明文档V1.md
│   ├── openclaw优化配置说明V1.md
│   ├── openclaw目录文件说明文档V1.md
│   └── 记忆工具使用行为协议V1.md
├── finance/                         ← 财务相关知识（仅贾维斯可访问）
├── pub/
│   ├── lead/                        ← pub-chief 知识
│   ├── topic/                       ← pub-topic 知识
│   ├── topic-theme/                 ← pub-topic-theme 知识
│   ├── write/                       ← pub-write 知识
│   ├── fact/                        ← pub-fact 知识
│   ├── style/                       ← pub-style 知识
│   ├── score/                       ← pub-score 知识
│   └── fix/                         ← pub-fix 知识
└── douyin/
    ├── lead/                        ← dy-chief 知识
    ├── benchmark/                   ← dy-benchmark 知识
    ├── script/                      ← dy-script 知识
    ├── video/                       ← dy-video 知识
    ├── review/                      ← dy-review 知识
    └── score/                       ← dy-score 知识
```

**知识路径工作机制**：

1. agent `memorySearch.extraPaths` 中的 Markdown 文件在会话启动时加载到 bootstrap context
2. 这些文件是 agent 的"长期专业知识"，无需每次搜索
3. `common/` 目录通过 `agents.defaults.memorySearch.extraPaths` 对所有 agent 生效

---

## 14. Agent 配置速查表

| Agent ID               | 名称           | 模型           | 特殊能力                 | 可调度子 agent      |
| ---------------------- | -------------- | -------------- | ------------------------ | ------------------- |
| `openclaw-optimizer`   | 贾维斯         | sonnet         | 全功能 + MemPalace 原生  | 无                  |
| `jarvis-browser`       | 浏览器专家     | sonnet         | 浏览器自动化             | —                   |
| `jarvis-feishu`        | 飞书专家       | cheap          | 全套飞书 API             | —                   |
| `jarvis-memory`        | 记忆专家       | cheap          | 记忆读写+文件            | —                   |
| `jarvis-memory-admin`  | 记忆管理       | cheap          | 记忆读写（无网络）       | —                   |
| `jarvis-media`         | 媒体专家       | doubao-pro     | 图/音/视频/TTS/PDF       | —                   |
| `jarvis-scheduler`     | 调度专家       | cheap          | cron + 消息              | —                   |
| `pub-chief`            | 公众号 lead    | sonnet         | 调度 7 个 pub-\*         | 7 个 pub 专职       |
| `pub-topic`            | 选题           | cheap          | content-strategy         | —                   |
| `pub-topic-theme`      | 主题发现       | cheap          | content-strategy         | —                   |
| `pub-write`            | 内容创作       | doubao         | content-writer           | —                   |
| `pub-fact`             | 事实审查       | cheap          | verify-claims            | —                   |
| `pub-style`            | 文风审查       | doubao         | edit                     | —                   |
| `pub-score`            | 评分           | mini           | —                        | —                   |
| `pub-fix`              | 修复           | cheap          | edit + humanizer-zh      | —                   |
| `dy-chief`             | 抖音 lead      | sonnet         | 调度 5 个 dy-\*          | 5 个 dy 专职        |
| `dy-benchmark`         | 对标拆解       | cheap          | —                        | —                   |
| `dy-script`            | 标题脚本       | doubao         | —                        | —                   |
| `dy-video`             | 短视频生成     | doubao-pro     | —                        | —                   |
| `dy-review`            | 短视频审查     | mini           | —                        | —                   |
| `dy-score`             | 评分           | cheap          | —                        | —                   |
| `comic-team-lead`      | 漫剧团队领导   | sonnet         | 飞书 + cron              | comic-director, ops |
| `operations-assistant` | 运营助理       | cheap          | feishu_sheet + cron      | —                   |
| `comic-director`       | 漫剧生产总监   | sonnet         | 调度 9 个生产 agent      | 9 个生产专职        |
| `script-analyzer`      | 剧本分析       | sonnet         | pdf                      | —                   |
| `character-designer`   | 角色设计       | doubao-pro     | image_generate           | —                   |
| `scene-planner`        | 场景规划       | doubao-pro     | image + image_generate   | —                   |
| `storyboard-generator` | 分镜生成       | cheap          | —                        | —                   |
| `image-generator`      | 图像生成       | doubao-pro     | image_generate + process | —                   |
| `audio-synthesizer`    | 音频合成       | mini           | tts + music_generate     | —                   |
| `video-compositor`     | 视频合成       | cheap          | video_generate + process | —                   |
| `quality-reviewer`     | 质量审查       | sonnet         | image + process          | —                   |
| `release-manager`      | 发布管理       | sonnet         | message + cron           | —                   |
| `dev-lead`             | 开发总控       | sonnet(medium) | 调度 3 个研发 agent      | 3 个研发专职        |
| `system-architect`     | 系统架构       | sonnet(high)   | 只读分析                 | —                   |
| `codex-builder`        | 代码工程师     | codex(high)    | coding profile           | —                   |
| `codex-acp-builder`    | ACP代码工程师  | codex(high)    | coding + ACP runtime     | —                   |
| `ai-content-workflow`  | 内容创作工作流 | sonnet         | 飞书+会话+cron           | —                   |

---

## 15. 常见运维操作

### 15.1 重启网关

```bash
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

### 15.2 验证 Agent 配置有效性

```bash
# 检查所有 agent 是否有完整记忆工具
python3 << 'EOF'
import json
with open("/Users/qiguang/.openclaw/openclaw.json") as f:
    config = json.load(f)
MEMORY_TOOLS = {"memory_search","memory_get","memory_write","memory_update","memory_delete"}
for a in config["agents"]["list"]:
    effective = set(a.get("tools",{}).get("allow",[]) + a.get("tools",{}).get("alsoAllow",[]))
    missing = MEMORY_TOOLS - effective
    print(f"{'✓' if not missing else '✗'} {a['id']}")
EOF
```

### 15.3 查看 agent 记忆状态

```bash
# openclaw-optimizer 的 MemPalace 状态
openclaw memory status --agent openclaw-optimizer

# 语义搜索
openclaw memory search "用户偏好" --agent openclaw-optimizer

# Dreaming 状态
openclaw memory dream status --agent openclaw-optimizer
```

### 15.4 新增 Agent 模板

在 `openclaw.json` 的 `agents.list` 中追加：

```json
{
  "id": "my-new-agent",
  "name": "新 Agent",
  "workspace": "/Users/qiguang/.openclaw/workspace-my-new-agent",
  "model": "deepseek/deepseek-chat",
  "memorySearch": {
    "extraPaths": ["/Users/qiguang/openclaw/.agents/knowledge/my-new-agent"]
  },
  "tools": {
    "allow": [
      "read",
      "write",
      "memory_search",
      "memory_get",
      "memory_write",
      "memory_update",
      "memory_delete"
    ]
  }
}
```

对应知识目录：

```bash
mkdir -p /Users/qiguang/openclaw/.agents/knowledge/my-new-agent
```

---

## 16. 变更历史

| 日期       | 变更                  | 说明                                                       |
| ---------- | --------------------- | ---------------------------------------------------------- |
| 2026-04-14 | 批量添加记忆工具      | 38 个 agent 全部获得 memory_search/get/write/update/delete |
| 2026-04-14 | 添加 common 知识目录  | 记忆工具使用行为协议 V1 对所有 agent 生效                  |
| 2026-04-14 | 创建本文档            | agents 配置说明文档 V1                                     |
| 2026-04-13 | MemPalace 主路径统一  | 从 memory-core 迁移到 mempalace-memory 插件                |
| 2026-04-12 | 各 agent 知识路径建立 | pub/dy/jarvis 专属知识目录创建                             |
