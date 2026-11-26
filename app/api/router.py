"""API 路由：13 个端点的数据结构对齐前端。"""

from .. import config as cfgmod
from ..catalog import CHANNELS, KEYWORDS, PRODUCTS
from ..data_layer import DATES, TOTAL_DAYS, daily_payload
from ..metrics import all_metrics, channel_metrics, total_metrics
from ..models import to_dict
from ..forecast import build_forecast
from ..services import ai
from ..strategy import (
    _js_round, action_of_roas, fmt_num, fmt_pct, strategies_payload,
)


def _as_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _report_csv(days, ov):
    """复刻前端 exportReport 的 CSV 文本。"""
    m = total_metrics(days, 0, ov)
    rows = [["模块", "对象", "花费", "GMV", "ROAS", "转化率", "建议"]]
    for c in CHANNELS:
        x = channel_metrics(c.id, days, 0, ov)
        rows.append(["渠道", c.name, _js_round(x.spend), _js_round(x.gmv),
                     fmt_num(x.roas), fmt_pct(x.cvr), action_of_roas(x.roas)])
    for p in PRODUCTS:
        from ..metrics import product_metrics
        x = product_metrics(p, days, ov)
        rows.append(["商品", p.name, _js_round(x.spend), _js_round(x.gmv),
                     fmt_num(x.roas), fmt_pct(x.cvr), action_of_roas(x.roas)])
    for k in KEYWORDS:
        from ..metrics import keyword_metrics
        x = keyword_metrics(k, days, ov)
        rows.append(["关键词", k.word, _js_round(x.spend), _js_round(x.gmv),
                     fmt_num(x.roas), fmt_pct(x.cvr), action_of_roas(x.roas)])
    f = build_forecast(days, ov)
    rows.append([])
    rows.append(["大盘 ROAS", fmt_num(m.roas)])
    rows.append(["预计下月 GMV", _js_round(f["total"])])
    rows.append(["预计环比", fmt_pct(f["growth"])])
    return "\ufeff" + "\n".join(
        ",".join('"' + str(v if v is not None else "").replace('"', '""') + '"' for v in row)
        for row in rows
    )


def _funnel(channel, days, ov):
    cmap = {c.id: c for c in CHANNELS}
    if channel not in cmap:
        channel = "amazon"
    m = channel_metrics(channel, days, 0, ov)
    stages = [
        {"name": "曝光", "v": m.impressions, "color": "#c7d8ff"},
        {"name": "点击", "v": m.clicks, "color": "#8db0ff"},
        {"name": "加购", "v": m.adds, "color": "#5b8dff"},
        {"name": "下单", "v": m.checkouts, "color": "#2f6bff"},
        {"name": "支付", "v": m.orders, "color": "#1d4fd7"},
    ]
    items = [
        {"label": "点击 → 加购", "v": m.atcRate, "good": .12, "bad": m.atcRate < .12,
         "note": "低于 12% 说明商品页吸引力不足，优化主图、价格与评价。"},
        {"label": "加购 → 下单", "v": m.checkoutRate, "good": .25, "bad": m.checkoutRate < .25,
         "note": "低于 25% 通常因运费/优惠临门一脚缺失，建议限时券与免邮门槛。"},
        {"label": "下单 → 支付", "v": m.payRate, "good": .68, "bad": m.payRate < .68,
         "note": "低于 68% 排查支付方式、信任标识与结账流程长度。"},
    ]
    if m.atcRate < .10:
        conclusion = "当前最大瓶颈在加购环节，优先优化商品页与素材匹配度。"
    elif m.payRate < .60:
        conclusion = "当前最大瓶颈在支付环节，优先优化结账体验。"
    else:
        conclusion = "漏斗整体健康，可加大优质流量投入并观察边际 ROI。"
    return {
        "ok": True,
        "channel": channel,
        "name": cmap[channel].name,
        "stages": stages,
        "diagnosis": items,
        "conclusion": conclusion,
        "summary": {
            "ctr": m.ctr, "atcRate": m.atcRate,
            "checkoutRate": m.checkoutRate, "payRate": m.payRate,
        },
        "roas": m.roas,
    }


def handle(method, path, query, body, store):
    """返回 (status_code, data)。data 为 str 时按 CSV 文本输出。"""
    cfg = cfgmod.load_config()
    q = {k: (v[0] if isinstance(v, list) and v else v) for k, v in query.items()}
    days = _as_int(q.get("days"), 30)
    offset = _as_int(q.get("offset"), 0)
    ov = store.snapshot()

    if path == "/api/health":
        return 200, cfgmod.health(cfg)

    if path == "/api/config" and method == "POST":
        incoming = body.get("llm")
        if isinstance(incoming, dict):
            old = cfg.get("llm") or {}
            cfg["llm"] = {
                "baseUrl": str(incoming.get("baseUrl") or old.get("baseUrl") or "https://api.openai.com/v1").strip(),
                "key": str(incoming.get("key") or old.get("key") or "").strip(),
                "model": str(incoming.get("model") or old.get("model") or "gpt-4o-mini").strip(),
            }
            cfgmod.save_config(cfg)
        return 200, {"ok": True, "health": cfgmod.health(cfg)}

    if path == "/api/bootstrap":
        return 200, {
            "ok": True,
            "channels": to_dict(CHANNELS),
            "products": to_dict(PRODUCTS),
            "keywords": to_dict(KEYWORDS),
            "dates": DATES,
            "daily": daily_payload(),
            "overrides": ov,
            "days": TOTAL_DAYS,
        }

    if path == "/api/metrics":
        return 200, {"ok": True, **all_metrics(days, offset, ov)}

    if path == "/api/strategies":
        return 200, strategies_payload(days, ov)

    if path == "/api/forecast":
        return 200, {"ok": True, **build_forecast(days, ov)}

    if path == "/api/funnel":
        return 200, _funnel(q.get("channel") or "amazon", days, ov)

    if path == "/api/execute" and method == "POST":
        result = store.execute(body)
        if result is None:
            return 400, {"ok": False, "error": "执行对象不存在"}
        return 200, {"ok": True, "overrides": result}

    if path == "/api/undo" and method == "POST":
        result = store.undo(body.get("logId"))
        if result is None:
            return 400, {"ok": False, "error": "操作记录不存在"}
        return 200, {"ok": True, "overrides": result}

    if path == "/api/reset" and method == "POST":
        return 200, {"ok": True, "overrides": store.reset()}

    if path == "/api/chat" and method == "POST":
        result = ai.chat(body.get("messages"), cfg, days, ov)
        return result.get("code", 200), result

    if path == "/api/report":
        return 200, _report_csv(days, ov)

    return 404, {"ok": False, "error": "not found"}
