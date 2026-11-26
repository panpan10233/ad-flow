from dataclasses import asdict

from .catalog import CHANNELS, KEYWORDS, PRODUCTS
from .data_layer import slice_days, sum_rows
from .models import Metric, to_dict

BASE_KEYS = ("spend", "impressions", "clicks", "adds", "checkouts", "orders", "gmv")


def _div(a, b):
    return a / b if b else 0


def derive(m):
    """对应前端 derive(m)，返回含 9 个派生指标的 Metric。"""
    spend = m.get("spend", 0) or 0
    impressions = m.get("impressions", 0) or 0
    clicks = m.get("clicks", 0) or 0
    adds = m.get("adds", 0) or 0
    checkouts = m.get("checkouts", 0) or 0
    orders = m.get("orders", 0) or 0
    gmv = m.get("gmv", 0) or 0
    return Metric(
        spend=spend, impressions=impressions, clicks=clicks, adds=adds,
        checkouts=checkouts, orders=orders, gmv=gmv,
        roas=_div(gmv, spend),
        ctr=_div(clicks, impressions),
        cpc=_div(spend, clicks),
        cvr=_div(orders, clicks),
        atcRate=_div(adds, clicks),
        checkoutRate=_div(checkouts, adds),
        payRate=_div(orders, checkouts),
        aov=_div(gmv, orders),
        cpa=_div(spend, orders),
    )


def apply_channel_override(channel_id, m, ov):
    """对应前端 applyChannelOverride(id, m)：仅改写当前周期。

    加投按 72% 边际效率折算 GMV，减投按 60%，暂停归零；历史周期不调用此函数。
    """
    ch = ((ov or {}).get("channels") or {}).get(channel_id) or {"budget": 0, "status": "active"}
    b = -100 if ch.get("status") == "paused" else (ch.get("budget") or 0)
    sf = max(0, 1 + b / 100)
    gf = (1 + b / 100 * .72) if b >= 0 else max(0, 1 + b / 100 * .6)

    d = asdict(m)
    d["spend"] = m.spend * sf
    d["gmv"] = m.gmv * gf
    for k in ("impressions", "clicks", "adds", "checkouts"):
        d[k] = getattr(m, k) * sf
    d["orders"] = m.orders * gf
    # 前端在此处重算三个比率，随后 derive 会再次统一重算全部派生指标
    d["cvr"] = _div(d["orders"], d["clicks"]) if d["clicks"] else m.cvr
    d["atcRate"] = _div(d["adds"], d["clicks"]) if d["clicks"] else m.atcRate
    d["payRate"] = _div(d["orders"], d["checkouts"]) if d["checkouts"] else m.payRate
    return derive(d)


def channel_metrics(channel_id, days=30, offset=0, ov=None):
    m = derive(sum_rows(slice_days(channel_id, days, offset)))
    return apply_channel_override(channel_id, m, ov) if offset == 0 else m


def total_metrics(days=30, offset=0, ov=None):
    acc = {k: 0.0 for k in BASE_KEYS}
    for c in CHANNELS:
        m = channel_metrics(c.id, days, offset, ov)
        for k in BASE_KEYS:
            acc[k] += getattr(m, k, 0) or 0
    return derive(acc)


def product_metrics(p, days=30, ov=None):
    """对应前端 productMetrics(p)：按 share / bid / peer denom / effF 折算。"""
    cm = channel_metrics(p.ch, days, 0, ov)
    products_ov = (ov or {}).get("products") or {}
    pov = products_ov.get(p.id) or {}
    bid = pov.get("bid") or 0
    bid_f = 0 if pov.get("status") == "paused" else 1 + bid / 100

    peers = [x for x in PRODUCTS if x.ch == p.ch]
    denom = 0
    for x in peers:
        xov = products_ov.get(x.id) or {}
        denom += x.share * (0 if xov.get("status") == "paused" else 1 + (xov.get("bid") or 0) / 100)
    denom = denom or 1

    spend = cm.spend * p.share * bid_f / denom
    eff_f = (1 - bid / 100 * .18) if bid >= 0 else (1 - bid / 100 * .28)
    gmv = spend * cm.roas * p.factor * eff_f
    orders = gmv / (cm.aov * p.aovF) if (cm.aov * p.aovF) else 0
    clicks = orders / (cm.cvr * p.cvrF) if (cm.cvr * p.cvrF) else 0
    adds = clicks * cm.atcRate
    checkouts = adds * cm.checkoutRate
    impressions = clicks / cm.ctr if cm.ctr else 0
    return derive({
        "spend": spend, "gmv": gmv, "orders": orders, "clicks": clicks,
        "adds": adds, "checkouts": checkouts, "impressions": impressions,
    })


def keyword_metrics(k, days=30, ov=None):
    """对应前端 keywordMetrics(k)：按 share / bid / peer denom / effF 折算。"""
    cm = channel_metrics(k.ch, days, 0, ov)
    keywords_ov = (ov or {}).get("keywords") or {}
    kov = keywords_ov.get(k.id) or {}
    bid = kov.get("bid") or 0
    active = kov.get("status") != "paused" and not kov.get("negative")
    bid_f = 1 + bid / 100 if active else 0

    peers = [x for x in KEYWORDS if x.ch == k.ch]
    denom = 0
    for x in peers:
        xov = keywords_ov.get(x.id) or {}
        inactive = xov.get("status") == "paused" or xov.get("negative")
        denom += x.share * (0 if inactive else 1 + (xov.get("bid") or 0) / 100)
    denom = denom or 1

    spend = cm.spend * k.share * bid_f / denom
    clicks = spend / k.cpc if k.cpc else 0
    eff_f = (1 - bid / 100 * .18) if bid >= 0 else (1 - bid / 100 * .28)
    gmv = spend * k.roas * eff_f
    orders = gmv / k.aov if k.aov else 0
    return derive({
        "spend": spend, "clicks": clicks, "gmv": gmv, "orders": orders,
        "impressions": _div(clicks, cm.ctr),
        "adds": clicks * cm.atcRate,
        "checkouts": _div(orders, cm.payRate),
    })


def all_metrics(days=30, offset=0, ov=None):
    """对应 /api/metrics 的完整响应体。"""
    return {
        "total": to_dict(total_metrics(days, offset, ov)),
        "channels": [
            {"id": c.id, "metrics": to_dict(channel_metrics(c.id, days, offset, ov))}
            for c in CHANNELS
        ],
        "products": [
            {"id": p.id, "metrics": to_dict(product_metrics(p, days, ov))}
            for p in PRODUCTS
        ],
        "keywords": [
            {"id": k.id, "metrics": to_dict(keyword_metrics(k, days, ov))}
            for k in KEYWORDS
        ],
    }
