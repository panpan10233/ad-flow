import math

from .catalog import CHANNELS, KEYWORDS, PRODUCTS, channel_map
from .data_layer import clamp
from .metrics import channel_metrics, keyword_metrics, product_metrics
from .models import Strategy, to_dict

CHANNEL_BY_ID = channel_map()

def _js_round(n):
    return math.floor((n or 0) + 0.5)


def fmt_int(n):
    return f"{_js_round(n):,}"


def fmt_money(n):
    return "¥" + fmt_int(n)


def fmt_k(n):
    n = n or 0
    if n >= 1e8:
        return f"{n / 1e8:.2f}亿"
    if n >= 1e4:
        return f"{n / 1e4:.1f}万"
    return fmt_int(n)


def fmt_pct(n, d=1):
    return f"{(n or 0) * 100:.{d}f}%"


def fmt_num(n, d=2):
    return f"{(n or 0):.{d}f}"


def action_of_roas(r):
    return "加投" if r >= 3.2 else "优化" if r >= 1.8 else "暂停" if r < 1.2 else "减投"


def build_strategies(days=30, ov=None):
    out = []

    for c in CHANNELS:
        m = channel_metrics(c.id, days, 0, ov)
        if m.roas >= 3.6:
            out.append(Strategy(
                id="ch-" + c.id, level="渠道", target=c.name, action="加投", prio="P0",
                title=f"{c.name} ROAS 达 {fmt_num(m.roas)}，建议加投 25%",
                detail=f"该渠道转化效率显著高于大盘，加投预算可优先获取边际流量。ROI 每提升 0.1 约带来 {fmt_k(m.gmv * .025)} 增量 GMV。",
                impact=m.gmv * .18, conf=92,
                reason=f"ROAS {fmt_num(m.roas)} · 转化率 {fmt_pct(m.cvr)} · CPA {fmt_money(m.cpa)}",
            ))
        elif m.roas < 1.8:
            out.append(Strategy(
                id="ch-" + c.id, level="渠道", target=c.name, action="减投", prio="P0",
                title=f"{c.name} ROAS 仅 {fmt_num(m.roas)}，建议压缩预算 40%",
                detail="花费占比不低但回收不足，建议先削减广泛匹配与低效素材，把预算迁移到高 ROI 渠道。",
                impact=m.spend * .4, conf=89,
                reason=f"ROAS {fmt_num(m.roas)} · 加购率 {fmt_pct(m.atcRate)} · 支付率 {fmt_pct(m.payRate)}",
            ))
        elif m.atcRate < .10:
            out.append(Strategy(
                id="ch-" + c.id, level="渠道", target=c.name, action="优化", prio="P1",
                title=f"{c.name} 加购率偏低，先优化商品页再加预算",
                detail=f"点击到加购流失 {fmt_pct(1 - m.atcRate)}，问题在落地页/商品页而非流量质量。建议优化主图、价格锚点与运费文案。",
                impact=m.gmv * .08, conf=81,
                reason=f"加购率 {fmt_pct(m.atcRate)} · 点击率 {fmt_pct(m.ctr)}",
            ))
        else:
            out.append(Strategy(
                id="ch-" + c.id, level="渠道", target=c.name, action="优化", prio="P2",
                title=f"{c.name} 表现平稳，维持预算并优化结构",
                detail=f"ROAS {fmt_num(m.roas)} 处于合理区间，建议保持预算，重点优化关键词出价与素材轮换。",
                impact=m.gmv * .04, conf=76,
                reason=f"ROAS {fmt_num(m.roas)} · 转化率 {fmt_pct(m.cvr)}",
            ))

        if m.payRate < .60:
            out.append(Strategy(
                id="chpay-" + c.id, level="漏斗", target=c.name, action="优化", prio="P1",
                title=f"{c.name} 支付环节流失 {fmt_pct(1 - m.payRate)}",
                detail=f"下单后支付完成率仅 {fmt_pct(m.payRate)}，建议排查运费、支付方式与信任标识，预计可挽回 {fmt_k(m.checkouts * (0.68 - m.payRate))} 单/周期。",
                impact=m.gmv * .06, conf=84,
                reason=f"支付率 {fmt_pct(m.payRate)} · 低于健康线 68%",
            ))

    for p in PRODUCTS:
        m = product_metrics(p, days, ov)
        a = action_of_roas(m.roas)
        ch_name = CHANNEL_BY_ID[p.ch].name
        if p.factor >= 1.18:
            out.append(Strategy(
                id="p-" + p.id, level="商品", target=p.name, action="加投", prio="P0",
                title=f"{p.name} 是效率标杆，建议加投 30%",
                detail=f"商品级 ROAS {fmt_num(m.roas)}，客单价 {fmt_money(m.aov)}。建议提高出价抢占更多展示，并复制其素材结构到其他商品。",
                impact=m.gmv * .26, conf=90,
                reason=f"ROAS {fmt_num(m.roas)} · 转化率 {fmt_pct(m.cvr)} · {ch_name}",
            ))
        elif p.factor <= .82:
            out.append(Strategy(
                id="p-" + p.id, level="商品", target=p.name,
                action="暂停" if a == "暂停" else "减投", prio="P0",
                title=f"{p.name} 低效消耗，建议{'暂停并复盘' if a == '暂停' else '减投 40%'}",
                detail=f"商品级 ROAS 仅 {fmt_num(m.roas)}，转化成本 {fmt_money(m.cpa)}。建议暂停低价流量词，重新测算毛利后再决定是否重启。",
                impact=m.spend * .45, conf=87,
                reason=f"ROAS {fmt_num(m.roas)} · CPA {fmt_money(m.cpa)} · {ch_name}",
            ))
        elif p.factor < .95:
            out.append(Strategy(
                id="p-" + p.id, level="商品", target=p.name, action="优化", prio="P2",
                title=f"{p.name} 微调出价与素材",
                detail=f"ROAS {fmt_num(m.roas)}，距离健康线仍有空间。建议降低 10% 出价并测试新卖点素材。",
                impact=m.gmv * .05, conf=72,
                reason=f"ROAS {fmt_num(m.roas)} · {ch_name}",
            ))

    for k in KEYWORDS:
        m = keyword_metrics(k, days, ov)
        ch_name = CHANNEL_BY_ID[k.ch].name
        if k.roas >= 4.0:
            out.append(Strategy(
                id="k-" + k.id, level="关键词", target=k.word, action="加投", prio="P1",
                title=f'"{k.word}" 高转化词，建议提价 20% 抢排名',
                detail=f"ROAS {fmt_num(m.roas)}，点击成本 {fmt_money(m.cpc)}。该词为精准流量，建议提高出价巩固排名并扩展同类词根。",
                impact=m.gmv * .22, conf=88,
                reason=f"ROAS {fmt_num(m.roas)} · CPC {fmt_money(m.cpc)} · {ch_name}",
            ))
        elif k.roas <= 1.5:
            out.append(Strategy(
                id="k-" + k.id, level="关键词", target=k.word,
                action="暂停" if k.roas < 1.2 else "减投",
                prio="P0" if k.share > .12 else "P1",
                title=f'"{k.word}" {"亏损严重，建议否定" if k.roas < 1.2 else "拖累 ROI，建议降价 30%"}',
                detail=f"该词消耗 {fmt_money(m.spend)} 但 ROAS 仅 {fmt_num(m.roas)}，{k.match}匹配带来大量泛流量。建议{'加入否定词列表' if k.roas < 1.2 else '降价并收窄匹配方式'}。",
                impact=m.spend * (.9 if k.roas < 1.2 else .35), conf=91,
                reason=f"ROAS {fmt_num(m.roas)} · 消耗占比 {fmt_pct(k.share)} · {k.match}匹配",
            ))

    rank = {"P0": 0, "P1": 1, "P2": 2}
    return sorted(out, key=lambda s: (rank[s.prio], -s.impact))


def strategies_payload(days=30, ov=None):
    items = build_strategies(days, ov)
    return {
        "ok": True,
        "strategies": to_dict(items),
        "total": len(items),
        "p0": sum(1 for s in items if s.prio == "P0"),
    }
