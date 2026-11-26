import math
from datetime import timedelta

from .catalog import CHANNELS
from .data_layer import DATES, DAILY, TODAY_DATE, clamp
from .metrics import total_metrics


def gmv_series(days):
    total = len(DATES)
    return [
        sum(DAILY[c.id][total - days + i].gmv for c in CHANNELS)
        for i in range(days)
    ]


def linear_slope(arr):
    n = len(arr)
    if n < 2:
        return 0
    mx = (n - 1) / 2
    my = sum(arr) / n
    num = sum((i - mx) * (arr[i] - my) for i in range(n))
    den = sum((i - mx) ** 2 for i in range(n))
    return num / den if den else 0


def build_forecast(days=30, ov=None):
    raw_hist = gmv_series(days)
    total = len(DATES)
    prev = [
        sum(DAILY[c.id][total - 2 * days + i].gmv for c in CHANNELS)
        for i in range(days)
    ]

    raw_total = sum(raw_hist)
    cur_total = total_metrics(days, 0, ov).gmv
    lift = clamp(cur_total / raw_total, .05, 3) if raw_total else 1
    hist = [v * lift for v in raw_hist]
    last = hist[-1]
    slope = linear_slope(hist) * .55

    dow_ratios = [1.0] * 7
    for k in range(7):
        vals = [hist[i] for i in range(days) if DATES[total - days + i]["dow"] == k]
        dow_ratios[k] = sum(vals) / len(vals) / last if (vals and last) else 1

    pred, lower, upper = [], [], []
    for i in range(1, 31):
        d = TODAY_DATE + timedelta(days=i)
        base = last + slope * i
        dow = (d.weekday() + 1) % 7
        v = max(last * .5, base * dow_ratios[dow] * (1 + .004 * math.sin(i * 1.7)))
        band = v * (.035 + .0022 * i)
        pred.append(v)
        lower.append(v - band)
        upper.append(v + band)

    f_total = sum(pred)
    prev_total = sum(prev)
    return {
        "hist": hist,
        "pred": pred,
        "lower": lower,
        "upper": upper,
        "total": f_total,
        "prevTotal": prev_total,
        "growth": (f_total - prev_total) / prev_total if prev_total else 0,
        "slope": slope,
        "lift": lift,
    }
