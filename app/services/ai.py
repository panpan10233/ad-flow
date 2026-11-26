import json
import urllib.request

from ..catalog import CHANNELS, KEYWORDS, PRODUCTS, channel_map
from ..config import load_config
from ..forecast import build_forecast
from ..metrics import channel_metrics, keyword_metrics, product_metrics, total_metrics
from ..strategy import (
    build_strategies, fmt_int, fmt_k, fmt_money, fmt_num, fmt_pct,
)

CHANNEL_BY_ID = channel_map()


def build_context(days=30, ov=None):
    """复刻前端 buildContext()，供 system prompt 使用。"""
    m = total_metrics(days, 0, ov)
    f = build_forecast(days, ov)
    lines = []
    lines.append(
        f"统计周期：近 {days} 天；总花费 {fmt_money(m.spend)}，GMV {fmt_money(m.gmv)}，"
        f"ROAS {fmt_num(m.roas)}，订单 {fmt_int(m.orders)}。"
    )
    lines.append("渠道表现：" + "；".join(
        f"{c.name} 花费{fmt_k(channel_metrics(c.id, days, 0, ov).spend)}"
        f"/GMV{fmt_k(channel_metrics(c.id, days, 0, ov).gmv)}"
        f"/ROAS{fmt_num(channel_metrics(c.id, days, 0, ov).roas)}"
        f"/转化{fmt_pct(channel_metrics(c.id, days, 0, ov).cvr)}"
        f"/加购率{fmt_pct(channel_metrics(c.id, days, 0, ov).atcRate)}"
        f"/支付率{fmt_pct(channel_metrics(c.id, days, 0, ov).payRate)}"
        for c in CHANNELS
    ) + "。")
    lines.append("商品 ROI：" + "；".join(
        f"{p.name}({CHANNEL_BY_ID[p.ch].short}) "
        f"ROAS{fmt_num(product_metrics(p, days, ov).roas)} "
        f"CPA{fmt_money(product_metrics(p, days, ov).cpa)}"
        for p in PRODUCTS
    ) + "。")
    lines.append("关键词 ROI：" + "；".join(
        f'"{k.word}" 消耗{fmt_k(keyword_metrics(k, days, ov).spend)} '
        f"ROAS{fmt_num(keyword_metrics(k, days, ov).roas)} "
        f"CPC{fmt_money(keyword_metrics(k, days, ov).cpc)}"
        for k in KEYWORDS
    ) + "。")
    lines.append(f"预测下月 GMV {fmt_money(f['total'])}，环比 {fmt_pct(f['growth'])}。")
    return "\n".join(lines)


def builtin_diagnosis(days=30, ov=None):
    """复刻前端 builtinDiagnosis()。"""
    ss = build_strategies(days, ov)
    f = build_forecast(days, ov)
    inc = "\n".join(
        f"{i + 1}. 加投「{s.target}」：{s.reason}，预计增量 {fmt_k(s.impact)}"
        for i, s in enumerate([s for s in ss if s.action == "加投"][:4])
    )
    dec = "\n".join(
        f"{i + 1}. {s.action}「{s.target}」：{s.reason}，可节省 {fmt_k(s.impact)}"
        for i, s in enumerate([s for s in ss if s.action in ("减投", "暂停")][:4])
    )
    tt = channel_metrics("tiktok", days, 0, ov)
    return (
        f"一、加投优先级\n{inc}\n\n"
        f"二、收缩清单\n{dec}\n\n"
        f"三、漏斗瓶颈\n"
        f"TikTok 加购率 {fmt_pct(tt.atcRate)}、支付率 {fmt_pct(tt.payRate)}，"
        f"明显低于其他渠道，优先优化素材与结账体验后再考虑放量。\n\n"
        f"四、下月预算与销售预估\n"
        f"建议将问题区 40% 预算迁移至明星区与潜力区；"
        f"预计下月 GMV {fmt_money(f['total'])}，环比 {fmt_pct(f['growth'])}。"
    )


def builtin_answer(question, days=30, ov=None):
    """复刻前端 builtinAnswer(q)。"""
    s = (question or "").lower()
    if "加投" in s or "值得" in s:
        ranked = sorted(
            [{"c": c, "m": channel_metrics(c.id, days, 0, ov)} for c in CHANNELS],
            key=lambda x: x["m"].roas, reverse=True,
        )
        top = ranked[0]
        peers = [p for p in PRODUCTS if p.ch == top["c"].id]
        best = sorted(peers, key=lambda p: product_metrics(p, days, ov).roas, reverse=True)[0]
        return (
            f"**最值得加投：{top['c'].name}**\n"
            f"当前 ROAS {fmt_num(top['m'].roas)}x，转化率 {fmt_pct(top['m'].cvr)}，"
            f"CPA {fmt_money(top['m'].cpa)}，明显优于大盘 {fmt_num(total_metrics(days, 0, ov).roas)}x。"
            f"建议加投 25%，同时把商品「{best.name}」作为重点承接。"
        )
    if "减投" in s or "暂停" in s:
        p = sorted(PRODUCTS, key=lambda p: product_metrics(p, days, ov).roas)[0]
        m = product_metrics(p, days, ov)
        return (
            f"**建议减投：{p.name}**\n"
            f"ROAS 仅 {fmt_num(m.roas)}x，CPA {fmt_money(m.cpa)}，转化成本偏高。"
            f"建议先减投 40% 并收窄词包；若两周内 ROI 未回到 1.8 以上则暂停。"
        )
    if "下月" in s or "预测" in s or "销售额" in s:
        f = build_forecast(days, ov)
        return (
            f"**下月销售额预估**\n"
            f"未来 30 天 GMV 预计约 {fmt_money(f['total'])}，"
            f"环比前 30 天 {fmt_pct(f['growth'])}，日均 {fmt_money(f['total'] / 30)}。"
            f"置信区间随时间放大，重大促销需要单独校准。"
        )
    if "tiktok" in s or "漏斗" in s or "瓶颈" in s:
        m = channel_metrics("tiktok", days, 0, ov)
        return (
            f"**TikTok 漏斗诊断**\n"
            f"加购率 {fmt_pct(m.atcRate)}（基准 12%）、下单率 {fmt_pct(m.checkoutRate)}、"
            f"支付率 {fmt_pct(m.payRate)}（基准 68%）。最大流失在加购环节，"
            f"说明流量兴趣度有但商品页承接不足：建议换素材卖点、加上社会证明与限时优惠，"
            f"再观察 ROAS 是否回到 1.8 以上。"
        )
    ss = build_strategies(days, ov)[:3]
    return "根据当前数据，我建议优先处理：\n" + "\n".join(
        f"{i + 1}. {x.title}" for i, x in enumerate(ss)
    )


def chat(messages, cfg=None, days=30, ov=None):
    """调用大模型；未配置密钥或调用失败时返回降级标记。"""
    if not messages:
        return {"ok": False, "error": "缺少 messages"}
    llm = (cfg or load_config()).get("llm") or {}
    key = llm.get("key")
    if not key:
        return {
            "ok": False, "code": 503, "degrade": True,
            "error": "未配置大模型密钥，前端将使用内置分析",
        }

    url = str(llm.get("baseUrl") or "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
    payload = json.dumps({
        "model": llm.get("model") or "gpt-4o-mini",
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 900,
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            text = resp.read().decode("utf-8")
        d = json.loads(text)
        choices = d.get("choices") or []
        content = (choices[0].get("message") or {}).get("content", "") if choices else ""
        return {
            "ok": True, "model": llm.get("model") or "gpt-4o-mini",
            "content": content or "", "usage": d.get("usage"),
        }
    except Exception as e:
        return {"ok": False, "degrade": True, "error": "大模型调用失败：" + str(e)}
