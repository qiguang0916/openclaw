#!/usr/bin/env python3
"""
Deep Learning Knowledge Base Generator v2.2
新增：视频字幕获取 + Whisper 语音转文字
- yt-dlp 下载字幕
- faster-whisper 转录
- 完整内容分析
"""

import argparse
import json
import os
import re
import sys
import time
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    print("❌ 缺少 requests 库")
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("❌ 缺少 beautifulsoup4")
    sys.exit(1)

try:
    from bilibili import bilibili
except ImportError:
    bilibili = None

# ============ 配置 ============
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
TIMEOUT = 30
KB_ROOT = Path("/Users/qiguang/aibiji-obssidian/03_Present/AI技术学习/ai提效")
TEMP_DIR = Path(tempfile.gettempdir()) / "dl_kb"
TEMP_DIR.mkdir(exist_ok=True)


# ============ 工具深度信息库 ============
TOOL_DEEP_INFO = {
    "Claude": {
        "what_it_does": "Anthropic开发的AI助手，擅长深度分析、长文本理解、代码编写。不同于ChatGPT的对话式，Claude更适合作为'思考伙伴'。",
        "key_features": ["超长上下文（200K tokens）", "Anthropic API调用，支持function calling", "支持上传文件（PDF、代码、表格）", "Haiku/Sonnet/Opus三档模型"],
        "quick_start": "pip install anthropic",
        "best_practices": ["用.md文件写提示词，方便版本控制", "系统提示词设定角色和专业背景", "复杂任务分步骤", "用'请先思考，再回答'引导深度分析"],
        "common_pitfalls": ["上下文超过限制会被截断", "API调用有速率限制", "模型hallucination问题，关键信息要验证", "Sonnet性价比最高，Opus用于深度推理"],
        "docs_url": "https://docs.anthropic.com/claude/docs",
        "source_url": "https://github.com/anthropics/claude-code",
        "tech_tags": ["tech/api-integration", "tech/optimization"]
    },
    "Obsidian": {
        "what_it_does": "本地优先的笔记工具，核心是'双向链接'——让你的笔记像知识图谱一样互联。",
        "key_features": ["双向链接 [[笔记名]]", "本地存储Markdown", "社区插件生态（600+）", "图形化视图", "Dataview插件"],
        "quick_start": "1. 下载 obsidian.md\n2. 创建仓库\n3. 开始写笔记，用 [[标题]] 创建链接\n4. 安装 Templater, Dataview 等插件",
        "best_practices": ["一个笔记一个核心概念", "用 MOC 组织主题", "Daily Notes 临时想法", "标签粗分类，双链精确关联"],
        "common_pitfalls": ["插件装太多会卡", "双链不要嵌套太深，3层以内", "Dataview查询复杂", "图片过多影响启动速度"],
        "docs_url": "https://help.obsidian.md",
        "tech_tags": ["tech/data-flow", "tech/deployment"]
    },
    "Cursor": {
        "what_it_does": "基于VS Code的AI代码编辑器，深度集成Claude/GPT-4。特点是'AI原生'设计。",
        "key_features": ["Composer多文件编辑", "Tab智能补全", "Chat全项目问答", "Rules for AI", "Codebase索引"],
        "quick_start": "1. 下载 cursor.sh\n2. Cmd+K 打开AI编辑\n3. Cmd+L 打开Chat\n4. Settings → Models 选择模型",
        "best_practices": [".cursorrules 定义项目规范", "Composer适合复杂重构", "Tab补全要等一下", "多用Chat问代码逻辑"],
        "common_pitfalls": ["AI生成代码要审查", "免费版有使用限额", "Composer多文件有时遗漏", ".cursorrules写太复杂会困惑"],
        "docs_url": "https://www.cursor.com/docs",
        "tech_tags": ["tech/automation", "tech/coding"]
    },
    "Ollama": {
        "what_it_does": "本地运行大模型的工具，一条命令跑Llama/Mistral等模型。核心是隐私和免费。",
        "key_features": ["ollama run llama3.2", "REST API", "模型管理pull/list/run/rm", "跨平台"],
        "quick_start": "curl -fsSL https://ollama.com/install.sh | sh\nollama run llama3.2",
        "best_practices": ["确保磁盘空间（7B约4GB）", "GPU加速需要CUDA", "ollama pull后台下载", "API调用批量处理"],
        "common_pitfalls": ["Mac M系列自动GPU，Intel需手动配置", "量化省空间但质量下降", "默认端口11434可能被占用", "中文强模型：qwen、yi、chatglm"],
        "docs_url": "https://github.com/ollama/ollama",
        "tech_tags": ["tech/deployment", "tech/api-integration"]
    },
    "LangChain": {
        "what_it_does": "构建AI应用的框架，核心是'链'——把大模型、工具、记忆串起来。",
        "key_features": ["Chains可组合任务链", "Agents自主决策", "Memory对话历史", "Tool calling", "RAG支持"],
        "quick_start": "pip install langchain langchain-openai langchain-community",
        "best_practices": ["用LCEL写链更直观", "Tool设计成幂等的", "Memory按需选择", "复杂逻辑LCEL组合"],
        "common_pitfalls": ["版本迭代快，文档可能过时", "过早优化反而复杂", "Tool描述要清晰", "调试困难，从最小链开始"],
        "docs_url": "https://python.langchain.com/docs",
        "source_url": "https://github.com/langchain-ai/langchain",
        "tech_tags": ["tech/api-integration", "tech/data-flow"]
    },
    "Notion": {
        "what_it_does": "All-in-one workspace——文档、数据库、wiki、项目管理合一。",
        "key_features": ["Block编辑", "Database多视图", "API完整REST", "Templates模板", "跨平台同步"],
        "quick_start": "pip install notion-client\nfrom notion_client import AsyncClient",
        "best_practices": ["Database组织结构化", "API异步注意await", "Block ID从URL获取", "官方Python SDK更方便"],
        "common_pitfalls": ["API速率限制3req/sec", "子页面关系处理", "Rich text类型多", "不是所有block类型都被API支持"],
        "docs_url": "https://developers.notion.com/docs/getting-started",
        "tech_tags": ["tech/api-integration", "tech/automation"]
    },
    "Dify": {
        "what_it_does": "开源LLM应用开发平台，提供Agent编排到RAG部署的完整链路。",
        "key_features": ["可视化Agent编排", "内置RAG流程", "多模型支持", "API一键发布", "团队协作"],
        "quick_start": "git clone https://github.com/langgenius/dify.git\ncd dify/docker\ndocker compose up -d",
        "best_practices": ["先可视化编排确认流程", "文档切分策略影响RAG效果", "工作流处理复杂逻辑", "生产环境配nginx反向代理"],
        "common_pitfalls": ["单机部署资源消耗大", "文档上传有大小限制", "RAG检索质量不稳定", "开源版没有SSO"],
        "docs_url": "https://docs.dify.ai",
        "source_url": "https://github.com/langgenius/dify",
        "tech_tags": ["tech/deployment", "tech/data-flow", "tech/automation"]
    },
    "飞书": {
        "what_it_does": "字节跳动出品的协作平台，整合IM、文档、知识库、日历、视频会议。",
        "key_features": ["多维表格", "知识库", "自动化流程", "开放平台API", "多语言支持"],
        "quick_start": "pip install lark-oapi\nfrom lark import Feishu",
        "best_practices": ["多维表格管理结构化数据", "知识库放团队规范", "飞书机器人做通知", "审批流配合API实现自动化"],
        "common_pitfalls": ["多维表格字段类型选错难查", "API权限需企业认证", "文档过多搜索不精准", "免费版有功能限制"],
        "docs_url": "https://www.feishu.cn/hc",
        "tech_tags": ["tech/api-integration", "tech/automation"]
    },
    "剪映": {
        "what_it_does": "字节跳动出品的视频剪辑工具，AI辅助功能强大，适合短视频创作。",
        "key_features": ["AI字幕自动识别", "AI配音", "视频模板", "一键成片", "跨平台（手机/电脑）"],
        "quick_start": "下载剪映App或桌面版，导入素材，使用AI功能自动剪辑",
        "best_practices": ["AI字幕先校对再发布", "用模板保持风格统一", "关键帧做精细控制", "导出前调色统一"],
        "common_pitfalls": ["AI识别有误差，专业内容需人工校对", "模板依赖可能导致创意局限", "移动端导出质量有时不如桌面版", "会员专属功能需付费"],
        "docs_url": "https://www.capcut.com",
        "tech_tags": ["tech/automation", "tech/content-creation"]
    }
}


# ============ 字幕获取 ============
def get_bilibili_subtitle(bvid: str) -> dict:
    """
    尝试获取B站视频字幕/弹幕
    方法1: yt-dlp 获取字幕
    方法2: bilibili API 获取字幕
    """
    result = {"success": False, "subtitles": "", "danmaku": "", "method": ""}
    
    # 方法1: yt-dlp 获取字幕
    print(f"  🎬 尝试用 yt-dlp 获取字幕...")
    try:
        cmd = [
            "yt-dlp",
            "--write-subs", "--write-auto-subs",
            "--sub-lang", "zh-CN,zh-Hans,zh,ai-zh",
            "--skip-download", "--print", "%(subs)s",
            f"https://www.bilibili.com/video/{bvid}"
        ]
        # 直接获取可用字幕列表
        cmd_list = [
            "yt-dlp", "--list-subs",
            f"https://www.bilibili.com/video/{bvid}"
        ]
        proc = subprocess.run(cmd_list, capture_output=True, text=True, timeout=30)
        if " zh " in proc.stdout or "zh-CN" in proc.stdout or "zh-Hans" in proc.stdout:
            print(f"  ✅ yt-dlp 发现字幕，开始下载...")
            with tempfile.TemporaryDirectory() as tmpdir:
                cmd_download = [
                    "yt-dlp",
                    "--write-subs", "--write-auto-subs",
                    "--sub-lang", "zh-CN,zh-Hans,zh",
                    "--convert-subs", "srt",
                    "-o", f"{tmpdir}/%(id)s.%(ext)s",
                    f"https://www.bilibili.com/video/{bvid}"
                ]
                sub_proc = subprocess.run(cmd_download, capture_output=True, text=True, timeout=120)
                # 读取字幕文件
                for f in Path(tmpdir).iterdir():
                    if f.suffix in [".srt", ".vtt", ".ass"]:
                        result["subtitles"] = f.read_text(encoding="utf-8")
                        result["success"] = True
                        result["method"] = "yt-dlp subtitles"
                        print(f"  ✅ 字幕获取成功 ({f.name}, {len(result['subtitles'])} 字符)")
                        return result
    except Exception as e:
        print(f"  ⚠️ yt-dlp 字幕获取失败: {e}")
    
    # 方法2: yt-dlp 获取视频音频，用 Whisper 转录
    print(f"  🎬 尝试下载音频并转录...")
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = f"{tmpdir}/audio"
            cmd_audio = [
                "yt-dlp",
                "-f", "bestaudio[ext=m4a]",
                "-o", f"{audio_path}.%(ext)s",
                "--extract-audio",
                f"https://www.bilibili.com/video/{bvid}"
            ]
            audio_proc = subprocess.run(cmd_audio, capture_output=True, text=True, timeout=300)
            
            # 找下载的音频文件
            for ext in ["m4a", "mp3", "wav", "webm"]:
                audio_file = Path(f"{audio_path}.{ext}")
                if audio_file.exists():
                    print(f"  🎵 音频下载成功: {audio_file}")
                    sub_result = transcribe_audio(str(audio_file))
                    if sub_result["success"]:
                        result = sub_result
                        result["method"] = "whisper transcription"
                        return result
                    break
    except Exception as e:
        print(f"  ⚠️ 音频下载/转录失败: {e}")
    
    return result


def transcribe_audio(audio_path: str) -> dict:
    """用 faster-whisper 转录音频"""
    result = {"success": False, "subtitles": "", "method": ""}
    
    try:
        from faster_whisper import WhisperModel
        
        print(f"  🎤 开始 Whisper 转录...")
        # 使用 small 模型，平衡速度和准确度
        model = WhisperModel("small", device="auto", compute_type="auto")
        
        segments, info = model.transcribe(audio_path, language="zh", beam_size=5)
        
        lines = []
        for seg in segments:
            text = seg.text.strip()
            if text:
                start_h = int(seg.start // 3600)
                start_m = int((seg.start % 3600) // 60)
                start_s = int(seg.start % 60)
                lines.append(f"[{start_h:02d}:{start_m:02d}:{start_s:02d}] {text}")
        
        if lines:
            result["success"] = True
            result["subtitles"] = "\n".join(lines)
            result["method"] = "faster-whisper"
            print(f"  ✅ Whisper 转录成功 ({len(result['subtitles'])} 字符)")
        else:
            print(f"  ⚠️ Whisper 转录结果为空")
            
    except ImportError:
        print(f"  ⚠️ faster-whisper 未安装，跳过转录")
    except Exception as e:
        print(f"  ⚠️ Whisper 转录失败: {e}")
    
    return result


# ============ 标题清洗 ============
def clean_title(title: str) -> str:
    platform_tails = ["哔哩哔哩", "bilibili", "Bilibili", "B站", "小红书", "抖音", "快手", "腾讯视频", "优酷", "爱奇艺", "YouTube", "youtube", "微信公众号"]
    for tail in platform_tails:
        title = title.replace(tail, "")
    title = re.sub(r'【[^】]*】', '', title)
    title = re.sub(r'\[[^\]]*\]', '', title)
    title = re.sub(r'（[^）]*）', '', title)
    title = re.sub(r'\([^\)]*\)', '', title)
    title = re.sub(r'[^\w\s\u4e00-\u9fff.,，、;；:：!！?？-]', '', title)
    title = re.sub(r'\s+', ' ', title).strip()
    title = title.strip('-_–— ')
    return title if title else "未命名教程"


def generate_filename(date_str: str, topic: str, title: str) -> str:
    safe_title = re.sub(r'[^\w\s\u4e00-\u9fff-]', '', title)
    safe_title = re.sub(r'\s+', '-', safe_title)[:30]
    topic_clean = re.sub(r'[^\w\u4e00-\u9fff-]', '', topic)
    return f"{date_str}-{topic_clean}-教程拆解-{safe_title}.md"


# ============ 工具识别 ============
def identify_tools(text: str) -> list[dict]:
    KNOWN_TOOLS = {
        "Claude": {"name": "Claude", "category": "AI助手", "url": "https://claude.ai"},
        "Obsidian": {"name": "Obsidian", "category": "笔记工具", "url": "https://obsidian.md"},
        "Cursor": {"name": "Cursor", "category": "代码编辑器", "url": "https://cursor.sh"},
        "Ollama": {"name": "Ollama", "category": "本地大模型", "url": "https://ollama.com"},
        "LangChain": {"name": "LangChain", "category": "AI开发框架", "url": "https://python.langchain.com"},
        "Notion": {"name": "Notion", "category": "协作工具", "url": "https://notion.so"},
        "OpenAI": {"name": "OpenAI", "category": "AI平台", "url": "https://platform.openai.com"},
        "ChatGPT": {"name": "ChatGPT", "category": "AI助手", "url": "https://chat.openai.com"},
        "GitHub Copilot": {"name": "GitHub Copilot", "category": "代码补全", "url": "https://github.com/features/copilot"},
        "Codex": {"name": "OpenAI Codex", "category": "代码AI", "url": "https://platform.openai.com/codex"},
        "Gemini": {"name": "Gemini", "category": "AI大模型", "url": "https://ai.google.dev"},
        "vLLM": {"name": "vLLM", "category": "推理框架", "url": "https://docs.vllm.ai"},
        "Whisper": {"name": "Whisper", "category": "语音识别", "url": "https://github.com/openai/whisper"},
        "FFmpeg": {"name": "FFmpeg", "category": "多媒体处理", "url": "https://ffmpeg.org"},
        "ElevenLabs": {"name": "ElevenLabs", "category": "语音合成", "url": "https://elevenlabs.io"},
        "RAG": {"name": "RAG", "category": "检索增强生成", "url": ""},
        "Pinecone": {"name": "Pinecone", "category": "向量数据库", "url": "https://www.pinecone.io"},
        "Chroma": {"name": "Chroma", "category": "向量数据库", "url": "https://docs.trychroma.com"},
        "Weaviate": {"name": "Weaviate", "category": "向量数据库", "url": "https://weaviate.io"},
        "Midjourney": {"name": "Midjourney", "category": "AI图像", "url": "https://docs.midjourney.com"},
        "Stable Diffusion": {"name": "Stable Diffusion", "category": "AI图像", "url": "https://github.com/AUTOMATIC1111/stable-diffusion-webui"},
        "DALL-E": {"name": "DALL-E", "category": "AI图像", "url": "https://platform.openai.com/docs/guides/images"},
        "FLUX": {"name": "FLUX", "category": "AI图像", "url": "https://blackforestlabs.io"},
        "飞书": {"name": "飞书", "category": "协作工具", "url": "https://www.feishu.cn"},
        "剪映": {"name": "剪映", "category": "视频剪辑", "url": "https://www.capcut.com"},
        "Zapier": {"name": "Zapier", "category": "自动化", "url": "https://zapier.com"},
        "n8n": {"name": "n8n", "category": "自动化", "url": "https://n8n.io"},
        "AutoGPT": {"name": "AutoGPT", "category": "AI Agent", "url": "https://docs.agpt.co"},
        "CrewAI": {"name": "CrewAI", "category": "AI Agent", "url": "https://docs.crewai.com"},
        "LlamaIndex": {"name": "LlamaIndex", "category": "数据框架", "url": "https://docs.llamaindex.ai"},
        "Dify": {"name": "Dify", "category": "AI应用平台", "url": "https://docs.dify.ai"},
        "AnythingLLM": {"name": "AnythingLLM", "category": "RAG应用", "url": "https://anythingllm.com"},
        "Perplexity": {"name": "Perplexity", "category": "AI搜索", "url": "https://perplexity.ai"},
        "OpenHands": {"name": "OpenHands", "category": "AI编码助手", "url": "https://openhands.ai"},
        "公众号": {"name": "公众号", "category": "内容平台", "url": ""},
        "小红书": {"name": "小红书", "category": "内容平台", "url": ""},
        "抖音": {"name": "抖音", "category": "内容平台", "url": ""},
        "视频号": {"name": "视频号", "category": "内容平台", "url": ""},
        "bilibili": {"name": "Bilibili", "category": "内容平台", "url": "https://bilibili.com"},
    }
    
    found = []
    text_lower = text.lower()
    
    for key, info in KNOWN_TOOLS.items():
        if key.lower() in text_lower:
            deep = TOOL_DEEP_INFO.get(info["name"], {})
            found.append({
                "name": info["name"],
                "category": info["category"],
                "url": info["url"],
                "what_it_does": deep.get("what_it_does", ""),
                "key_features": deep.get("key_features", []),
                "quick_start": deep.get("quick_start", ""),
                "best_practices": deep.get("best_practices", []),
                "common_pitfalls": deep.get("common_pitfalls", []),
                "docs_url": deep.get("docs_url", info["url"]),
                "source_url": deep.get("source_url", ""),
                "tech_tags": deep.get("tech_tags", []),
                "mentions": text_lower.count(key.lower())
            })
    
    seen = set()
    unique = []
    for t in found:
        if t["name"] not in seen:
            seen.add(t["name"])
            unique.append(t)
    unique.sort(key=lambda x: x["mentions"], reverse=True)
    return unique


# ============ 主题推断 ============
def infer_topic_and_stages(text: str, tools: list) -> tuple[str, list, list]:
    text_lower = text.lower()
    tool_names = [t["name"] for t in tools]
    
    # 推断主题
    topic = "综合技能"
    
    if any(t in text_lower for t in ["rag", "检索", "知识库", "向量", "文档", "anythingllm", "dify"]):
        topic = "AI+RAG知识库"
    elif any(t in text_lower for t in ["代码", "编程", "cursor", "copilot", "github", "openhands"]):
        topic = "AI编程助手"
    elif any(t in text_lower for t in ["笔记", "obsidian", "notion", "知识管理", "双链"]):
        topic = "知识管理"
    elif any(t in text_lower for t in ["视频", "剪辑", "剪映", "字幕", "创作", "内容", "抖音", "小红书", "公众号", "b站", "bilibili"]):
        topic = "内容创作"
    elif any(t in text_lower for t in ["公众号", "涨粉", "爆款", "变现", "运营", "增长"]):
        topic = "内容运营"
    elif any(t in text_lower for t in ["部署", "本地", "ollama", "vllm", "localai"]):
        topic = "AI本地部署"
    elif any(t in text_lower for t in ["自动化", "工作流", "zapier", "n8n", "飞书"]):
        topic = "AI自动化"
    elif any(t in text_lower for t in ["图像", "midjourney", "stable", "dall-e", "flux", "绘画"]):
        topic = "AI图像创作"
    elif any(t in text_lower for t in ["语音", "whisper", "tts", "elevenlabs", "配音"]):
        topic = "AI语音处理"
    
    # 推断阶段
    stages = []
    if any(w in text_lower for w in ["安装", "下载", "环境", "配置", "注册", "账号"]):
        stages.append("环境准备")
    if any(w in text_lower for w in ["使用", "应用", "实战", "操作", "步骤", "方法"]):
        stages.append("应用实践")
    if any(w in text_lower for w in ["优化", "提效", "进阶", "高级", "技巧"]):
        stages.append("优化进阶")
    if any(w in text_lower for w in ["变现", "赚钱", "收益", "商业化", "收入"]):
        stages.append("变现赚钱")
    if not stages:
        stages = ["入门基础", "应用实践"]
    
    # 关键词
    keywords = []
    for t in tools:
        keywords.append(t["name"])
        if t.get("tech_tags"):
            keywords.extend([tag.replace("tech/", "") for tag in t["tech_tags"]])
    
    return topic, list(set(stages)), list(set(keywords))[:10]


# ============ B站视频解析 + 字幕获取 ============
def parse_bilibili_video(bvid: str, fetch_subtitles: bool = True) -> dict:
    """解析B站视频信息，并尝试获取字幕"""
    url = f"https://www.bilibili.com/video/{bvid}"
    video_info = {
        "bvid": bvid,
        "url": url,
        "title": "",
        "up_name": "未知UP主",
        "description": "",
        "tags": [],
        "subtitles": "",
        "subtitle_method": "",
        "source_platform": "bilibili",
        "source_type": "视频教程",
        "success": False
    }
    
    try:
        print(f"🎬 正在获取 B站视频信息: {bvid}")
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        
        soup = BeautifulSoup(resp.text, "html.parser")
        
        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True).replace("哔哩哔哩 (゜-゜)つロ 干杯~-bilibili", "").strip() if title_tag else ""
        video_info["title"] = clean_title(title) if title else "未知标题"
        
        meta_desc = soup.find("meta", attrs={"name": "description"})
        video_info["description"] = meta_desc["content"] if meta_desc else ""
        
        up_elem = soup.find("a", class_=re.compile(r"up-name"))
        if up_elem:
            video_info["up_name"] = up_elem.get_text(strip=True)
        
        tag_elems = soup.find_all("li", class_=re.compile(r"tag"))
        for tag in tag_elems[:5]:
            t = tag.get_text(strip=True)
            if t and t != "标签":
                video_info["tags"].append(t)
        
        video_info["success"] = True
        print(f"  ✅ 视频信息获取成功: {video_info['title']}")
        print(f"     UP主: {video_info['up_name']}")
        
    except Exception as e:
        print(f"  ⚠️ 视频信息获取失败: {e}")
        video_info["title"] = f"B站视频_{bvid}"
    
    # 尝试获取字幕
    if fetch_subtitles:
        print(f"\n  📝 正在获取视频字幕...")
        sub_result = get_bilibili_subtitle(bvid)
        if sub_result["success"]:
            video_info["subtitles"] = sub_result["subtitles"]
            video_info["subtitle_method"] = sub_result["method"]
            print(f"  ✅ 字幕获取成功 (方法: {sub_result['method']}, 长度: {len(sub_result['subtitles'])} 字符)")
        else:
            print(f"  ⚠️ 字幕获取失败，将使用描述分析")
    
    return video_info


# ============ 内容分析（基于字幕） ============
def analyze_content(video_info: dict, tools: list) -> dict:
    """基于字幕内容做深度分析"""
    subtitles = video_info.get("subtitles", "")
    description = video_info.get("description", "")
    
    # 合并文本用于分析
    analysis_text = subtitles if subtitles else description
    
    if not analysis_text:
        return {
            "core_points": "（视频内容无法获取，请观看原视频）",
            "efficiency_tips": [],
            "pitfalls": [],
            "practical_steps": []
        }
    
    analysis = {
        "core_points": "",
        "efficiency_tips": [],
        "pitfalls": [],
        "practical_steps": []
    }
    
    # 简单的关键词提取和模式匹配
    text_lower = analysis_text.lower()
    
    # 提取核心要点（取字幕前30%和后30%的内容）
    lines = analysis_text.split("\n")
    if len(lines) > 5:
        first_part = " ".join(lines[:max(3, len(lines)//3)])[:500]
        last_part = " ".join(lines[-max(3, len(lines)//3):])[:500]
        analysis["core_points"] = f"（开头）{first_part}...\n（结尾）{last_part}"
    else:
        analysis["core_points"] = analysis_text[:800]
    
    # 提效相关
    efficiency_keywords = ["提效", "省时间", "快", "效率", "缩短", "减少", "自动", "批量", "一键"]
    for kw in efficiency_keywords:
        if kw in text_lower:
            idx = text_lower.find(kw)
            start = max(0, idx - 30)
            end = min(len(analysis_text), idx + 50)
            context = analysis_text[start:end]
            if context and context not in analysis["efficiency_tips"]:
                analysis["efficiency_tips"].append(f"提到'{kw}': ...{context}...")
    
    # 坑点相关
    pitfall_keywords = ["坑", "注意", "误区", "错误", "失败", "问题", "陷阱", "不要", "避免", "别"]
    for kw in pitfall_keywords:
        if kw in text_lower:
            idx = text_lower.find(kw)
            start = max(0, idx - 20)
            end = min(len(analysis_text), idx + 60)
            context = analysis_text[start:end]
            if context and context not in analysis["pitfalls"]:
                analysis["pitfalls"].append(f"...{context}...")
    
    # 步骤相关
    step_keywords = ["第一步", "第二步", "首先", "然后", "接下来", "最后", "首先", "其次", "一要", "二要"]
    for kw in step_keywords:
        if kw in text_lower:
            idx = text_lower.find(kw)
            start = max(0, idx - 10)
            end = min(len(analysis_text), idx + 80)
            context = analysis_text[start:end]
            if context and len(context) > 10 and context not in analysis["practical_steps"]:
                analysis["practical_steps"].append(context)
    
    return analysis


# ============ 生成学习文章 ============
def generate_knowledge_note(video_info: dict, tools: list, analysis: dict,
                             topic: str, stages: list, keywords: list) -> tuple[str, str]:
    """生成符合规范的学习文章"""
    
    date_str = datetime.now().strftime("%Y%m%d")
    created_date = datetime.now().strftime("%Y-%m-%d")
    original_title = video_info.get("title", "")
    cleaned_title = clean_title(original_title)
    
    filename = generate_filename(date_str, topic, cleaned_title)
    tool_list_str = "、".join([t["name"] for t in tools]) if tools else "通用方法"
    
    # Frontmatter
    tech_tags = []
    for t in tools:
        if t.get("tech_tags"):
            tech_tags.extend(t["tech_tags"])
    tech_tags = list(set(tech_tags))
    
    keyword_tags = [k for k in keywords]
    source_platform = video_info.get("source_platform", "unknown")
    
    fm = []
    fm.append("---")
    fm.append(f"doc_id: '{date_str}-{topic}-教程拆解-{cleaned_title[:30]}'")
    fm.append(f"title: '{cleaned_title}'")
    fm.append("source_type: '视频教程'")
    fm.append("type: '教程拆解'")
    fm.append("note_status: '已整理'")
    fm.append(f"topic: '{topic}'")
    fm.append(f"primary_stage: '{stages[0] if stages else '应用实践'}'")
    fm.append(f"source_platform: '{source_platform}'")
    fm.append(f"original_title: '{original_title if original_title != cleaned_title else ''}'")
    fm.append(f"source_url: '{video_info.get('url', '')}'")
    fm.append(f"created: '{created_date}'")
    fm.append(f"updated: '{created_date}'")
    fm.append("knowledge_stages:")
    for s in stages:
        fm.append(f" - '{s}'")
    fm.append("tags:")
    fm.append(" - 'kb/教程拆解'")
    fm.append(" - 'source/视频教程'")
    fm.append(f" - 'topic/{topic}'")
    fm.append(f" - 'platform/{source_platform}'")
    fm.append(" - 'status/已整理'")
    for s in stages:
        fm.append(f" - 'stage/{s}'")
    for tag in tech_tags:
        fm.append(f" - '{tag}'")
    for kt in keyword_tags:
        fm.append(f" - 'keyword/{kt}'")
    fm.append("---\n")
    fm.append(f"# {cleaned_title}")
    
    frontmatter = "\n".join(fm)
    
    # ===== 正文 =====
    desc = video_info.get("description", "")
    subtitles = video_info.get("subtitles", "")
    sub_method = video_info.get("subtitle_method", "")
    core_points = analysis.get("core_points", "")
    eff_tips = analysis.get("efficiency_tips", [])
    pitfalls = analysis.get("pitfalls", [])
    steps = analysis.get("practical_steps", [])
    
    content_body = f"""
## 一、教程基本信息

| 属性 | 值 |
|------|-----|
| **来源平台** | {source_platform} |
| **原始标题** | {original_title} |
| **UP主/作者** | {video_info.get('up_name', '未知')} |
| **视频链接** | [{video_info.get('url', '#')}]({video_info.get('url', '#')}) |
| **整理日期** | {created_date} |
| **涉及工具** | {tool_list_str} |
| **字幕获取** | {'✅ ' + sub_method if sub_method else '❌ 未获取到字幕'} |

---

## 二、教程核心内容

### 视频主题

> {topic}

### 目标受众

"""
    
    # 根据主题定制目标受众
    if "内容运营" in topic:
        content_body += """本文适合以下人群：
- 公众号/小红书/抖音运营从业者
- 想通过自媒体变现的个人
- 希望找到爆款内容创作方法的运营新人
"""
    elif "知识管理" in topic:
        content_body += """本文适合以下人群：
- 希望提升知识管理效率的个人
- 想构建个人知识体系的学习者
- 需要整理大量信息的知识工作者
"""
    else:
        content_body += """本文适合以下人群：
- 想学习本视频介绍方法技能的学习者
- 希望提升效率和质量的实践者
- 需要系统性方法论的从业者
"""
    
    content_body += f"""
### 核心步骤

"""
    
    if steps:
        for i, step in enumerate(steps[:5], 1):
            content_body += f"{i}. {step.strip()}\n"
    else:
        content_body += "（从字幕提取核心步骤，见下方详细内容）\n"
    
    content_body += """
---

## 三、视频内容深度分析

### 字幕内容摘要

"""
    
    if subtitles:
        content_body += f"""**字幕获取方式**: {sub_method}

**内容预览**（前1000字）：
```
{subtitles[:1000]}{'...' if len(subtitles) > 1000 else ''}
```

"""
    else:
        content_body += f"""**视频描述**：
> {desc[:500] if desc else '（无描述）'}

> ⚠️ 未获取到字幕/转录内容，建议观看原视频获取完整信息。

"""

    content_body += f"""
### 核心要点

{core_points if core_points else '（见上方内容摘要）'}

"""
    
    # ===== 涉及工具 =====
    content_body += """
---

## 四、技术要点解析

### 涉及的工具/平台

"""
    
    if tools:
        for t in tools:
            content_body += f"""
#### {t['name']}（{t['category']}）

**工具简介**：{t.get('what_it_does', '（暂无描述）')}

**官方文档**：{t.get('docs_url', '#')}

**核心功能**：
"""
            for feat in t.get("key_features", []):
                content_body += f"- {feat}\n"
            
            content_body += f"""
**快速入门**：
```
{t.get('quick_start', '（请参考官方文档）')}
```

**最佳实践**：
"""
            for bp in t.get("best_practices", []):
                content_body += f"- {bp}\n"
            
            content_body += """
"""
    else:
        content_body += "\n（本视频未识别到特定工具，主要是方法论讲解）\n\n"
    
    # ===== 提效技巧 =====
    content_body += """
---

## 五、提效技巧分析

"""
    
    if eff_tips:
        content_body += "### 视频中提到的提效方法\n\n"
        for tip in eff_tips[:5]:
            content_body += f"- {tip.strip()}\n"
    else:
        content_body += "（视频中如有具体提效数据和方法，将在完整观看后补充）\n"
    
    # ===== 避坑指南 =====
    content_body += """
---

## 六、避坑指南（常见误区）

"""
    
    if pitfalls:
        content_body += "### 视频中提到的坑点\n\n"
        for pit in pitfalls[:5]:
            pit_clean = pit.strip().replace("\n", " ")
            content_body += f"- ⚠️ {pit_clean}\n"
    else:
        content_body += "（视频中如有提到常见误区，将在完整观看后补充）\n"
    
    # ===== 实施路径 =====
    content_body += """
---

## 七、实施路径建议

### 分阶段实施计划

"""
    
    for i, stage in enumerate(stages, 1):
        content_body += f"""
#### 阶段{i}：{stage}
"""
        if i == 1:
            content_body += "- 理解本视频介绍的核心方法和逻辑\n"
            if tools:
                content_body += f"- 了解 **{tools[0]['name']}** 的基本使用方法\n"
        elif i == 2:
            content_body += "- 按照视频步骤进行实践\n"
            if len(tools) > 1:
                content_body += f"- 结合 **{tools[1]['name']}** 深化应用\n"
        elif i == 3:
            content_body += "- 优化和迭代，形成自己的方法论\n"
        else:
            content_body += "- 持续实践和总结\n"
    
    # ===== 风险评估 =====
    content_body += """
---

## 八、风险评估与应对

"""
    
    if tools:
        for t in tools:
            for pit in t.get("common_pitfalls", []):
                pit_clean = pit.split("（")[0].strip() if "（" in pit else pit
                content_body += f"""
### {t['name']}：{pit_clean}
**问题描述**：{pit}

**应对建议**：
- 在测试环境先验证
- 查阅官方文档确认版本兼容性
- 保留传统方式的备份方案

"""
    else:
        content_body += """
> 暂无具体风险提示。建议观看原视频获取完整信息。
"""
    
    # ===== 成功指标 =====
    content_body += """
---

## 九、成功指标定义

### 量化评估标准

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 内容理解 | 能复述视频核心方法 | 口头/书面复述 |
| 实践落地 | 完成视频中的操作步骤 | 实际操作验证 |
| 效果达成 | 相比原有方式有明显提升 | 对比测量 |

"""
    
    # ===== 相关资源 =====
    content_body += """
---

## 十、相关资源推荐

"""
    
    if tools:
        content_body += "### 官方文档\n\n"
        for t in tools:
            if t.get("docs_url"):
                content_body += f"- [{t['name']}]({t['docs_url']})\n"
    
    content_body += f"""
- 原视频：[{cleaned_title}]({video_info.get('url', '#')})
- [知识库管理规范](../ai提效/20260408-知识管理-教程拆解-视频资料学习知识库内容整理规则.md)

"""
    
    # ===== 总结 =====
    content_body += """
---

## 十一、总结与展望

### 核心价值

"""
    
    if tools:
        content_body += f"""本文拆解了 **{tool_list_str}** 相关的视频教程，
"""
    else:
        content_body += f"""本文拆解了主题为 **「{topic}」** 的视频教程，
"""
    
    content_body += f"""重点分析了核心方法步骤、提效技巧以及常见坑点。

### 学习建议

1. 先完整观看原视频，建立整体认知
2. 按照本文整理的步骤进行实践
3. 注意规避文中提到的常见误区
4. 形成适合自己的方法论

"""
    
    content_body += f"""
---

## 📝 更新日志

- **{created_date}**：初始版本
  - 涉及工具：{tool_list_str}
  - 知识主题：{topic}
  - 字幕获取：{'成功' if subtitles else '失败'}
  - 推断阶段：{"，".join(stages)}

---

*🤖 由贾维斯知识库系统 v2.2 生成*
*核心功能：yt-dlp字幕获取 + faster-whisper转录 + 深度内容分析*
"""
    
    return filename, frontmatter + content_body


# ============ 主流程 ============
def main():
    parser = argparse.ArgumentParser(description="🧠 深度学习知识库生成器 v2.2（字幕获取 + Whisper转录）")
    parser.add_argument("--source", type=str, help="视频 URL")
    parser.add_argument("--content", type=str, help="直接输入文本内容")
    parser.add_argument("--bvid", type=str, help="B站 BV 号")
    parser.add_argument("--context", type=str, help="视频详细描述（备用）")
    parser.add_argument("--max-tools", type=int, default=8, help="最多分析工具数")
    parser.add_argument("--no-subtitle", action="store_true", help="跳过字幕获取")
    parser.add_argument("--whisper-only", action="store_true", help="只使用Whisper转录（跳过yt-dlp字幕）")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("🧠 Deep Learning Knowledge Base Generator v2.2")
    print("   新功能：yt-dlp字幕 + faster-whisper转录")
    print("=" * 60)
    
    video_info = {}
    text_content = ""
    
    # ===== 解析来源 =====
    if args.bvid:
        video_info = parse_bilibili_video(args.bvid, fetch_subtitles=not args.no_subtitle)
        text_content = video_info.get("subtitles", "") or video_info.get("description", "")
        
    elif args.source:
        if "bilibili.com" in args.source:
            match = re.search(r'bilibili\.com/video/(BV[\w]+)', args.source)
            if match:
                video_info = parse_bilibili_video(match.group(1), fetch_subtitles=not args.no_subtitle)
                text_content = video_info.get("subtitles", "") or video_info.get("description", "")
            else:
                print("❌ 无法从URL提取BVID")
                sys.exit(1)
        else:
            # 通用网页
            print(f"🌐 正在获取网页内容: {args.source}")
            try:
                resp = requests.get(args.source, headers=HEADERS, timeout=TIMEOUT)
                soup = BeautifulSoup(resp.text, "html.parser")
                title_tag = soup.find("title")
                title = title_tag.get_text(strip=True) if title_tag else "未知标题"
                
                for tag in soup(["script", "style", "nav", "footer"]):
                    tag.decompose()
                body = soup.find("body")
                text_content = body.get_text(separator="\n", strip=True) if body else ""
                
                video_info = {
                    "title": clean_title(title),
                    "url": args.source,
                    "up_name": "网页作者",
                    "description": text_content[:500],
                    "source_platform": "web",
                    "source_type": "文章/网页",
                    "subtitles": "",
                    "subtitle_method": "",
                    "success": True
                }
            except Exception as e:
                print(f"❌ 网页获取失败: {e}")
                sys.exit(1)
    
    elif args.content:
        text_content = args.content
        video_info = {
            "title": clean_title("文本内容分析"),
            "url": "",
            "up_name": "用户输入",
            "description": args.content[:500],
            "source_platform": "text",
            "source_type": "文本内容",
            "subtitles": "",
            "subtitle_method": "",
            "success": True
        }
    else:
        print("❌ 请提供 --source, --bvid 或 --content")
        parser.print_help()
        sys.exit(1)
    
    # 合并额外上下文
    if args.context:
        text_content += " " + args.context
    
    print(f"\n✅ 内容获取: {video_info.get('title', '标题')}")
    if video_info.get("subtitle_method"):
        print(f"   📝 字幕: {video_info['subtitle_method']} ({len(video_info.get('subtitles', ''))} 字符)")
    
    # ===== 识别工具 =====
    print(f"\n🔍 正在识别工具/平台...")
    tools = identify_tools(text_content)[:args.max_tools]
    
    if tools:
        print(f"   ✅ 识别到 {len(tools)} 个工具:")
        for t in tools:
            print(f"      - {t['name']} ({t['category']})")
    else:
        print("   ⚠️ 未识别到特定工具，主要分析内容方法")
    
    # ===== 推断主题 =====
    topic, stages, keywords = infer_topic_and_stages(text_content, tools)
    print(f"   📂 推断主题: {topic}")
    print(f"   📊 推断阶段: {' → '.join(stages)}")
    
    # ===== 内容分析 =====
    print(f"\n🧠 正在分析内容...")
    analysis = analyze_content(video_info, tools)
    print(f"   ✅ 核心要点: {analysis['core_points'][:80]}...")
    if analysis['efficiency_tips']:
        print(f"   ✅ 提效技巧: {len(analysis['efficiency_tips'])} 条")
    if analysis['pitfalls']:
        print(f"   ✅ 坑点提示: {len(analysis['pitfalls'])} 条")
    
    # ===== 生成文章 =====
    print(f"\n📝 正在生成学习文章...")
    filename, content = generate_knowledge_note(
        video_info=video_info,
        tools=tools,
        analysis=analysis,
        topic=topic,
        stages=stages,
        keywords=keywords
    )
    
    # ===== 保存 =====
    KB_ROOT.mkdir(parents=True, exist_ok=True)
    save_path = KB_ROOT / filename
    
    with open(save_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    print(f"\n{'=' * 60}")
    print(f"✅ 学习文章已生成！")
    print(f"   📁 路径: {save_path}")
    print(f"   📄 文件名: {filename}")
    print(f"   📊 涉及工具: {len(tools)} 个")
    print(f"   📂 知识主题: {topic}")
    print(f"   📝 字幕长度: {len(video_info.get('subtitles', ''))} 字符")
    print(f"   📏 文章字数: 约 {len(content)} 字")
    print(f"{'=' * 60}")
    
    return save_path


if __name__ == "__main__":
    main()
