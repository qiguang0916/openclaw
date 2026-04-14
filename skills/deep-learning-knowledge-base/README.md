# 🧠 Deep Learning Knowledge Base

深度学习知识库生成器 — B站视频 / 文章内容分析与知识库笔记生成

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Python](https://img.shields.io/badge/python-3.10+-blue)

## 功能特点

- 🎬 **B站视频解析** — 自动提取标题、作者、简介、标签
- 🔍 **智能工具识别** — 从内容中识别涉及的 AI 工具、框架、服务
- 📖 **官方文档抓取** — 自动访问工具官网获取文档摘要
- 📝 **Obsidian 笔记生成** — 输出双链兼容的 Markdown 知识库
- 🗂️ **分类存储** — 按来源自动分目录（bilibili / articles）

## 快速开始

### 1. 安装依赖

```bash
pip3 install requests beautifulsoup4 markdownify --break-system-packages
```

### 2. 查看帮助

```bash
python3 deep-learning-kb.py --help
```

### 3. 基本用法

```bash
# 分析 B站视频
python3 deep-learning-kb.py --source "https://www.bilibili.com/video/BV1uv411q7Mv"

# 直接指定 BVID
python3 deep-learning-kb.py --bvid "BV1uv411q7Mv"

# 分析网页文章
python3 deep-learning-kb.py --source "https://example.com/article" --type article

# 直接输入文本
python3 deep-learning-kb.py --content "这是一段介绍 Ollama 和 LangChain 的文本..."
```

## AI Agent 调用

将以下内容发给贾维斯：

```
学习这个视频：https://www.bilibili.com/video/BVxxxxx
然后把里面提到的工具都查一遍官方文档，
生成 Obsidian 笔记保存到知识库。
```

贾维斯会自动：

1. 获取视频信息
2. 识别涉及的工具
3. 抓取官方文档
4. 生成知识库笔记

## 触发短语

- "学习这个视频"
- "总结这篇文章"
- "生成知识库"
- "深度学习"
- "教程拆解"
- "技术分析"
- "Obsidian笔记"
- "视频内容分析"
- "提取技术要点"

## 支持的工具类型

| 类别        | 示例工具                                          |
| ----------- | ------------------------------------------------- |
| AI 大模型   | OpenAI, Claude, GPT-4, Gemini, Llama, Mistral     |
| 本地部署    | Ollama, vLLM, llama.cpp, LocalAI                  |
| AI 开发框架 | LangChain, LangGraph, LlamaIndex, AutoGPT, CrewAI |
| 向量数据库  | Pinecone, Weaviate, Chroma, Qdrant, Milvus        |
| 内容创作    | Notion, Obsidian, 飞书, 剪映                      |
| 开发工具    | Cursor, Claude Code, GitHub Copilot, Codex        |
| 语音/图像   | Whisper, FFmpeg, ElevenLabs, Midjourney, DALL-E   |
| 自动化      | Zapier, n8n                                       |

## 输出示例

生成的文件保存在 `knowledge_base/` 目录：

```
knowledge_base/
├── bilibili/
│   └── 「视频标题」学习笔记_20260410_142532.md
└── articles/
    └── 「文章标题」学习笔记_20260410_143015.md
```

## 笔记格式

生成的笔记符合 Obsidian 规范：

- YAML front matter 元数据
- 双链语法 `[[工具名称]]`
- 标签语法 `#工具 #教程`
- 代码块高亮

## 项目结构

```
deep-learning-knowledge-base/
├── SKILL.md                    # Skill 定义
├── README.md                   # 本文件
├── deep-learning-kb.py         # 核心脚本
├── templates/
│   └── note-template.md        # Obsidian 笔记模板
└── knowledge_base/             # 输出目录（自动创建）
    ├── bilibili/               # B站视频笔记
    └── articles/               # 文章笔记
```

## 注意事项

1. **尊重版权** — 仅做学习总结，不复制完整原始内容
2. **文档时效** — 工具文档可能更新，定期重新生成
3. **礼貌爬虫** — 已内置延迟，避免对目标网站造成压力
4. **知识验证** — 生成内容仅供参考，以官方文档为准

## 维护

- **版本**: 1.0.0
- **创建日期**: 2026-04-10
- **维护者**: 贾维斯 🧠
- **适用**: OpenClaw Agent
