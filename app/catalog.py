from .models import Channel, Keyword, Product

CHANNELS = [
    Channel(id="amazon", name="Amazon Ads", short="AZ", group="电商平台广告", color="#ff9f1c", spend=38600, cpm=9.5, ctr=.034, atc=.14, checkout=.30, pay=.72, aov=39, trend=.012, tier="star"),
    Channel(id="aliexpress", name="AliExpress", short="AE", group="电商平台广告", color="#e5484d", spend=22400, cpm=6.2, ctr=.026, atc=.11, checkout=.26, pay=.68, aov=32, trend=.005, tier="mid"),
    Channel(id="shein", name="SHEIN Ads", short="SH", group="电商平台广告", color="#8b5cf6", spend=18900, cpm=7.0, ctr=.048, atc=.13, checkout=.24, pay=.65, aov=24, trend=.018, tier="star"),
    Channel(id="tiktok", name="TikTok Ads", short="TT", group="社交媒体广告", color="#111827", spend=26500, cpm=5.8, ctr=.039, atc=.085, checkout=.17, pay=.55, aov=28, trend=-.008, tier="weak"),
    Channel(id="google", name="Google Ads · 独立站", short="GG", group="独立站引流", color="#2f6bff", spend=31200, cpm=12.5, ctr=.052, atc=.15, checkout=.31, pay=.73, aov=25, trend=.009, tier="star"),
]

PRODUCTS = [
    Product(id="p1", name="TWS Pro 主动降噪耳机", en="Wireless Earbuds", ch="amazon", share=.28, factor=1.32, cvrF=1.12, aovF=1.05),
    Product(id="p2", name="智能运动手表 S2", en="Smart Watch", ch="amazon", share=.22, factor=.76, cvrF=.88, aovF=1.12),
    Product(id="p3", name="便携榨汁杯 380ml", en="Portable Blender", ch="aliexpress", share=.34, factor=1.18, cvrF=1.08, aovF=.96),
    Product(id="p4", name="蓝牙音箱 Mini", en="Bluetooth Speaker", ch="aliexpress", share=.30, factor=.88, cvrF=.92, aovF=.90),
    Product(id="p5", name="折叠防滑瑜伽垫", en="Yoga Mat", ch="shein", share=.30, factor=1.25, cvrF=1.15, aovF=1.02),
    Product(id="p6", name="磁吸手机壳", en="Magnetic Phone Case", ch="shein", share=.28, factor=.70, cvrF=.82, aovF=.78),
    Product(id="p7", name="快充车载支架", en="Car Phone Mount", ch="tiktok", share=.38, factor=.62, cvrF=.70, aovF=.86),
    Product(id="p8", name="轻量登山背包 40L", en="Hiking Backpack", ch="tiktok", share=.33, factor=.98, cvrF=.97, aovF=1.18),
    Product(id="p9", name="LED 护眼台灯", en="LED Desk Lamp", ch="google", share=.26, factor=1.30, cvrF=1.18, aovF=1.10),
    Product(id="p10", name="宠物自动饮水机", en="Pet Water Fountain", ch="google", share=.24, factor=.84, cvrF=.88, aovF=1.08),
]

KEYWORDS = [
    Keyword(id="k1", word="wireless earbuds", ch="google", product="TWS Pro 耳机", share=.18, cpc=1.42, roas=5.1, aov=46, match="精准"),
    Keyword(id="k2", word="cheap bluetooth earbuds", ch="google", product="TWS Pro 耳机", share=.13, cpc=.92, roas=1.2, aov=21, match="广泛"),
    Keyword(id="k3", word="led desk lamp", ch="google", product="LED 护眼台灯", share=.16, cpc=1.15, roas=4.6, aov=38, match="精准"),
    Keyword(id="k4", word="pet water fountain", ch="google", product="宠物饮水机", share=.13, cpc=1.32, roas=2.1, aov=34, match="词组"),
    Keyword(id="k5", word="smart watch fitness", ch="amazon", product="手表 S2", share=.14, cpc=.85, roas=3.9, aov=49, match="精准"),
    Keyword(id="k6", word="smart watch under 50", ch="amazon", product="手表 S2", share=.12, cpc=.70, roas=1.5, aov=35, match="广泛"),
    Keyword(id="k7", word="tws noise cancelling", ch="amazon", product="TWS Pro 耳机", share=.16, cpc=.95, roas=4.8, aov=55, match="精准"),
    Keyword(id="k8", word="portable blender", ch="aliexpress", product="便携榨汁杯", share=.14, cpc=.42, roas=3.2, aov=26, match="精准"),
    Keyword(id="k9", word="mini juicer cup", ch="aliexpress", product="便携榨汁杯", share=.11, cpc=.38, roas=1.9, aov=19, match="广泛"),
    Keyword(id="k10", word="yoga mat non slip", ch="shein", product="折叠瑜伽垫", share=.13, cpc=.34, roas=4.0, aov=27, match="精准"),
    Keyword(id="k11", word="foldable yoga mat", ch="shein", product="折叠瑜伽垫", share=.10, cpc=.30, roas=2.2, aov=22, match="词组"),
    Keyword(id="k12", word="car phone mount viral", ch="tiktok", product="车载支架", share=.15, cpc=.28, roas=.9, aov=21, match="广泛"),
    Keyword(id="k13", word="hiking backpack 40l", ch="tiktok", product="登山背包", share=.12, cpc=.36, roas=1.6, aov=32, match="精准"),
    Keyword(id="k14", word="magnetic phone case", ch="tiktok", product="磁吸手机壳", share=.11, cpc=.25, roas=1.1, aov=18, match="广泛"),
]


def channel_map():
    return {c.id: c for c in CHANNELS}


def product_map():
    return {p.id: p for p in PRODUCTS}


def keyword_map():
    return {k.id: k for k in KEYWORDS}
