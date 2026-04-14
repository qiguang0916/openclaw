---
name: deep-learning-knowledge-base
description: 深度学习知识库生成 — 分析B站视频/文章内容，深入学习涉及工具的官方文档/源码，提炼真正可落地的使用方法、提效技巧、避坑指南，输出符合本地知识库规范的学习文章
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "trigger_phrases":
          ["学习这个视频", "深度拆解", "真正理解", "工具组合", "落地教程", "提效技巧", "避坑指南"],
        "requires": { "bins": ["python3"] },
      },
  }
---

# 🧠 Deep Learning Knowledge Base Skill v2.1

**核心理念**：不是整理笔记，是真正学会一个工具组合，然后写出能教人落地的文章。

**规范依据**：视频资料学习知识库内容整理规则 v2.0

## 文件命名规范

```
YYYYMMDD-主题-教程拆解-清洗后的标题.md
```

例：`20260410-知识管理-教程拆解-文本内容分析.md`

## Frontmatter 属性（符合规范）

必须字段：`doc_id`, `title`, `source_type`, `type`, `note_status`, `topic`, `primary_stage`, `source_platform`, `source_url`, `created`, `updated`, `knowledge_stages`, `tags`

标签体系：

- `kb/` — 知识库分类
- `source/` — 来源类型
- `topic/` — 知识主题
- `platform/` — 来源平台
- `status/` — 处理状态
- `stage/` — 阶段标签
- `tech/` — 技术领域（API集成、数据流、自动化等）
- `keyword/` — 内容关键词

## 知识库存放位置

```
/Users/qiguang/aibiji-obssidian/03_Present/AI技术学习/ai提效/
```

## 工作流程

```
1. 获取视频/文章
2. 提取元数据（标题、作者、描述）
3. 识别涉及的工具
4. 推断知识主题和阶段
5. 生成符合规范的frontmatter
6. 构建十一章结构化学习文章
7. 保存到知识库目录
```

## 文章十一章结构

1. 教程基本信息
2. 教程核心内容
3. 技术要点解析
4. 深度技术细节（API、数据流转、配置部署）
5. 实操案例分析
6. 应用场景分析
7. 实施路径建议
8. 风险评估与应对
9. 成功指标定义
10. 相关资源推荐
11. 总结与展望

## 触发方式

```
学习这个视频 https://www.bilibili.com/video/BVxxxxx
```

贾维斯会自动：

1. 获取视频信息和描述
2. 识别涉及的工具（内置 40+ 工具库）
3. 从描述推断知识主题和阶段
4. 生成符合本地知识库规范的 frontmatter
5. 写出十一章结构化学习文章
6. 保存到 `~/aibiji-obssidian/03_Present/AI技术学习/ai提效/`

## 依赖

```bash
pip3 install requests beautifulsoup4 --break-system-packages
```

## 维护

- **版本**: 2.1（符合知识库规范 v2.0）
- **日期**: 2026-04-10
- **维护者**: 贾维斯 🧠
