import copy
import json
import threading
from datetime import datetime

from .catalog import CHANNELS, KEYWORDS, PRODUCTS, channel_map
from .config import ROOT
from .data_layer import clamp

STATE_FILE = ROOT / ".execution.json"
CHANNEL_BY_ID = channel_map()
PRODUCT_BY_ID = {p.id: p for p in PRODUCTS}
KEYWORD_BY_ID = {k.id: k for k in KEYWORDS}

_LOCK = threading.RLock()


def empty_ov():
    return {
        "channels": {c.id: {"budget": 0, "status": "active"} for c in CHANNELS},
        "products": {p.id: {"bid": 0, "status": "active"} for p in PRODUCTS},
        "keywords": {k.id: {"bid": 0, "status": "active", "negative": False} for k in KEYWORDS},
        "log": [],
        "executed": {},
        "seq": 0,
    }


def now_stamp():
    d = datetime.now()
    return f"{d.year}/{d.month:02d}/{d.day:02d} {d.hour:02d}:{d.minute:02d}"


def ov_target(ov, level, target_id):
    if level in ("渠道", "漏斗"):
        return (ov.get("channels") or {}).get(target_id)
    if level == "商品":
        return (ov.get("products") or {}).get(target_id)
    if level == "关键词":
        return (ov.get("keywords") or {}).get(target_id)
    return None


def target_name(level, target_id):
    if level in ("渠道", "漏斗"):
        c = CHANNEL_BY_ID.get(target_id)
        return c.name if c else target_id
    if level == "商品":
        p = PRODUCT_BY_ID.get(target_id)
        return p.name if p else target_id
    k = KEYWORD_BY_ID.get(target_id)
    return k.word if k else target_id


class ExecutionStore:
    def __init__(self, path=STATE_FILE):
        self.path = path
        with _LOCK:
            self.ov = self._load()

    def _load(self):
        try:
            saved = json.loads(self.path.read_text(encoding="utf-8"))
            base = empty_ov()
            for key in ("channels", "products", "keywords"):
                for oid, obj in (saved.get(key) or {}).items():
                    if oid in base[key] and isinstance(obj, dict):
                        base[key][oid].update(obj)
            base["log"] = saved.get("log") if isinstance(saved.get("log"), list) else []
            base["executed"] = saved.get("executed") or {}
            base["seq"] = saved.get("seq") or 0
            return base
        except Exception:
            return empty_ov()

    def _save(self):
        self.path.write_text(
            json.dumps(self.ov, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def snapshot(self):
        with _LOCK:
            return copy.deepcopy(self.ov)

    def execute(self, payload):
        """执行动作；返回最新 overrides，对象不存在返回 None。"""
        with _LOCK:
            ov = self.ov
            level = payload.get("level")
            target_id = payload.get("id")
            action = payload.get("action")
            target = ov_target(ov, level, target_id)
            if target is None:
                return None

            before = copy.deepcopy(target)
            name = target_name(level, target_id)
            detail = payload.get("detail")
            if not isinstance(detail, dict):
                detail = {"text": detail if isinstance(detail, str) else ""}

            if action == "加投":
                if level in ("渠道", "漏斗"):
                    target["budget"] = clamp(
                        (target.get("budget") or 0) + (0 if level == "漏斗" else 25), -80, 80
                    )
                else:
                    target["bid"] = clamp(
                        (target.get("bid") or 0) + (30 if level == "商品" else 20), -80, 80
                    )
                if target.get("status") == "paused":
                    target["status"] = "active"
            elif action == "减投":
                if level in ("渠道", "漏斗"):
                    target["budget"] = clamp((target.get("budget") or 0) - 40, -80, 80)
                else:
                    target["bid"] = clamp((target.get("bid") or 0) - 30, -80, 80)
            elif action == "暂停":
                target["status"] = "paused"
                if level == "关键词":
                    target["negative"] = True
            elif action == "恢复":
                target["status"] = "active"
                if level == "关键词":
                    target["negative"] = False
            elif action == "优化":
                if level in ("渠道", "漏斗"):
                    target["funnelFixed"] = True
            elif action == "调整预算":
                target["budget"] = clamp(float(detail.get("value") or 0), -80, 80)
                if target.get("status") == "paused" and target["budget"] > 0:
                    target["status"] = "active"
            elif action == "调整出价":
                target["bid"] = clamp(float(detail.get("value") or 0), -80, 80)
                if target.get("status") == "paused" and target["bid"] > 0:
                    target["status"] = "active"

            strategy_id = payload.get("strategyId")
            if strategy_id:
                ov["executed"][strategy_id] = {"ts": now_stamp(), "logId": None}

            ov["seq"] += 1
            log_id = "op" + str(ov["seq"])
            ov["log"].insert(0, {
                "id": log_id,
                "ts": now_stamp(),
                "level": level,
                "targetId": target_id,
                "target": name,
                "action": action,
                "detail": detail.get("text") or "",
                "impact": payload.get("impact") or 0,
                "before": before,
            })
            ov["log"] = ov["log"][:100]
            if strategy_id and strategy_id in ov["executed"]:
                ov["executed"][strategy_id]["logId"] = log_id

            self._save()
            return copy.deepcopy(ov)

    def undo(self, log_id):
        """按 logId 撤销；返回最新 overrides，未找到返回 None。"""
        with _LOCK:
            ov = self.ov
            idx = next((i for i, x in enumerate(ov["log"]) if x.get("id") == log_id), -1)
            if idx < 0:
                return None
            item = ov["log"][idx]
            target = ov_target(ov, item.get("level"), item.get("targetId"))
            if target is not None:
                target.clear()
                target.update(item.get("before") or {})
            for sid, val in list(ov["executed"].items()):
                if (val or {}).get("logId") == log_id:
                    del ov["executed"][sid]
            ov["log"].pop(idx)
            self._save()
            return copy.deepcopy(ov)

    def reset(self):
        with _LOCK:
            self.ov = empty_ov()
            self._save()
            return copy.deepcopy(self.ov)
