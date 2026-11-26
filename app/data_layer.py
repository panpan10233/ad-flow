from datetime import date, timedelta

from .catalog import CHANNELS
from .models import DailyRow, to_dict
from .rng import mulberry32, noise

TOTAL_DAYS = 120
DOW_FACTOR = [0.86, 0.95, 1.00, 1.03, 1.08, 1.14, 1.10]
SEED = 20261125


def clamp(v, a, b):
    return max(a, min(b, v))


def build_dataset(today=None):
    """返回 (dates, daily)。dates 元素为 {iso,label,dow}，dow 与 JS getDay 一致。"""
    today = today or date.today()
    dates = []
    for i in range(TOTAL_DAYS - 1, -1, -1):
        d = today - timedelta(days=i)
        dates.append({
            "iso": d.isoformat(),
            "label": f"{d.month}/{d.day}",
            "dow": (d.weekday() + 1) % 7,
        })

    rng = mulberry32(SEED)
    daily = {}
    for c in CHANNELS:
        rows = []
        for i, d in enumerate(dates):
            dow_factor = DOW_FACTOR[d["dow"]]
            f = (1 + c.trend * (i - TOTAL_DAYS / 2) / 30) * dow_factor * noise(rng, .055)
            spend = max(100, c.spend * f)
            impressions = spend / c.cpm * 1000 * noise(rng, .03)
            clicks = impressions * c.ctr * noise(rng, .06)
            adds = clicks * c.atc * noise(rng, .05)
            checkouts = adds * c.checkout * noise(rng, .05)
            orders = checkouts * c.pay * noise(rng, .04)
            gmv = orders * c.aov * noise(rng, .035)
            rows.append(DailyRow(
                date=d, spend=spend, impressions=impressions, clicks=clicks,
                adds=adds, checkouts=checkouts, orders=orders, gmv=gmv,
            ))
        daily[c.id] = rows
    return dates, daily


DATES, DAILY = build_dataset()
TODAY_DATE = date.fromisoformat(DATES[-1]["iso"])


def slice_days(channel_id, days, offset=0):
    """对应前端 sliceDays(id, days, offset)。"""
    arr = DAILY[channel_id]
    end = len(arr) - offset
    start = max(0, end - days)
    return arr[start:end]


def sum_rows(rows):
    out = {k: 0.0 for k in ("spend", "impressions", "clicks", "adds", "checkouts", "orders", "gmv")}
    for r in rows:
        for k in out:
            out[k] += getattr(r, k, 0) or 0
    return out


def daily_payload():
    """bootstrap 用的完整 120×5 数组。"""
    return {cid: to_dict(rows) for cid, rows in DAILY.items()}
