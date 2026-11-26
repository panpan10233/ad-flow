from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List

@dataclass
class Channel:
    id: str
    name: str
    short: str
    group: str
    color: str
    spend: float
    cpm: float
    ctr: float
    atc: float
    checkout: float
    pay: float
    aov: float
    trend: float
    tier: str


@dataclass
class Product:
    id: str
    name: str
    en: str
    ch: str
    share: float
    factor: float
    cvrF: float
    aovF: float


@dataclass
class Keyword:
    id: str
    word: str
    ch: str
    product: str
    share: float
    cpc: float
    roas: float
    aov: float
    match: str


@dataclass
class DailyRow:
    date: Dict[str, Any]
    spend: float
    impressions: float
    clicks: float
    adds: float
    checkouts: float
    orders: float
    gmv: float


@dataclass
class Metric:
    spend: float = 0.0
    impressions: float = 0.0
    clicks: float = 0.0
    adds: float = 0.0
    checkouts: float = 0.0
    orders: float = 0.0
    gmv: float = 0.0
    roas: float = 0.0
    ctr: float = 0.0
    cpc: float = 0.0
    cvr: float = 0.0
    atcRate: float = 0.0
    checkoutRate: float = 0.0
    payRate: float = 0.0
    aov: float = 0.0
    cpa: float = 0.0


@dataclass
class Strategy:
    id: str
    level: str
    target: str
    action: str
    prio: str
    title: str
    detail: str
    impact: float
    conf: int
    reason: str


@dataclass
class ExecutionLog:
    id: str
    ts: str
    level: str
    targetId: str
    target: str
    action: str
    detail: str
    impact: float
    before: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Override:
    channels: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    products: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    keywords: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    log: List[Dict[str, Any]] = field(default_factory=list)
    executed: Dict[str, Any] = field(default_factory=dict)
    seq: int = 0


def to_dict(obj):
    """dataclass / list[dataclass] / dict 统一转为可 JSON 序列化对象。"""
    if hasattr(obj, "__dataclass_fields__"):
        return asdict(obj)
    if isinstance(obj, list):
        return [to_dict(x) for x in obj]
    if isinstance(obj, dict):
        return {k: to_dict(v) for k, v in obj.items()}
    return obj
