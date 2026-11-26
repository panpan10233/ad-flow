import copy
import json
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT / ".env.local.json"

DEFAULT_CONFIG = {
    "llm": {
        "baseUrl": "https://api.openai.com/v1",
        "key": "",
        "model": "gpt-4o-mini",
    }
}

CHANNEL_NAMES = [
    "Amazon Ads", "AliExpress", "SHEIN Ads", "TikTok Ads", "Google Ads · 独立站"
]

_LOCK = threading.Lock()


def load_config():
    """读取配置；文件缺失或损坏时回退到默认值。"""
    try:
        raw = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        llm = raw.get("llm") or {}
        return {
            "llm": {
                "baseUrl": str(llm.get("baseUrl") or DEFAULT_CONFIG["llm"]["baseUrl"]),
                "key": str(llm.get("key") or ""),
                "model": str(llm.get("model") or DEFAULT_CONFIG["llm"]["model"]),
            }
        }
    except Exception:
        return copy.deepcopy(DEFAULT_CONFIG)


def save_config(cfg):
    """线程安全地写回配置，权限尽量收紧。"""
    with _LOCK:
        CONFIG_FILE.write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        try:
            CONFIG_FILE.chmod(0o600)
        except OSError:
            pass  # Windows 下无 POSIX 权限语义，忽略


def health(cfg=None):
    cfg = cfg if cfg is not None else load_config()
    llm = cfg.get("llm") or {}
    return {
        "ok": True,
        "llm": {
            "configured": bool(llm.get("key")),
            "model": llm.get("model") or "",
            "baseUrl": llm.get("baseUrl") or "",
        },
        "channels": list(CHANNEL_NAMES),
    }
