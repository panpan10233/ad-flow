/* =========================================================
   智投引擎 · 全域智能投流平台
   - 模拟全域投放数据（电商广告 / 社媒广告 / 独立站搜索）
   - 漏斗模型 + ROI 四象限 + 策略生成 + 销售预测
   ========================================================= */
'use strict';

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmtInt = n => Math.round(n).toLocaleString('en-US');
const fmtMoney = n => '¥' + Math.round(n).toLocaleString('en-US');
const fmtK = n => n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : Math.round(n).toLocaleString('en-US');
const fmtPct = (n, d = 1) => (n * 100).toFixed(d) + '%';
const fmtNum = (n, d = 2) => Number(n || 0).toFixed(d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = mulberry32(20261125);
const noise = (amp = .08) => 1 + (R() - .5) * 2 * amp;
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function nowStamp() { const d = new Date(); return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

/* ---------------- channel config（由后端 /api/bootstrap 注入） ---------------- */
let CHANNELS = [];
let C = {};

/* ---------------- daily data（由后端 /api/bootstrap 注入） ---------------- */
const TOTAL_DAYS = 120;
const TODAY = new Date();
let DATES = [];
let DAILY = {};

function sliceDays(id, days, offset = 0) {
  const arr = DAILY[id]; const end = arr.length - offset; const start = Math.max(0, end - days);
  return arr.slice(start, end);
}
function sumRows(rows) {
  const o = { spend: 0, impressions: 0, clicks: 0, adds: 0, checkouts: 0, orders: 0, gmv: 0 };
  rows.forEach(r => Object.keys(o).forEach(k => o[k] += r[k] || 0));
  return o;
}
function derive(m) {
  return {
    ...m,
    roas: m.spend ? m.gmv / m.spend : 0,
    ctr: m.impressions ? m.clicks / m.impressions : 0,
    cpc: m.clicks ? m.spend / m.clicks : 0,
    cvr: m.clicks ? m.orders / m.clicks : 0,
    atcRate: m.clicks ? m.adds / m.clicks : 0,
    checkoutRate: m.adds ? m.checkouts / m.adds : 0,
    payRate: m.checkouts ? m.orders / m.checkouts : 0,
    aov: m.orders ? m.gmv / m.orders : 0,
    cpa: m.orders ? m.spend / m.orders : 0
  };
}
function channelMetrics(id, days = state.days, offset = 0) {
  const m = derive(sumRows(sliceDays(id, days, offset)));
  // 执行动作只作用于当前周期，历史周期保持原样作为对比基线
  return offset === 0 ? applyChannelOverride(id, m) : m;
}
function allRows(days = state.days, offset = 0) { return CHANNELS.flatMap(c => sliceDays(c.id, days, offset)); }
function totalMetrics(days = state.days, offset = 0) {
  const acc = { spend: 0, impressions: 0, clicks: 0, adds: 0, checkouts: 0, orders: 0, gmv: 0 };
  CHANNELS.forEach(c => { const m = channelMetrics(c.id, days, offset); Object.keys(acc).forEach(k => acc[k] += m[k] || 0); });
  return derive(acc);
}

/* ---------------- products & keywords（由后端 /api/bootstrap 注入） ---------------- */
let PRODUCTS = [];
let KEYWORDS = [];

function productMetrics(p, days = state.days) {
  const cm = channelMetrics(p.ch, days);
  const ov = state.ov.products[p.id] || {};
  const bid = ov.bid || 0;
  const bidF = ov.status === 'paused' ? 0 : 1 + bid / 100;
  const peers = PRODUCTS.filter(x => x.ch === p.ch);
  const denom = peers.reduce((a, x) => { const o = state.ov.products[x.id] || {}; return a + x.share * (o.status === 'paused' ? 0 : 1 + (o.bid || 0) / 100); }, 0) || 1;
  const spend = cm.spend * p.share * bidF / denom;
  const effF = bid >= 0 ? 1 - bid / 100 * .18 : 1 - bid / 100 * .28;
  const gmv = spend * cm.roas * p.factor * effF;
  const orders = gmv / (cm.aov * p.aovF);
  const clicks = orders / (cm.cvr * p.cvrF);
  const adds = clicks * cm.atcRate;
  const checkouts = adds * cm.checkoutRate;
  const impressions = clicks / cm.ctr;
  return derive({ spend, gmv, orders, clicks, adds, checkouts, impressions });
}
function keywordMetrics(k, days = state.days) {
  const cm = channelMetrics(k.ch, days);
  const ov = state.ov.keywords[k.id] || {};
  const bid = ov.bid || 0;
  const active = ov.status !== 'paused' && !ov.negative;
  const bidF = active ? 1 + bid / 100 : 0;
  const peers = KEYWORDS.filter(x => x.ch === k.ch);
  const denom = peers.reduce((a, x) => { const o = state.ov.keywords[x.id] || {}; return a + x.share * (o.status === 'paused' || o.negative ? 0 : 1 + (o.bid || 0) / 100); }, 0) || 1;
  const spend = cm.spend * k.share * bidF / denom;
  const clicks = spend / k.cpc;
  const effF = bid >= 0 ? 1 - bid / 100 * .18 : 1 - bid / 100 * .28;
  const gmv = spend * k.roas * effF;
  const orders = gmv / k.aov;
  return derive({ spend, clicks, gmv, orders, impressions: clicks / cm.ctr, adds: clicks * cm.atcRate, checkouts: orders / cm.payRate });
}

/* ---------------- state ---------------- */
const OV_KEY = 'adflow.overrides.v1';
function emptyOv() {
  const channels = {}, products = {}, keywords = {};
  CHANNELS.forEach(c => channels[c.id] = { budget: 0, status: 'active' });
  PRODUCTS.forEach(p => products[p.id] = { bid: 0, status: 'active' });
  KEYWORDS.forEach(k => keywords[k.id] = { bid: 0, status: 'active', negative: false });
  return { channels, products, keywords, log: [], executed: {}, seq: 0 };
}
function loadOv() { return emptyOv(); }
function saveOv() { /* 执行层持久化以后端为准，前端不再写 localStorage */ }
const state = {
  section: 'overview', days: 30, funnelChannel: 'amazon',
  strategyFilter: 'all', assetTab: 'products', assetSearch: '', assetSort: 'roas', assetDesc: true,
  aiText: '', aiLoading: false, execLogFilter: 'all',
  scenario: { amazon: 0, aliexpress: 0, shein: 0, tiktok: 0, google: 0 },
  chartInstances: {}, chat: [], ov: null
};

/* ---------------- execution layer ---------------- */
function applyChannelOverride(id, m) {
  const ov = state.ov.channels[id] || { budget: 0, status: 'active' };
  const b = ov.status === 'paused' ? -100 : (ov.budget || 0);
  const sf = Math.max(0, 1 + b / 100);
  const gf = b >= 0 ? 1 + b / 100 * .72 : Math.max(0, 1 + b / 100 * .6);
  const out = { ...m, spend: m.spend * sf, gmv: m.gmv * gf };
  ['impressions', 'clicks', 'adds', 'checkouts'].forEach(k => out[k] = m[k] * sf);
  out.orders = m.orders * gf;
  out.cvr = out.clicks ? out.orders / out.clicks : m.cvr;
  out.atcRate = out.clicks ? out.adds / out.clicks : m.atcRate;
  out.payRate = out.checkouts ? out.orders / out.checkouts : m.payRate;
  return derive(out);
}
function ovTarget(level, id) {
  if (level === '渠道' || level === '漏斗') return state.ov.channels[id];
  if (level === '商品') return state.ov.products[id];
  if (level === '关键词') return state.ov.keywords[id];
  return null;
}
function targetName(level, id) {
  if (level === '渠道' || level === '漏斗') return C[id]?.name || id;
  if (level === '商品') return PRODUCTS.find(p => p.id === id)?.name || id;
  const k = KEYWORDS.find(x => x.id === id); return k ? k.word : id;
}
function targetIdOfStrategy(s) {
  if (s.id.startsWith('chpay-')) return s.id.slice(6);
  if (s.id.startsWith('ch-')) return s.id.slice(3);
  if (s.id.startsWith('p-')) return s.id.slice(2);
  if (s.id.startsWith('k-')) return s.id.slice(2);
  return '';
}
function pushLog(entry) {
  state.ov.seq += 1;
  state.ov.log.unshift({ id: 'op' + state.ov.seq, ts: nowStamp(), ...entry });
  if (state.ov.log.length > 100) state.ov.log.length = 100;
  saveOv();
}
/* 执行层：所有动作先 POST 后端，用返回的 overrides 更新 state.ov 再渲染 */
async function doExecute({ level, id, action, detail, impact, strategyId, silent }) {
  const ov = ovTarget(level, id); if (!ov) { toast('执行对象不存在'); return false; }
  const name = targetName(level, id);
  try {
    const r = await fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, id, action, detail, impact, strategyId }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '执行失败');
    state.ov = d.overrides;
  } catch (e) { toast('执行失败：' + e.message); return false; }
  if (!silent) toast(`已执行：${name} · ${action}`);
  return true;
}
function pushLogAndGet(entry) {
  state.ov.seq += 1;
  const id = 'op' + state.ov.seq;
  state.ov.log.unshift({ id, ts: nowStamp(), ...entry });
  if (state.ov.log.length > 100) state.ov.log.length = 100;
  saveOv(); return id;
}
async function undoExecution(logId) {
  const item = state.ov.log.find(x => x.id === logId);
  if (!item) return false;
  try {
    const r = await fetch('/api/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logId }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '撤销失败');
    state.ov = d.overrides;
  } catch (e) { toast('撤销失败：' + e.message); return false; }
  toast(`已撤销：${item.target} · ${item.action}`);
  return true;
}
async function resetAll() {
  try {
    const r = await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '重置失败');
    state.ov = d.overrides;
  } catch (e) { toast('重置失败：' + e.message); return false; }
  toast('已恢复原始投放状态');
  return true;
}
function executeStrategy(strategyId) {
  const s = buildStrategies().find(x => x.id === strategyId); if (!s) return;
  const id = targetIdOfStrategy(s);
  const detail = s.level === '渠道' && s.action === '加投' ? '预算 +25%' : s.level === '商品' && s.action === '加投' ? '出价 +30%' : s.level === '关键词' && s.action === '加投' ? '出价 +20%' : s.detail;
  showConfirm(`确认执行 · ${s.action}`, `<div class="confirm-row"><span>策略</span><b>${esc(s.title)}</b></div><div class="confirm-row"><span>对象</span><b>${esc(s.target)}</b></div><div class="confirm-row"><span>级别</span><b>${s.prio}</b></div><div class="confirm-row"><span>预估影响</span><b style="color:var(--down)">${fmtMoney(s.impact)}</b></div><div class="tiny muted" style="margin-top:10px;lineHeight:1.6">执行后将立即改写当前周期数据、漏斗、预测与策略清单，可在「执行中心」撤销。</div>`, async () => {
    await doExecute({ level: s.level, id, action: s.action, detail: { text: detail }, impact: s.impact, strategyId: s.id });
    render();
  });
}
function batchExecuteP0() {
  const list = buildStrategies().filter(s => s.prio === 'P0' && !state.ov.executed[s.id]);
  if (!list.length) { toast('没有待执行的 P0 策略'); return; }
  showConfirm('批量执行全部 P0', `<div class="confirm-row"><span>待执行</span><b>${list.length} 条策略</b></div><div class="confirm-row"><span>预计影响</span><b style="color:var(--down)">${fmtMoney(list.reduce((a, s) => a + s.impact, 0))}</b></div><div class="tiny muted" style="margin-top:10px">每条策略都会生成独立操作记录，可逐条撤销。</div>`, async () => {
    for (const s of list) { const id = targetIdOfStrategy(s); await doExecute({ level: s.level, id, action: s.action, detail: { text: s.detail.slice(0, 60) }, impact: s.impact, strategyId: s.id, silent: true }); }
    render(); toast(`已执行 ${list.length} 条 P0 策略`);
  });
}
function showConfirm(title, html, onConfirm) {
  showModal(`<div class="modal-head"><h3>${title}</h3><button class="icon-btn" id="closeModal"><i data-lucide="x"></i></button></div><div class="modal-body">${html}</div><div class="modal-foot"><button class="btn" id="cancelCfg">取消</button><button class="btn primary" id="confirmExec">确认执行</button></div>`);
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  const yes = $('#confirmExec'); if (yes) yes.onclick = () => { closeModal(); onConfirm(); };
}

/* ---------------- strategy engine ---------------- */
function actionOfRoas(r) { return r >= 3.2 ? '加投' : r >= 1.8 ? '优化' : r < 1.2 ? '暂停' : '减投'; }
function buildStrategies() {
  const out = [];
  CHANNELS.forEach(c => {
    const m = channelMetrics(c.id);
    if (m.roas >= 3.6) out.push({ id: 'ch-' + c.id, level: '渠道', target: c.name, action: '加投', prio: 'P0', title: `${c.name} ROAS 达 ${fmtNum(m.roas)}，建议加投 25%`, detail: `该渠道转化效率显著高于大盘，加投预算可优先获取边际流量。ROI 每提升 0.1 约带来 ${fmtK(m.gmv * .025)} 增量 GMV。`, impact: m.gmv * .18, conf: 92, reason: `ROAS ${fmtNum(m.roas)} · 转化率 ${fmtPct(m.cvr)} · CPA ${fmtMoney(m.cpa)}` });
    else if (m.roas < 1.8) out.push({ id: 'ch-' + c.id, level: '渠道', target: c.name, action: '减投', prio: 'P0', title: `${c.name} ROAS 仅 ${fmtNum(m.roas)}，建议压缩预算 40%`, detail: `花费占比不低但回收不足，建议先削减广泛匹配与低效素材，把预算迁移到高 ROI 渠道。`, impact: m.spend * .4, conf: 89, reason: `ROAS ${fmtNum(m.roas)} · 加购率 ${fmtPct(m.atcRate)} · 支付率 ${fmtPct(m.payRate)}` });
    else if (m.atcRate < .10) out.push({ id: 'ch-' + c.id, level: '渠道', target: c.name, action: '优化', prio: 'P1', title: `${c.name} 加购率偏低，先优化商品页再加预算`, detail: `点击到加购流失 ${fmtPct(1 - m.atcRate)}，问题在落地页/商品页而非流量质量。建议优化主图、价格锚点与运费文案。`, impact: m.gmv * .08, conf: 81, reason: `加购率 ${fmtPct(m.atcRate)} · 点击率 ${fmtPct(m.ctr)}` });
    else out.push({ id: 'ch-' + c.id, level: '渠道', target: c.name, action: '优化', prio: 'P2', title: `${c.name} 表现平稳，维持预算并优化结构`, detail: `ROAS ${fmtNum(m.roas)} 处于合理区间，建议保持预算，重点优化关键词出价与素材轮换。`, impact: m.gmv * .04, conf: 76, reason: `ROAS ${fmtNum(m.roas)} · 转化率 ${fmtPct(m.cvr)}` });
    if (m.payRate < .60) out.push({ id: 'chpay-' + c.id, level: '漏斗', target: c.name, action: '优化', prio: 'P1', title: `${c.name} 支付环节流失 ${fmtPct(1 - m.payRate)}`, detail: `下单后支付完成率仅 ${fmtPct(m.payRate)}，建议排查运费、支付方式与信任标识，预计可挽回 ${fmtK(m.checkouts * (0.68 - m.payRate))} 单/周期。`, impact: m.gmv * .06, conf: 84, reason: `支付率 ${fmtPct(m.payRate)} · 低于健康线 68%` });
  });
  PRODUCTS.forEach(p => {
    const m = productMetrics(p); const a = actionOfRoas(m.roas);
    if (p.factor >= 1.18) out.push({ id: 'p-' + p.id, level: '商品', target: p.name, action: '加投', prio: 'P0', title: `${p.name} 是效率标杆，建议加投 30%`, detail: `商品级 ROAS ${fmtNum(m.roas)}，客单价 ${fmtMoney(m.aov)}。建议提高出价抢占更多展示，并复制其素材结构到其他商品。`, impact: m.gmv * .26, conf: 90, reason: `ROAS ${fmtNum(m.roas)} · 转化率 ${fmtPct(m.cvr)} · ${C[p.ch].name}` });
    else if (p.factor <= .82) out.push({ id: 'p-' + p.id, level: '商品', target: p.name, action: a === '暂停' ? '暂停' : '减投', prio: 'P0', title: `${p.name} 低效消耗，建议${a === '暂停' ? '暂停并复盘' : '减投 40%'}`, detail: `商品级 ROAS 仅 ${fmtNum(m.roas)}，转化成本 ${fmtMoney(m.cpa)}。建议暂停低价流量词，重新测算毛利后再决定是否重启。`, impact: m.spend * .45, conf: 87, reason: `ROAS ${fmtNum(m.roas)} · CPA ${fmtMoney(m.cpa)} · ${C[p.ch].name}` });
    else if (p.factor < .95) out.push({ id: 'p-' + p.id, level: '商品', target: p.name, action: '优化', prio: 'P2', title: `${p.name} 微调出价与素材`, detail: `ROAS ${fmtNum(m.roas)}，距离健康线仍有空间。建议降低 10% 出价并测试新卖点素材。`, impact: m.gmv * .05, conf: 72, reason: `ROAS ${fmtNum(m.roas)} · ${C[p.ch].name}` });
  });
  KEYWORDS.forEach(k => {
    const m = keywordMetrics(k);
    if (k.roas >= 4.0) out.push({ id: 'k-' + k.id, level: '关键词', target: k.word, action: '加投', prio: 'P1', title: `"${k.word}" 高转化词，建议提价 20% 抢排名`, detail: `ROAS ${fmtNum(m.roas)}，点击成本 ${fmtMoney(m.cpc)}。该词为精准流量，建议提高出价巩固排名并扩展同类词根。`, impact: m.gmv * .22, conf: 88, reason: `ROAS ${fmtNum(m.roas)} · CPC ${fmtMoney(m.cpc)} · ${C[k.ch].name}` });
    else if (k.roas <= 1.5) out.push({ id: 'k-' + k.id, level: '关键词', target: k.word, action: k.roas < 1.2 ? '暂停' : '减投', prio: k.share > .12 ? 'P0' : 'P1', title: `"${k.word}" ${k.roas < 1.2 ? '亏损严重，建议否定' : '拖累 ROI，建议降价 30%'}`, detail: `该词消耗 ${fmtMoney(m.spend)} 但 ROAS 仅 ${fmtNum(m.roas)}，${k.match}匹配带来大量泛流量。建议${k.roas < 1.2 ? '加入否定词列表' : '降价并收窄匹配方式'}。`, impact: m.spend * (k.roas < 1.2 ? .9 : .35), conf: 91, reason: `ROAS ${fmtNum(m.roas)} · 消耗占比 ${fmtPct(k.share)} · ${k.match}匹配` });
  });
  const rank = { P0: 0, P1: 1, P2: 2 };
  return out.sort((a, b) => rank[a.prio] - rank[b.prio] || b.impact - a.impact);
}

/* ---------------- forecast ---------------- */
function gmvSeries(days) {
  return DATES.slice(-days).map((d, i) => {
    let v = 0; CHANNELS.forEach(c => v += DAILY[c.id][DAILY[c.id].length - days + i].gmv); return v;
  });
}
function linearSlope(arr) {
  const n = arr.length; if (n < 2) return 0;
  const xs = arr.map((_, i) => i), mx = (n - 1) / 2, my = arr.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0; xs.forEach((x, i) => { num += (x - mx) * (arr[i] - my); den += (x - mx) ** 2; });
  return den ? num / den : 0;
}
function buildForecast() {
  const rawHist = gmvSeries(30), prev = DATES.slice(-60, -30).map((d, i) => { let v = 0; CHANNELS.forEach(c => v += DAILY[c.id][DAILY[c.id].length - 60 + i].gmv); return v; });
  // 执行动作会改写当前周期，预测以「执行后的当前大盘」为新起点
  const rawTotal = rawHist.reduce((a, b) => a + b, 0);
  const curTotal = totalMetrics(30).gmv;
  const lift = rawTotal ? clamp(curTotal / rawTotal, .05, 3) : 1;
  const hist = rawHist.map(v => v * lift);
  const last = hist[hist.length - 1];
  const slope = linearSlope(hist) * .55;
  const dowRatios = Array(7).fill(1);
  for (let k = 0; k < 7; k++) {
    const vals = hist.filter((_, i) => DATES[DATES.length - 30 + i].dow === k);
    dowRatios[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length / last : 1;
  }
  const pred = [], lower = [], upper = [];
  for (let i = 1; i <= 30; i++) {
    const d = new Date(TODAY); d.setDate(d.getDate() + i);
    const base = last + slope * i;
    const v = Math.max(last * .5, base * dowRatios[d.getDay()] * (1 + .004 * Math.sin(i * 1.7)));
    const band = v * (.035 + .0022 * i);
    pred.push(v); lower.push(v - band); upper.push(v + band);
  }
  const total = pred.reduce((a, b) => a + b, 0), prevTotal = prev.reduce((a, b) => a + b, 0);
  return { hist, pred, lower, upper, total, prevTotal, growth: (total - prevTotal) / prevTotal, slope, lift };
}

/* ---------------- toast / modal ---------------- */
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
function showModal(html) { const b = $('#modalBackdrop'); b.innerHTML = '<div class="modal">' + html + '</div>'; b.classList.add('show'); }
function closeModal() { $('#modalBackdrop').classList.remove('show'); $('#modalBackdrop').innerHTML = ''; }

/* ---------------- chart helpers ---------------- */
function mkChart(id, config) {
  const el = document.getElementById(id); if (!el) return null;
  if (typeof Chart === 'undefined') { el.parentElement.innerHTML = '<div class="ai-empty">图表库加载失败，请检查网络后刷新</div>'; return null; }
  if (state.chartInstances[id]) { state.chartInstances[id].destroy(); delete state.chartInstances[id]; }
  state.chartInstances[id] = new Chart(el, config);
  return state.chartInstances[id];
}
const gridColor = '#eef1f6', tickColor = '#8b96a6';
const baseOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#546174', boxWidth: 10, font: { size: 11 } } } } };

/* ---------------- page shell ---------------- */
const SECTIONS = { overview: '总览驾驶舱', channels: '渠道矩阵', funnel: '漏斗诊断', roi: 'ROI 对比', assets: '商品与关键词', strategy: 'AI 投流策略', forecast: '销售预测', execution: '投流执行中心' };
function pageHead(title, desc, actions = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${desc}</p></div><div class="head-actions">${actions}</div></div>`;
}
function render() {
  $('#crumb').textContent = SECTIONS[state.section];
  const badge = $('#execBadge'); if (badge) badge.textContent = state.ov.log.length + ' 项执行';
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === state.section));
  const views = { overview: viewOverview, channels: viewChannels, funnel: viewFunnel, roi: viewROI, assets: viewAssets, strategy: viewStrategy, forecast: viewForecast, execution: viewExecution };
  $('#app').innerHTML = views[state.section]();
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  const after = { overview: afterOverview, channels: afterChannels, funnel: afterFunnel, roi: afterROI, assets: afterAssets, strategy: afterStrategy, forecast: afterForecast, execution: afterExecution };
  if (after[state.section]) after[state.section]();
}

/* ---------------- view: overview ---------------- */
function viewOverview() {
  const m = totalMetrics(), prev = totalMetrics(state.days, state.days);
  const chg = (a, b) => b ? (a - b) / b : 0;
  const trend = DATES.slice(-state.days).map((d, i) => {
    let s = 0, g = 0; CHANNELS.forEach(c => { const r = DAILY[c.id][DAILY[c.id].length - state.days + i]; s += r.spend; g += r.gmv; });
    return { s, g, label: d.label };
  });
  const alerts = buildStrategies().filter(x => x.prio === 'P0').slice(0, 4);
  return pageHead('总览驾驶舱', `全域投放实时快照 · 统计周期近 ${state.days} 天 · 数据更新于 ${nowStamp()}`,
    `<button class="btn" id="exportBtn"><i data-lucide="download"></i> 导出分析报告</button><button class="btn primary" id="goStrategy"><i data-lucide="wand-sparkles"></i> 生成投流策略</button>`) +
    `<div class="grid g4">
      ${kpi('总花费', fmtMoney(m.spend), chg(m.spend, prev.spend), 'wallet', 'var(--primary-soft)', 'var(--primary)', '较上周期')}
      ${kpi('成交 GMV', fmtMoney(m.gmv), chg(m.gmv, prev.gmv), 'shopping-cart', 'var(--down-soft)', 'var(--down)', '较上周期')}
      ${kpi('整体 ROAS', fmtNum(m.roas) + 'x', chg(m.roas, prev.roas), 'trending-up', 'var(--warn-soft)', 'var(--warn)', '较上周期')}
      ${kpi('支付订单', fmtInt(m.orders) + ' 单', chg(m.orders, prev.orders), 'package-check', 'var(--violet-soft)', 'var(--violet)', '较上周期')}
    </div>
    <div class="grid g-32 mt16">
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="activity"></i>花费与 GMV 趋势<span class="card-sub">按日</span></div><div class="flex small muted"><span class="tag blue">花费</span><span class="tag green">GMV</span></div></div><div class="card-body"><div class="chart-box h260"><canvas id="trendChart"></canvas></div></div></div>
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="pie-chart"></i>渠道花费结构</div></div><div class="card-body"><div class="chart-box h230"><canvas id="spendDonut"></canvas></div><div class="tiny muted center" style="margin-top:8px">电商广告 ${fmtPct(CHANNELS.filter(c=>c.group==='电商平台广告').reduce((a,c)=>a+channelMetrics(c.id).spend,0)/m.spend)} · 社媒 ${fmtPct(channelMetrics('tiktok').spend/m.spend)} · 独立站 ${fmtPct(channelMetrics('google').spend/m.spend)}</div></div></div>
    </div>
    <div class="grid g-32 mt16">
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="list"></i>渠道效果速览</div><button class="btn ghost small" id="goChannels">查看全部 <i data-lucide="arrow-right"></i></button></div><div class="card-body table-wrap"><table><thead><tr><th>渠道</th><th>花费</th><th>GMV</th><th>ROAS</th><th>转化率</th><th>CPA</th><th>建议</th></tr></thead><tbody>${CHANNELS.map(c => { const x = channelMetrics(c.id); const a = actionOfRoas(x.roas); return `<tr><td><div class="ch-name"><span class="ch-logo" style="background:${c.color}">${c.short}</span><span>${c.name}</span></div></td><td>${fmtK(x.spend)}</td><td>${fmtK(x.gmv)}</td><td class="roas ${x.roas>=3.2?'good':x.roas<1.8?'bad':'mid'}">${fmtNum(x.roas)}x</td><td>${fmtPct(x.cvr)}</td><td>${fmtMoney(x.cpa)}</td><td><span class="tag ${a==='加投'?'red':a==='减投'||a==='暂停'?'green':'amber'}">${a}</span></td></tr>`; }).join('')}</tbody></table></div></div>
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="bell-ring"></i>优先处理预警<span class="card-sub">P0</span></div><span class="tag red">${alerts.length} 项</span></div><div class="card-body" style="padding:8px 14px">${alerts.map(a => `<div style="padding:10px 4px;border-bottom:1px solid #f1f3f7"><div class="flex between"><b style="font-size:12.5px">${esc(a.title)}</b><span class="tag ${a.action==='加投'?'red':a.action==='优化'?'amber':'green'}">${a.action}</span></div><div class="tiny muted" style="margin-top:4px">${esc(a.reason)}</div></div>`).join('')}</div></div>
    </div>`;
}
function kpi(label, value, chg, icon, soft, color, foot) {
  const up = chg >= 0;
  return `<div class="card kpi" style="--kpi-soft:${soft};--kpi-color:${color}"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-icon"><i data-lucide="${icon}"></i></span></div><div class="kpi-value">${value}</div><div class="kpi-foot"><span class="chg ${up ? 'up' : 'down'}"><i data-lucide="arrow-${up ? 'up' : 'down'}-right"></i>${fmtPct(Math.abs(chg))}</span><span>${foot}</span></div></div>`;
}
function afterOverview() {
  const trend = DATES.slice(-state.days).map((d, i) => {
    let s = 0, g = 0; CHANNELS.forEach(c => { const r = DAILY[c.id][DAILY[c.id].length - state.days + i]; s += r.spend; g += r.gmv; });
    return { s, g, label: d.label };
  });
  mkChart('trendChart', { type: 'line', data: { labels: trend.map(t => t.label), datasets: [
    { label: '花费', data: trend.map(t => Math.round(t.s)), borderColor: '#2f6bff', backgroundColor: 'rgba(47,107,255,.08)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2 },
    { label: 'GMV', data: trend.map(t => Math.round(t.g)), borderColor: '#16a06a', backgroundColor: 'rgba(22,160,106,.06)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2 }
  ] }, options: { ...baseOpts, scales: { x: { grid: { display: false }, ticks: { color: tickColor, maxTicksLimit: 8, font: { size: 10 } } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, callback: v => '¥' + fmtK(v), font: { size: 10 } } } }, plugins: { ...baseOpts.plugins, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmtMoney(c.parsed.y) } } } } });
  mkChart('spendDonut', { type: 'doughnut', data: { labels: CHANNELS.map(c => c.name), datasets: [{ data: CHANNELS.map(c => Math.round(channelMetrics(c.id).spend)), backgroundColor: CHANNELS.map(c => c.color), borderWidth: 0, hoverOffset: 6 }] }, options: { ...baseOpts, cutout: '66%', plugins: { ...baseOpts.plugins, legend: { position: 'right', labels: { color: '#546174', boxWidth: 9, font: { size: 10.5 }, padding: 9 } } } } });
  $('#goStrategy').onclick = () => { state.section = 'strategy'; render(); };
  $('#goChannels').onclick = () => { state.section = 'channels'; render(); };
  $('#exportBtn').onclick = exportReport;
}

function exportReport() {
  const m = totalMetrics();
  const rows = [['模块', '对象', '花费', 'GMV', 'ROAS', '转化率', '建议']];
  CHANNELS.forEach(c => { const x = channelMetrics(c.id); rows.push(['渠道', c.name, Math.round(x.spend), Math.round(x.gmv), fmtNum(x.roas), fmtPct(x.cvr), actionOfRoas(x.roas)]); });
  PRODUCTS.forEach(p => { const x = productMetrics(p); rows.push(['商品', p.name, Math.round(x.spend), Math.round(x.gmv), fmtNum(x.roas), fmtPct(x.cvr), actionOfRoas(x.roas)]); });
  KEYWORDS.forEach(k => { const x = keywordMetrics(k); rows.push(['关键词', k.word, Math.round(x.spend), Math.round(x.gmv), fmtNum(x.roas), fmtPct(x.cvr), actionOfRoas(x.roas)]); });
  const f = buildForecast();
  rows.push([], ['大盘 ROAS', fmtNum(m.roas)], ['预计下月 GMV', Math.round(f.total)], ['预计环比', fmtPct(f.growth)]);
  const csv = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = '智投引擎_投放分析_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); URL.revokeObjectURL(a.href);
  toast('分析报告已导出');
}

/* ---------------- view: channels ---------------- */
function viewChannels() {
  const cards = CHANNELS.map(c => { const m = channelMetrics(c.id); const a = actionOfRoas(m.roas); return `<div class="card ch-card"><div class="ch-card-top"><span class="ch-logo lg" style="background:${c.color}">${c.short}</span><div><div class="ch-card-name">${c.name}</div><div class="ch-card-type">${c.group}</div></div></div><div class="ch-metrics"><div class="ch-metric"><label>花费</label><b>${fmtK(m.spend)}</b></div><div class="ch-metric"><label>GMV</label><b>${fmtK(m.gmv)}</b></div><div class="ch-metric"><label>ROAS</label><b class="roas ${m.roas>=3.2?'good':m.roas<1.8?'bad':'mid'}">${fmtNum(m.roas)}x</b></div><div class="ch-metric"><label>转化率</label><b>${fmtPct(m.cvr)}</b></div></div><div class="ch-card-foot"><span class="tag ${a==='加投'?'red':a==='减投'||a==='暂停'?'green':'amber'}">建议${a}</span><span class="tiny muted">CPA ${fmtMoney(m.cpa)}</span></div></div>`; }).join('');
  const m = totalMetrics();
  return pageHead('渠道矩阵', '电商平台广告 · 社交媒体广告 · 独立站搜索引流，统一口径对比',
    `<span class="tag blue">${CHANNELS.length} 个渠道</span><span class="tag gray">ROAS 口径：GMV / 花费</span>`) +
    `<div class="grid g3">${cards}</div>
    <div class="grid g2 mt16">
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="bar-chart-3"></i>渠道效率与规模</div></div><div class="card-body"><div class="chart-box h300"><canvas id="chBar"></canvas></div></div></div>
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="funnel"></i>渠道漏斗转化率对比</div></div><div class="card-body"><div class="chart-box h300"><canvas id="chFunnelBar"></canvas></div></div></div>
    </div>
    <div class="card mt16"><div class="card-head"><div class="card-title"><i data-lucide="table-2"></i>渠道明细与预算建议</div></div><div class="card-body table-wrap"><table><thead><tr><th>渠道</th><th>类型</th><th>花费</th><th>曝光</th><th>点击</th><th>CTR</th><th>CPC</th><th>加购率</th><th>转化率</th><th>ROAS</th><th>建议预算</th><th>直接操作</th></tr></thead><tbody>${CHANNELS.map(c => { const x = channelMetrics(c.id); const a = actionOfRoas(x.roas); const delta = a === '加投' ? 25 : a === '减投' ? -40 : a === '暂停' ? -90 : 0; const o = state.ov.channels[c.id]; const paused = o.status === 'paused'; return `<tr><td><div class="ch-name"><span class="ch-logo" style="background:${c.color}">${c.short}</span>${c.name}</div></td><td><span class="tag ${c.group==='电商平台广告'?'blue':c.group==='社交媒体广告'?'violet':'cyan'}">${c.group}</span></td><td>${fmtK(x.spend)}</td><td>${fmtK(x.impressions)}</td><td>${fmtK(x.clicks)}</td><td>${fmtPct(x.ctr, 2)}</td><td>${fmtMoney(x.cpc)}</td><td>${fmtPct(x.atcRate)}</td><td>${fmtPct(x.cvr, 2)}</td><td class="roas ${x.roas>=3.2?'good':x.roas<1.8?'bad':'mid'}">${fmtNum(x.roas)}x</td><td><b style="color:${delta>0?'var(--up)':delta<0?'var(--down)':'inherit'}">${delta ? (delta > 0 ? '+' : '') + delta + '%' : '维持'}</b></td><td><div class="ctrl-actions"><button class="mini-btn" data-ch-budget="${c.id}" data-val="25">+25%</button><button class="mini-btn" data-ch-budget="${c.id}" data-val="-25">−25%</button><button class="mini-btn ${paused ? 'go' : 'undo'}" data-ch-toggle="${c.id}">${paused ? '恢复' : '暂停'}</button></div>${o.budget ? `<div class="tiny muted" style="marginTop:4px">当前 ${o.budget > 0 ? '+' : ''}${o.budget}%</div>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
}
function afterChannels() {
  mkChart('chBar', { type: 'bar', data: { labels: CHANNELS.map(c => c.short), datasets: [
    { label: '花费（万元）', data: CHANNELS.map(c => +(channelMetrics(c.id).spend / 1e4).toFixed(1)), backgroundColor: CHANNELS.map(c => c.color + 'bb'), borderRadius: 6, yAxisID: 'y' },
    { label: 'ROAS', type: 'line', data: CHANNELS.map(c => +channelMetrics(c.id).roas.toFixed(2)), borderColor: '#16a06a', backgroundColor: '#16a06a', tension: .3, pointRadius: 4, borderWidth: 2.5, yAxisID: 'y1' }
  ] }, options: { ...baseOpts, scales: { x: { grid: { display: false } }, y: { position: 'left', grid: { color: gridColor }, title: { display: true, text: '万元', color: tickColor, font: { size: 10 } } }, y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'ROAS', color: tickColor, font: { size: 10 } }, suggestedMin: 0 } } } });
  mkChart('chFunnelBar', { type: 'bar', data: { labels: CHANNELS.map(c => c.short), datasets: [
    { label: '点击→加购', data: CHANNELS.map(c => +(channelMetrics(c.id).atcRate * 100).toFixed(1)), backgroundColor: '#2f6bffcc', borderRadius: 5 },
    { label: '加购→下单', data: CHANNELS.map(c => +(channelMetrics(c.id).checkoutRate * 100).toFixed(1)), backgroundColor: '#8b5cf6cc', borderRadius: 5 },
    { label: '下单→支付', data: CHANNELS.map(c => +(channelMetrics(c.id).payRate * 100).toFixed(1)), backgroundColor: '#16a06acc', borderRadius: 5 }
  ] }, options: { ...baseOpts, scales: { x: { grid: { display: false } }, y: { grid: { color: gridColor }, ticks: { callback: v => v + '%', color: tickColor } } } } });
  $$('[data-ch-budget]').forEach(b => b.onclick = () => {
    const id = b.dataset.chBudget, v = Number(b.dataset.val), next = clamp((state.ov.channels[id].budget || 0) + v, -80, 80);
    showConfirm('调整渠道预算', `<div class="confirm-row"><span>渠道</span><b>${C[id].name}</b></div><div class="confirm-row"><span>调整</span><b>${v > 0 ? '+' : ''}${v}%</b></div><div class="confirm-row"><span>调整后</span><b>${next > 0 ? '+' : ''}${next}%</b></div>`, async () => { await doExecute({ level: '渠道', id, action: '调整预算', detail: { text: `预算 ${v > 0 ? '+' : ''}${v}%（累计 ${next > 0 ? '+' : ''}${next}%）`, value: next }, impact: channelMetrics(id).gmv * Math.abs(v) / 100 * .72 }); render(); });
  });
  $$('[data-ch-toggle]').forEach(b => b.onclick = () => {
    const id = b.dataset.chToggle, paused = state.ov.channels[id].status === 'paused';
    showConfirm(paused ? '恢复渠道投放' : '暂停渠道投放', `<div class="confirm-row"><span>渠道</span><b>${C[id].name}</b></div><div class="confirm-row"><span>动作</span><b>${paused ? '恢复投放' : '暂停投放（预算归零）'}</b></div>`, async () => { await doExecute({ level: '渠道', id, action: paused ? '恢复' : '暂停', detail: { text: paused ? '恢复投放' : '暂停投放，预算归零' }, impact: paused ? 0 : -channelMetrics(id).gmv }); render(); });
  });
}

/* ---------------- view: funnel ---------------- */
function viewFunnel() {
  const m = channelMetrics(state.funnelChannel); const c = C[state.funnelChannel];
  const stages = [
    { name: '曝光', v: m.impressions, color: '#c7d8ff' },
    { name: '点击', v: m.clicks, color: '#8db0ff' },
    { name: '加购', v: m.adds, color: '#5b8dff' },
    { name: '下单', v: m.checkouts, color: '#2f6bff' },
    { name: '支付', v: m.orders, color: '#1d4fd7' }
  ];
  const max = stages[0].v;
  const funnelHtml = stages.map((s, i) => {
    const prev = i ? stages[i - 1].v : s.v;
    const conv = i ? s.v / prev : 1;
    const drop = i ? 1 - conv : 0;
    return `<div class="funnel-stage"><div class="funnel-stage-label">${s.name}</div><div class="funnel-bar-track"><div class="funnel-bar" style="width:${Math.max(9, s.v / max * 100)}%;background:${s.color};${i === 4 ? 'color:#fff' : i < 2 ? 'color:#1a3a7a' : ''}">${fmtK(s.v)}</div></div><div class="funnel-drop">${i ? '转化 ' + fmtPct(conv) : '入口 100%'}<small>${i ? '流失 ' + fmtPct(drop) : '总曝光量'}</small></div></div>`;
  }).join('');
  return pageHead('漏斗诊断', '曝光 → 点击 → 加购 → 下单 → 支付，定位每个渠道的关键流失环节',
    `<div class="funnel-select">${CHANNELS.map(x => `<button data-funnel="${x.id}" class="${x.id === state.funnelChannel ? 'active' : ''}">${x.name}</button>`).join('')}</div>`) +
    `<div class="grid g-32">
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="filter"></i>${c.name} 转化漏斗<span class="card-sub">近 ${state.days} 天</span></div><span class="tag ${m.roas>=3.2?'green':'amber'}">整体 ROAS ${fmtNum(m.roas)}x</span></div><div class="card-body"><div class="funnel-wrap">${funnelHtml}</div><div class="funnel-summary"><div><label>点击率 CTR</label><b>${fmtPct(m.ctr, 2)}</b></div><div><label>加购率</label><b>${fmtPct(m.atcRate)}</b></div><div><label>下单率</label><b>${fmtPct(m.checkoutRate)}</b></div><div><label>支付完成率</label><b>${fmtPct(m.payRate)}</b></div></div></div></div>
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="scan-search"></i>瓶颈诊断</div></div><div class="card-body">${diagnoseFunnel(m, c)}</div></div>
    </div>
    <div class="grid g2 mt16">
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="bar-chart-3"></i>各渠道漏斗转化率</div></div><div class="card-body"><div class="chart-box h300"><canvas id="funnelCompare"></canvas></div></div></div>
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="list"></i>漏斗明细</div></div><div class="card-body table-wrap"><table><thead><tr><th>环节</th><th>人数</th><th>环节转化</th><th>累计转化</th><th>流失人数</th></tr></thead><tbody>${stages.map((s, i) => `<tr><td><b>${s.name}</b></td><td>${fmtInt(s.v)}</td><td>${i ? fmtPct(s.v / stages[i-1].v) : '—'}</td><td>${fmtPct(s.v / m.impressions, i === 0 ? 1 : 3)}</td><td class="${i && 1 - s.v / stages[i-1].v > .7 ? 'roas bad' : ''}">${i ? fmtInt(stages[i-1].v - s.v) : '—'}</td></tr>`).join('')}</tbody></table><div class="tiny muted" style="margin-top:10px">累计转化口径：当前环节人数 / 曝光人数。点击率通常较低属正常，重点看加购与支付环节。</div></div></div>
    </div>`;
}
function diagnoseFunnel(m, c) {
  const items = [
    { label: '点击 → 加购', v: m.atcRate, good: .12, note: '低于 12% 说明商品页吸引力不足，优化主图、价格与评价。' },
    { label: '加购 → 下单', v: m.checkoutRate, good: .25, note: '低于 25% 通常因运费/优惠临门一脚缺失，建议限时券与免邮门槛。' },
    { label: '下单 → 支付', v: m.payRate, good: .68, note: '低于 68% 排查支付方式、信任标识与结账流程长度。' }
  ];
  return items.map(x => {
    const bad = x.v < x.good;
    return `<div style="padding:12px 0;border-bottom:1px solid #f1f3f7"><div class="between"><b style="font-size:12.5px">${x.label}</b><span class="tag ${bad ? 'red' : 'green'}">${bad ? '需优化' : '健康'} ${fmtPct(x.v)}</span></div><div class="bar-cell" style="margin-top:8px"><div class="bar-track"><div class="bar-fill" style="width:${clamp(x.v / x.good * 100, 4, 100)}%;background:${bad ? 'var(--up)' : 'var(--down)'}"></div></div><span class="tiny muted">基准 ${fmtPct(x.good)}</span></div><div class="tiny muted" style="margin-top:7px;line-height:1.6">${x.note}</div></div>`;
  }).join('') + `<div style="margin-top:14px;background:var(--primary-soft);border-radius:10px;padding:11px 12px;font-size:11.5px;color:#3b5aa0;line-height:1.6"><b>结论：</b>${m.atcRate < .10 ? '当前最大瓶颈在加购环节，优先优化商品页与素材匹配度。' : m.payRate < .60 ? '当前最大瓶颈在支付环节，优先优化结账体验。' : '漏斗整体健康，可加大优质流量投入并观察边际 ROI。'}</div>`;
}
function afterFunnel() {
  $$('[data-funnel]').forEach(b => b.onclick = () => { state.funnelChannel = b.dataset.funnel; render(); });
  mkChart('funnelCompare', { type: 'bar', data: { labels: CHANNELS.map(c => c.short), datasets: [
    { label: '加购率', data: CHANNELS.map(c => +(channelMetrics(c.id).atcRate * 100).toFixed(1)), backgroundColor: '#2f6bffcc', borderRadius: 5 },
    { label: '下单率', data: CHANNELS.map(c => +(channelMetrics(c.id).checkoutRate * 100).toFixed(1)), backgroundColor: '#8b5cf6cc', borderRadius: 5 },
    { label: '支付率', data: CHANNELS.map(c => +(channelMetrics(c.id).payRate * 100).toFixed(1)), backgroundColor: '#16a06acc', borderRadius: 5 }
  ] }, options: { ...baseOpts, scales: { x: { grid: { display: false } }, y: { grid: { color: gridColor }, ticks: { callback: v => v + '%', color: tickColor } } } } });
}

/* ---------------- view: ROI ---------------- */
const quadrantPlugin = {
  id: 'quadrantPlugin',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart; if (!chartArea) return;
    const x0 = scales.x.getPixelForValue(chart.options.plugins.quadrant.x);
    const y0 = scales.y.getPixelForValue(chart.options.plugins.quadrant.y);
    ctx.save();
    ctx.fillStyle = 'rgba(22,160,106,.06)'; ctx.fillRect(x0, chartArea.top, chartArea.right - x0, y0 - chartArea.top);
    ctx.fillStyle = 'rgba(229,72,77,.05)'; ctx.fillRect(chartArea.left, y0, x0 - chartArea.left, chartArea.bottom - y0);
    ctx.fillStyle = 'rgba(47,107,255,.05)'; ctx.fillRect(x0, y0, chartArea.right - x0, chartArea.bottom - y0);
    ctx.strokeStyle = '#cfd8e6'; ctx.setLineDash([5, 4]); ctx.beginPath();
    ctx.moveTo(x0, chartArea.top); ctx.lineTo(x0, chartArea.bottom);
    ctx.moveTo(chartArea.left, y0); ctx.lineTo(chartArea.right, y0); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#8b96a6'; ctx.font = '11px Inter, sans-serif';
    ctx.fillText('潜力区 · 低花费高回报', x0 + 8, chartArea.top + 16);
    ctx.fillText('明星区 · 规模加投', x0 + 8, y0 - 8);
    ctx.fillText('长尾区 · 观察', chartArea.left + 8, y0 + 16);
    ctx.fillText('问题区 · 减投', chartArea.left + 8, chartArea.bottom - 8);
    ctx.restore();
  }
};
function viewROI() {
  const prods = PRODUCTS.map(p => ({ ...p, m: productMetrics(p) }));
  const spendMedian = [...prods].sort((a, b) => a.m.spend - b.m.spend)[Math.floor(prods.length / 2)].m.spend;
  state._roiX = spendMedian;
  const totalGmv = totalMetrics().gmv;
  return pageHead('ROI 对比分析', '用四象限模型识别值得加投与需要收缩的商品，把预算挪到高回报单元',
    `<span class="tag blue">分析单元 ${prods.length} 个商品</span><span class="tag gray">横轴：花费　纵轴：ROAS</span>`) +
    `<div class="grid g-32">
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="scatter-chart"></i>商品 ROI 四象限</div><span class="card-sub">气泡大小 = GMV</span></div><div class="card-body"><div class="chart-box h380"><canvas id="roiScatter"></canvas></div></div></div>
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="lightbulb"></i>四象限解读</div></div><div class="card-body"><div class="quad-legend">
        <div style="background:var(--down-soft);color:#137a52"><b>明星区</b>高花费 · 高 ROAS。加投首选，注意边际递减。</div>
        <div style="background:var(--primary-soft);color:#2f55a8"><b>潜力区</b>低花费 · 高 ROAS。加大测试预算，有机会成为新增长点。</div>
        <div style="background:var(--up-soft);color:#b5363b"><b>问题区</b>高花费 · 低 ROAS。优先减投、收窄词包与人群。</div>
        <div style="background:#f0f2f6;color:#657188"><b>长尾区</b>低花费 · 低 ROAS。维持小预算观察，不盲目扩量。</div>
      </div><div style="margin-top:16px;padding:13px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;font-size:12px;line-height:1.7"><b>预算迁移建议：</b><br>将问题区约 <b style="color:var(--up)">${fmtMoney(prods.filter(p => p.m.roas < 1.8 && p.m.spend > spendMedian).reduce((a, p) => a + p.m.spend, 0) * .4)}</b> 的 40% 预算，迁移至明星区与潜力区，预计大盘 GMV 提升 <b style="color:var(--down)">${fmtPct(.06)}</b> 以上。</div></div></div>
    </div>
    <div class="card mt16"><div class="card-head"><div class="card-title"><i data-lucide="list"></i>商品级 ROI 排名与决策</div><span class="card-sub">合计 GMV ${fmtK(totalGmv)}</span></div><div class="card-body table-wrap"><table><thead><tr><th>商品</th><th>渠道</th><th>花费</th><th>GMV</th><th>ROAS</th><th>CPA</th><th>转化率</th><th>象限</th><th>决策</th></tr></thead><tbody>${prods.sort((a, b) => b.m.roas - a.m.roas).map(p => { const a = actionOfRoas(p.m.roas); const q = p.m.spend > spendMedian ? (p.m.roas >= 2.5 ? '明星' : '问题') : (p.m.roas >= 2.5 ? '潜力' : '长尾'); return `<tr><td><b>${p.name}</b><div class="tiny muted">${p.en}</div></td><td><span class="tag ${C[p.ch].group==='电商平台广告'?'blue':C[p.ch].group==='社交媒体广告'?'violet':'cyan'}">${C[p.ch].short}</span></td><td>${fmtK(p.m.spend)}</td><td>${fmtK(p.m.gmv)}</td><td class="roas ${p.m.roas>=3.2?'good':p.m.roas<1.8?'bad':'mid'}">${fmtNum(p.m.roas)}x</td><td>${fmtMoney(p.m.cpa)}</td><td>${fmtPct(p.m.cvr, 2)}</td><td><span class="tag ${q==='明星'?'green':q==='问题'?'red':q==='潜力'?'blue':'gray'}">${q}</span></td><td><span class="tag ${a==='加投'?'red':a==='减投'||a==='暂停'?'green':'amber'}">${a}${a==='加投'?' 30%':a==='减投'?' 40%':''}</span></td></tr>`; }).join('')}</tbody></table></div></div>`;
}
function afterROI() {
  const prods = PRODUCTS.map(p => ({ ...p, m: productMetrics(p) }));
  const x = state._roiX;
  mkChart('roiScatter', { type: 'bubble', data: { datasets: CHANNELS.map(c => ({ label: c.name, data: prods.filter(p => p.ch === c.id).map(p => ({ x: +(p.m.spend / 1e4).toFixed(2), y: +p.m.roas.toFixed(2), r: clamp(Math.sqrt(p.m.gmv / 1000) * 1.4, 7, 24), name: p.name })), backgroundColor: c.color + 'cc', borderColor: c.color, borderWidth: 1.5 })) }, options: { ...baseOpts, plugins: { ...baseOpts.plugins, quadrant: { x: x / 1e4, y: 2.5 }, tooltip: { callbacks: { label: ctx => ctx.raw.name + ' · 花费 ' + fmtMoney(ctx.raw.x * 1e4) + ' · ROAS ' + fmtNum(ctx.raw.y) } } }, scales: { x: { title: { display: true, text: '花费（万元）', color: tickColor, font: { size: 10 } }, grid: { color: gridColor } }, y: { title: { display: true, text: 'ROAS', color: tickColor, font: { size: 10 } }, grid: { color: gridColor }, suggestedMin: 0, suggestedMax: 6 } } }, plugins: [quadrantPlugin] });
}

/* ---------------- view: assets ---------------- */
function viewAssets() {
  const isK = state.assetTab === 'keywords';
  let rows = isK ? KEYWORDS.map(k => ({ ...k, m: keywordMetrics(k) })) : PRODUCTS.map(p => ({ ...p, m: productMetrics(p) }));
  const q = state.assetSearch.trim().toLowerCase();
  if (q) rows = rows.filter(r => (r.word || r.name || '').toLowerCase().includes(q) || (r.en || '').toLowerCase().includes(q));
  const key = state.assetSort;
  rows.sort((a, b) => { const av = key === 'name' ? (a.word || a.name) : a.m[key], bv = key === 'name' ? (b.word || b.name) : b.m[key]; const v = typeof av === 'string' ? av.localeCompare(bv) : av - bv; return state.assetDesc ? -v : v; });
  const th = (k, label) => `<th class="sortable" data-sort="${k}">${label}${state.assetSort === k ? (state.assetDesc ? ' ↓' : ' ↑') : ''}</th>`;
  return pageHead('商品与关键词', '下沉到投放单元，找出具体该加价、降价、否定的对象',
    `<div class="filter-row"><button data-tab="products" class="${!isK ? 'active' : ''}">商品 ${PRODUCTS.length}</button><button data-tab="keywords" class="${isK ? 'active' : ''}">关键词 ${KEYWORDS.length}</button></div>`) +
    `<div class="card"><div class="card-head"><div class="card-title"><i data-lucide="${isK ? 'key-round' : 'package'}"></i>${isK ? '关键词投放明细' : '商品投放明细'}<span class="card-sub">${rows.length} 条</span></div><input id="assetSearch" placeholder="搜索${isK ? '关键词' : '商品'}…" value="${esc(state.assetSearch)}" style="border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12px;width:210px;outline:none" /></div>
    <div class="card-body table-wrap"><table><thead><tr>${th('name', isK ? '关键词' : '商品')}<th>渠道</th>${isK ? '<th>匹配</th>' : ''}${th('spend', '花费')}${th('gmv', 'GMV')}${th('roas', 'ROAS')}${th('cvr', '转化率')}${th('cpc', 'CPC')}${th('cpa', 'CPA')}<th>决策</th><th>直接操作</th></tr></thead><tbody>
    ${rows.map(r => { const name = r.word || r.name; const a = actionOfRoas(r.m.roas); const ov = (isK ? state.ov.keywords : state.ov.products)[r.id] || {}; const paused = ov.status === 'paused' || ov.negative; const level = isK ? '关键词' : '商品'; return `<tr><td><b>${esc(name)}</b>${r.en ? `<div class="tiny muted">${r.en}</div>` : r.product ? `<div class="tiny muted">${r.product}</div>` : ''}</td><td><span class="tag ${C[r.ch].group==='电商平台广告'?'blue':C[r.ch].group==='社交媒体广告'?'violet':'cyan'}">${C[r.ch].short}</span></td>${isK ? `<td><span class="tag gray">${r.match}</span></td>` : ''}<td>${fmtK(r.m.spend)}</td><td>${fmtK(r.m.gmv)}</td><td class="roas ${r.m.roas>=3.2?'good':r.m.roas<1.8?'bad':'mid'}">${fmtNum(r.m.roas)}x</td><td>${fmtPct(r.m.cvr, 2)}</td><td>${fmtMoney(r.m.cpc)}</td><td>${fmtMoney(r.m.cpa)}</td><td><span class="tag ${a==='加投'?'red':a==='减投'||a==='暂停'?'green':'amber'}">${a}</span></td><td><div class="ctrl-actions"><button class="mini-btn" data-asset-bid="${r.id}" data-level="${level}" data-val="20">+20%</button><button class="mini-btn" data-asset-bid="${r.id}" data-level="${level}" data-val="-20">−20%</button><button class="mini-btn ${paused ? 'go' : 'undo'}" data-asset-toggle="${r.id}" data-level="${level}" data-paused="${paused}">${paused ? '恢复' : '暂停'}</button></div>${ov.bid ? `<div class="tiny muted" style="marginTop:4px">出价 ${ov.bid > 0 ? '+' : ''}${ov.bid}%</div>` : ''}</td></tr>`; }).join('')}
    </tbody></table>${rows.length ? '' : '<div class="ai-empty">没有匹配的结果</div>'}</div></div>`;
}
function afterAssets() {
  $$('[data-tab]').forEach(b => b.onclick = () => { state.assetTab = b.dataset.tab; render(); });
  $$('[data-sort]').forEach(t => t.onclick = () => { const k = t.dataset.sort; if (state.assetSort === k) state.assetDesc = !state.assetDesc; else { state.assetSort = k; state.assetDesc = true; } render(); });
  const inp = $('#assetSearch'); if (inp) { inp.oninput = e => { state.assetSearch = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#assetSearch'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }; }
  $$('[data-asset-bid]').forEach(b => b.onclick = () => {
    const id = b.dataset.assetBid, level = b.dataset.level, v = Number(b.dataset.val);
    const ov = (level === '关键词' ? state.ov.keywords : state.ov.products)[id];
    const next = clamp((ov.bid || 0) + v, -80, 80); const name = targetName(level, id);
    showConfirm('调整出价', `<div class="confirm-row"><span>对象</span><b>${esc(name)}</b></div><div class="confirm-row"><span>调整</span><b>${v > 0 ? '+' : ''}${v}%</b></div><div class="confirm-row"><span>调整后</span><b>${next > 0 ? '+' : ''}${next}%</b></div>`, async () => { await doExecute({ level, id, action: '调整出价', detail: { text: `出价 ${v > 0 ? '+' : ''}${v}%（累计 ${next > 0 ? '+' : ''}${next}%）`, value: next }, impact: 0 }); render(); });
  });
  $$('[data-asset-toggle]').forEach(b => b.onclick = () => {
    const id = b.dataset.assetToggle, level = b.dataset.level, paused = b.dataset.paused === 'true'; const name = targetName(level, id);
    showConfirm(paused ? '恢复投放' : '暂停投放', `<div class="confirm-row"><span>对象</span><b>${esc(name)}</b></div><div class="confirm-row"><span>动作</span><b>${paused ? '恢复投放' : level === '关键词' ? '暂停并加入否定' : '暂停投放'}</b></div>`, async () => { await doExecute({ level, id, action: paused ? '恢复' : '暂停', detail: { text: paused ? '恢复投放' : level === '关键词' ? '暂停并否定关键词' : '暂停投放' }, impact: 0 }); render(); });
  });
}

/* ---------------- view: strategy ---------------- */
function viewStrategy() {
  const all = buildStrategies();
  const f = state.strategyFilter;
  const list = f === 'all' ? all : all.filter(s => s.action === f);
  const p0 = all.filter(s => s.prio === 'P0' && !state.ov.executed[s.id]).length;
  const gain = all.filter(s => s.action === '加投').reduce((a, s) => a + s.impact, 0);
  const save = all.filter(s => s.action === '减投' || s.action === '暂停').reduce((a, s) => a + s.impact, 0);
  return pageHead('AI 投流策略', '基于漏斗与 ROI 分析自动生成下一步动作，可直接用大模型做深度诊断',
    `<button class="btn" id="builtinBtn"><i data-lucide="refresh-cw"></i> 重新分析</button><button class="btn" id="batchBtn"><i data-lucide="zap"></i> 一键执行 P0（${p0}）</button><button class="btn primary" id="aiBtn"><i data-lucide="sparkles"></i> AI 深度诊断</button>`) +
    `<div class="grid g4">
      ${kpi('策略总数', String(all.length), .08, 'wand-sparkles', 'var(--primary-soft)', 'var(--primary)', '覆盖渠道/商品/关键词')}
      ${kpi('P0 紧急项', String(p0), 0, 'siren', 'var(--up-soft)', 'var(--up)', '建议立即处理')}
      ${kpi('加投潜力', fmtK(gain), .12, 'trending-up', 'var(--down-soft)', 'var(--down)', '预计增量 GMV')}
      ${kpi('可节省预算', fmtK(save), .05, 'piggy-bank', 'var(--warn-soft)', 'var(--warn)', '减少低效消耗')}
    </div>
    <div class="grid g-32 mt16">
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="list-checks"></i>策略清单<span class="card-sub">${list.length} 条</span></div><div class="filter-row">${['all', '加投', '优化', '减投', '暂停'].map(x => `<button data-sfilter="${x}" class="${f === x ? 'active' : ''}">${x === 'all' ? '全部' : x}</button>`).join('')}</div></div>
      <div>${list.length ? list.map(s => `<div class="strategy-item"><span class="prio ${s.prio}">${s.prio}</span><div class="strategy-main"><div class="strategy-title">${esc(s.title)}<span class="tag ${s.level==='渠道'?'blue':s.level==='商品'?'violet':s.level==='关键词'?'cyan':'amber'}">${s.level}</span><span class="tag ${s.action==='加投'?'red':s.action==='优化'?'amber':'green'}">${s.action}</span></div><div class="strategy-detail">${esc(s.detail)}</div><div class="strategy-meta"><span>对象：<b>${esc(s.target)}</b></span><span>依据：<b>${esc(s.reason)}</b></span></div></div><div class="strategy-side"><div class="impact">${s.action === '加投' ? '+' : ''}${fmtK(s.impact)}</div><div class="conf">置信度 ${s.conf}%</div><button class="mini-btn ${state.ov.executed[s.id] ? 'done' : 'go'}" data-exec="${s.id}">${state.ov.executed[s.id] ? '已执行 ✓' : '执行 →'}</button></div></div>`).join('') : '<div class="ai-empty">该筛选下暂无策略</div>'}</div></div>
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="brain-circuit"></i>AI 深度诊断</div><span class="tag violet">大模型</span></div><div class="card-body"><div class="ai-block" id="aiBlock">${state.aiText ? esc(state.aiText) : '<div class="ai-empty">点击右上角「AI 深度诊断」，让模型结合当前投放数据生成完整策略报告。<br><br>也可在右下角对话助手中直接提问。</div>'}</div><div class="tiny muted" style="margin-top:10px;line-height:1.6">诊断基于近 ${state.days} 天的渠道、商品、关键词与漏斗指标生成。模型输出仅供参考，请结合实际毛利与库存决策。</div></div></div>
    </div>`;
}
function afterStrategy() {
  $$('[data-sfilter]').forEach(b => b.onclick = () => { state.strategyFilter = b.dataset.sfilter; render(); });
  $$('[data-exec]').forEach(b => b.onclick = () => {
    const s = buildStrategies().find(x => x.id === b.dataset.exec); if (!s) return;
    if (state.ov.executed[s.id]) { showConfirm('撤销已执行策略', `<div class="confirm-row"><span>对象</span><b>${esc(s.target)}</b></div><div class="tiny muted" style="margin-top:8px">将恢复到执行前的出价/预算状态。</div>`, async () => { await undoExecution(state.ov.executed[s.id].logId); render(); }); return; }
    executeStrategy(s.id);
  });
  $('#builtinBtn').onclick = () => { render(); toast('已按最新数据重新分析'); };
  $('#batchBtn').onclick = batchExecuteP0;
  $('#aiBtn').onclick = aiDiagnose;
}
function buildContext() {
  const m = totalMetrics(); const f = buildForecast();
  const lines = [];
  lines.push(`统计周期：近 ${state.days} 天；总花费 ${fmtMoney(m.spend)}，GMV ${fmtMoney(m.gmv)}，ROAS ${fmtNum(m.roas)}，订单 ${fmtInt(m.orders)}。`);
  lines.push('渠道表现：' + CHANNELS.map(c => { const x = channelMetrics(c.id); return `${c.name} 花费${fmtK(x.spend)}/GMV${fmtK(x.gmv)}/ROAS${fmtNum(x.roas)}/转化${fmtPct(x.cvr)}/加购率${fmtPct(x.atcRate)}/支付率${fmtPct(x.payRate)}`; }).join('；') + '。');
  lines.push('商品 ROI：' + PRODUCTS.map(p => { const x = productMetrics(p); return `${p.name}(${C[p.ch].short}) ROAS${fmtNum(x.roas)} CPA${fmtMoney(x.cpa)}`; }).join('；') + '。');
  lines.push('关键词 ROI：' + KEYWORDS.map(k => { const x = keywordMetrics(k); return `"${k.word}" 消耗${fmtK(x.spend)} ROAS${fmtNum(x.roas)} CPC${fmtMoney(x.cpc)}`; }).join('；') + '。');
  lines.push(`预测下月 GMV ${fmtMoney(f.total)}，环比 ${fmtPct(f.growth)}。`);
  return lines.join('\n');
}
async function aiDiagnose() {
  const btn = $('#aiBtn'); if (!btn) return;
  btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle"></i> 诊断中…';
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  state.aiText = '';
  const sys = '你是资深跨境电商投流优化师。基于以下真实投放数据，输出一份简洁可执行的中文策略报告：\n' + buildContext() + '\n要求：1) 指出最值得加投的渠道/商品/关键词及理由；2) 指出应减投或暂停的对象；3) 指出漏斗最大瓶颈与优化动作；4) 给出下月预算分配建议与销售额预估。用分点、简短、带具体数字。';
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'system', content: sys }, { role: 'user', content: '生成下一步投流策略报告' }] }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '模型不可用');
    state.aiText = d.content || '（模型未返回内容）';
    toast('AI 诊断完成');
  } catch (e) {
    state.aiText = '【内置分析降级输出】\n' + builtinDiagnosis();
    toast('模型暂不可用，已用内置分析生成报告');
  }
  btn.disabled = false; btn.innerHTML = '<i data-lucide="sparkles"></i> AI 深度诊断';
  render(); if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}
function builtinDiagnosis() {
  const ss = buildStrategies(); const f = buildForecast();
  const inc = ss.filter(s => s.action === '加投').slice(0, 4).map((s, i) => `${i + 1}. 加投「${s.target}」：${s.reason}，预计增量 ${fmtK(s.impact)}`).join('\n');
  const dec = ss.filter(s => s.action === '减投' || s.action === '暂停').slice(0, 4).map((s, i) => `${i + 1}. ${s.action}「${s.target}」：${s.reason}，可节省 ${fmtK(s.impact)}`).join('\n');
  const tt = channelMetrics('tiktok');
  return `一、加投优先级\n${inc}\n\n二、收缩清单\n${dec}\n\n三、漏斗瓶颈\nTikTok 加购率 ${fmtPct(tt.atcRate)}、支付率 ${fmtPct(tt.payRate)}，明显低于其他渠道，优先优化素材与结账体验后再考虑放量。\n\n四、下月预算与销售预估\n建议将问题区 40% 预算迁移至明星区与潜力区；预计下月 GMV ${fmtMoney(f.total)}，环比 ${fmtPct(f.growth)}。`;
}

/* ---------------- view: forecast ---------------- */
function viewForecast() {
  const f = buildForecast(); const m = totalMetrics();
  const labels = [...DATES.slice(-30).map(d => d.label), ...Array.from({ length: 30 }, (_, i) => { const d = new Date(TODAY); d.setDate(d.getDate() + i + 1); return `${d.getMonth() + 1}/${d.getDate()}`; })];
  const baseImpact = CHANNELS.reduce((a, c) => { const x = channelMetrics(c.id); const p = state.scenario[c.id] / 100; const marginal = p > 0 ? x.roas * .72 : x.roas * 1.05; return a + x.spend * p * marginal; }, 0);
  const scenarioTotal = f.total + baseImpact;
  return pageHead('销售预测', '基于历史 30 天趋势、周内节律与渠道边际 ROI，预测下月销售额',
    `<span class="tag blue">预测窗口 30 天</span><span class="tag gray">模型：趋势 + 周期 + 边际 ROI</span>`) +
    `<div class="grid g3">
      ${kpi('预计下月 GMV', fmtMoney(f.total), f.growth, 'calendar-days', 'var(--primary-soft)', 'var(--primary)', '未来 30 天累计')}
      ${kpi('环比变化', fmtPct(f.growth), f.growth, 'trending-up', f.growth >= 0 ? 'var(--down-soft)' : 'var(--up-soft)', f.growth >= 0 ? 'var(--down)' : 'var(--up)', '对比前 30 天')}
      ${kpi('日均预测', fmtMoney(f.total / 30), .02, 'activity', 'var(--warn-soft)', 'var(--warn)', '预测周期日均值')}
    </div>
    <div class="card mt16"><div class="card-head"><div class="card-title"><i data-lucide="chart-no-axes-combined"></i>历史与预测曲线<span class="card-sub">阴影为置信区间</span></div><div class="flex small muted"><span class="tag blue">实际</span><span class="tag violet">预测</span></div></div><div class="card-body"><div class="chart-box h340"><canvas id="forecastChart"></canvas></div></div></div>
    <div class="grid g-23 mt16">
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="sliders-horizontal"></i>预算沙盘<span class="card-sub">拖动查看 What-if</span></div><div class="flex"><button class="btn ghost small" id="resetScenario">重置</button><button class="btn primary small" id="applyScenario"><i data-lucide="play"></i> 应用到实盘</button></div></div><div class="card-body">${CHANNELS.map(c => `<div class="slider-row"><label>${c.name}</label><input type="range" min="-80" max="80" step="5" value="${state.scenario[c.id]}" data-sc="${c.id}"><output id="out-${c.id}">${state.scenario[c.id] > 0 ? '+' : ''}${state.scenario[c.id]}%</output></div>`).join('')}
      <div class="scenario-out"><label>调整后预计下月 GMV</label><b>${fmtMoney(scenarioTotal)}</b><div class="small ${baseImpact >= 0 ? 'chg up' : 'chg down'}">${baseImpact >= 0 ? '+' : ''}${fmtMoney(baseImpact)} 相对基准预测</div><div class="tiny muted" style="margin-top:6px">加投按当前 ROAS 的 72% 边际效率估算，减投按 105% 效率回收估算（削减低效流量）。点「应用到实盘」后沙盘数值将写入真实执行层。</div></div></div></div>
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="file-text"></i>预测依据与说明</div></div><div class="card-body" style="font-size:12.5px;line-height:1.85;color:#4d5b70">
        <p style="margin:0 0 10px"><b>1. 趋势项</b>：对近 30 天 GMV 做线性回归，取斜率的 55% 作为温和增长假设，避免外推过度。</p>
        <p style="margin:0 0 10px"><b>2. 周期项</b>：按星期几计算历史均值比例，还原周末/工作日的自然波动。</p>
        <p style="margin:0 0 10px"><b>3. 边际项</b>：结合各渠道 ROAS 与边际递减系数，模拟预算变化对 GMV 的影响。</p>
        <p style="margin:0 0 10px"><b>4. 置信区间</b>：随时间步长线性放大，越远的预测不确定性越高（约 ±3.5% 起）。</p>
        <div style="background:var(--warn-soft);border-radius:10px;padding:11px 12px;color:#96610a;font-size:11.5px;line-height:1.6"><b>提示：</b>预测基于演示数据。接入真实广告后台后，建议用 90 天以上历史数据与活动日历校准，重大促销需单独建模。</div>
        <div class="tiny muted" style="margin-top:12px">当前大盘 ROAS ${fmtNum(m.roas)}x · 预测环比 ${fmtPct(f.growth)} · 数据更新 ${nowStamp()}</div>
      </div></div>
    </div>`;
}
function afterForecast() {
  const f = buildForecast();
  const labels = [...DATES.slice(-30).map(d => d.label), ...Array.from({ length: 30 }, (_, i) => { const d = new Date(TODAY); d.setDate(d.getDate() + i + 1); return `${d.getMonth() + 1}/${d.getDate()}`; })];
  const actual = [...f.hist.map(v => Math.round(v)), ...Array(30).fill(null)];
  const pred = [...Array(30).fill(null), ...f.pred.map(v => Math.round(v))];
  const upper = [...Array(30).fill(null), ...f.upper.map(v => Math.round(v))];
  const lower = [...Array(30).fill(null), ...f.lower.map(v => Math.round(v))];
  mkChart('forecastChart', { type: 'line', data: { labels, datasets: [
    { label: '实际 GMV', data: actual, borderColor: '#2f6bff', backgroundColor: 'rgba(47,107,255,.07)', fill: true, tension: .3, pointRadius: 0, borderWidth: 2.2 },
    { label: '置信上界', data: upper, borderColor: 'transparent', backgroundColor: 'rgba(139,92,246,.10)', fill: '+1', pointRadius: 0, tension: .3 },
    { label: '置信下界', data: lower, borderColor: 'transparent', backgroundColor: 'transparent', pointRadius: 0, tension: .3 },
    { label: '预测 GMV', data: pred, borderColor: '#8b5cf6', borderDash: [6, 4], tension: .3, pointRadius: 0, borderWidth: 2.4 }
  ] }, options: { ...baseOpts, scales: { x: { grid: { display: false }, ticks: { color: tickColor, maxTicksLimit: 12, font: { size: 10 } } }, y: { grid: { color: gridColor }, ticks: { color: tickColor, callback: v => '¥' + fmtK(v), font: { size: 10 } } } }, plugins: { ...baseOpts.plugins, tooltip: { filter: c => c.parsed.y !== null, callbacks: { label: c => c.dataset.label + ': ' + fmtMoney(c.parsed.y) } } } } });
  $$('[data-sc]').forEach(el => el.oninput = e => {
    state.scenario[e.target.dataset.sc] = Number(e.target.value);
    $('#out-' + e.target.dataset.sc).textContent = (e.target.value > 0 ? '+' : '') + e.target.value + '%';
    clearTimeout(state._scTimer); state._scTimer = setTimeout(() => { const scroll = window.scrollY; render(); window.scrollTo(0, scroll); }, 220);
  });
  $('#resetScenario').onclick = () => { CHANNELS.forEach(c => state.scenario[c.id] = 0); render(); toast('沙盘已重置'); };
  $('#applyScenario').onclick = () => {
    const changes = CHANNELS.filter(c => state.scenario[c.id] !== 0);
    if (!changes.length) { toast('请先拖动滑杆设置预算变化'); return; }
    const impact = CHANNELS.reduce((a, c) => { const x = channelMetrics(c.id); const p = state.scenario[c.id] / 100; return a + x.spend * p * (p > 0 ? x.roas * .72 : x.roas * 1.05); }, 0);
    showConfirm('应用沙盘到实盘', `<div class="confirm-row"><span>渠道数</span><b>${changes.length} 个</b></div><div class="confirm-row"><span>预计影响</span><b style="color:var(--down)">${fmtMoney(impact)}</b></div><div class="tiny muted" style="marginTop:8px">将写入执行层并生成操作日志，可在执行中心撤销。</div>`, async () => {
      for (const c of changes) { const v = state.scenario[c.id]; const next = clamp((state.ov.channels[c.id].budget || 0) + v, -80, 80); await doExecute({ level: '渠道', id: c.id, action: '调整预算', detail: { text: `沙盘应用：预算 ${v > 0 ? '+' : ''}${v}%（累计 ${next > 0 ? '+' : ''}${next}%）`, value: next }, impact: channelMetrics(c.id).gmv * Math.abs(v) / 100 * .72, silent: true }); }
      CHANNELS.forEach(c => state.scenario[c.id] = 0);
      render(); toast(`已应用 ${changes.length} 个渠道的预算调整`);
    });
  };
}

/* ---------------- view: execution ---------------- */
function viewExecution() {
  const base = CHANNELS.reduce((a, c) => { const r = sliceDays(c.id, state.days); r.forEach(x => { a.spend += x.spend; a.gmv += x.gmv; }); return a; }, { spend: 0, gmv: 0 });
  const cur = totalMetrics();
  const deltaGmv = cur.gmv - base.gmv, deltaSpend = cur.spend - base.spend;
  const f = buildForecast(), rawForecast = f.total / (f.lift || 1);
  const logs = state.execLogFilter === 'all' ? state.ov.log : state.ov.log.filter(x => x.level === state.execLogFilter);
  const executedCount = Object.keys(state.ov.executed).length;
  const pendingP0 = buildStrategies().filter(s => s.prio === 'P0' && !state.ov.executed[s.id]).length;
  return pageHead('投流执行中心', '所有策略动作的真实执行、回滚与留痕 · 执行后指标与预测同步刷新',
    `<button class="btn" id="exportLog"><i data-lucide="download"></i> 导出操作日志</button><button class="btn" id="resetAll"><i data-lucide="rotate-ccw"></i> 重置全部</button><button class="btn primary" id="batchExec2"><i data-lucide="zap"></i> 一键执行 P0（${pendingP0}）</button>`) +
    `<div class="grid g4">
      ${kpi('已执行动作', String(state.ov.log.length), state.ov.log.length ? .1 : 0, 'check-check', 'var(--primary-soft)', 'var(--primary)', '含手动调整')}
      ${kpi('策略已落地', String(executedCount), 0, 'target', 'var(--down-soft)', 'var(--down)', '待执行 P0 ' + pendingP0 + ' 项')}
      ${kpi('预算变化', (deltaSpend >= 0 ? '+' : '') + fmtK(deltaSpend), Math.abs(deltaSpend) / (base.spend || 1), 'wallet', 'var(--warn-soft)', 'var(--warn)', '相对原始基线')}
      ${kpi('GMV 影响', (deltaGmv >= 0 ? '+' : '') + fmtK(deltaGmv), Math.abs(deltaGmv) / (base.gmv || 1), 'trending-up', deltaGmv >= 0 ? 'var(--down-soft)' : 'var(--up-soft)', deltaGmv >= 0 ? 'var(--down)' : 'var(--up)', '执行动作带来的变化')}
    </div>
    <div class="grid g-32 mt16">
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="scroll-text"></i>操作日志<span class="card-sub">${logs.length} 条 · 可逐条撤销</span></div><div class="filter-row">${['all', '渠道', '商品', '关键词', '漏斗'].map(x => `<button data-lfilter="${x}" class="${state.execLogFilter === x ? 'active' : ''}">${x === 'all' ? '全部' : x}</button>`).join('')}</div></div>
        <div>${logs.length ? logs.map(l => `<div class="log-item"><span class="log-icon ${l.action === '加投' || l.action === '恢复' ? 'up' : l.action === '暂停' || l.action === '减投' ? 'down' : 'neutral'}"><i data-lucide="${l.action === '暂停' ? 'circle-pause' : l.action === '恢复' ? 'circle-play' : l.action === '加投' ? 'arrow-up-right' : l.action === '减投' ? 'arrow-down-right' : 'settings-2'}"></i></span><div class="log-main"><div class="between"><b>${esc(l.target)} <span class="tag ${l.action === '加投' || l.action === '恢复' ? 'red' : l.action === '暂停' || l.action === '减投' ? 'green' : 'amber'}">${l.action}</span></b><span class="tiny muted nowrap">${l.ts}</span></div><div class="tiny muted" style="margin-top:4px">${esc(l.detail || l.level + ' · ' + l.action)}</div>${l.impact ? `<div class="tiny" style="margin-top:4px;color:var(--down)">影响 ${fmtMoney(l.impact)}</div>` : ''}</div><button class="mini-btn undo" data-undo="${l.id}">撤销</button></div>`).join('') : '<div class="ai-empty">还没有执行记录。去「AI 投流策略」执行建议，或在下方直接调整预算。</div>'}</div>
      </div>
      <div class="card"><div class="card-head"><div class="card-title"><i data-lucide="sliders-horizontal"></i>渠道实时控制台</div><span class="tag blue">改动即时生效</span></div><div class="card-body">
        ${CHANNELS.map(c => { const o = state.ov.channels[c.id]; const m = channelMetrics(c.id); const paused = o.status === 'paused'; return `<div class="ctrl-row"><div class="ctrl-top"><b>${c.name}</b><span class="tag ${paused ? 'gray' : o.budget ? 'blue' : 'gray'}">${paused ? '已暂停' : o.budget ? (o.budget > 0 ? '+' : '') + o.budget + '%' : '默认'}</span></div><div class="ctrl-meta small muted">当前预算 <b style="color:var(--text)">${fmtK(m.spend)}</b> · ROAS ${fmtNum(m.roas)}x</div><div class="ctrl-actions"><button class="mini-btn" data-budget="${c.id}" data-val="25">+25%</button><button class="mini-btn" data-budget="${c.id}" data-val="-25">−25%</button><button class="mini-btn ${paused ? 'go' : 'undo'}" data-toggle="${c.id}">${paused ? '恢复' : '暂停'}</button></div></div>`; }).join('')}
        <div class="scenario-out"><label>执行后预计下月 GMV</label><b>${fmtMoney(f.total)}</b><div class="small muted">原始预测 ${fmtMoney(rawForecast)} · 执行影响 ${(f.total - rawForecast >= 0 ? '+' : '') + fmtMoney(f.total - rawForecast)}</div></div>
      </div></div>
    </div>
    <div class="card mt16"><div class="card-head"><div class="card-title"><i data-lucide="info"></i>执行说明</div></div><div class="card-body small muted" style="lineHeight:1.8">
      执行动作会直接改写当前周期的预算、出价与启停状态，并联动更新所有分析页与销售预测；历史周期保持不变作为对比基线。加投按 72% 边际效率折算 GMV，减投按 60% 折算（削减低效部分），因此 ROAS 会随执行变化。所有操作记录保存在浏览器本地，刷新页面不丢失，可逐条撤销或整体重置。<br><span class="tag amber">注意</span> 当前为演示数据层，未连接各平台真实广告 API；接入真实平台后，此处应改为调用对应的预算/出价/启停接口。
    </div></div>`;
}
function afterExecution() {
  $$('[data-lfilter]').forEach(b => b.onclick = () => { state.execLogFilter = b.dataset.lfilter; render(); });
  $$('[data-undo]').forEach(b => b.onclick = async () => { await undoExecution(b.dataset.undo); render(); });
  $$('[data-budget]').forEach(b => b.onclick = () => {
    const id = b.dataset.budget, v = Number(b.dataset.val), o = state.ov.channels[id];
    const next = clamp((o.budget || 0) + v, -80, 80);
    showConfirm('调整渠道预算', `<div class="confirm-row"><span>渠道</span><b>${C[id].name}</b></div><div class="confirm-row"><span>调整</span><b>${v > 0 ? '+' : ''}${v}%</b></div><div class="confirm-row"><span>调整后</span><b>${(next > 0 ? '+' : '') + next}%</b></div>`, async () => {
      await doExecute({ level: '渠道', id, action: '调整预算', detail: { text: `预算 ${v > 0 ? '+' : ''}${v}%（累计 ${next > 0 ? '+' : ''}${next}%）`, value: next }, impact: channelMetrics(id).gmv * Math.abs(v) / 100 * .72 });
      render();
    });
  });
  $$('[data-toggle]').forEach(b => b.onclick = () => {
    const id = b.dataset.toggle, paused = state.ov.channels[id].status === 'paused';
    showConfirm(paused ? '恢复渠道投放' : '暂停渠道投放', `<div class="confirm-row"><span>渠道</span><b>${C[id].name}</b></div><div class="confirm-row"><span>动作</span><b>${paused ? '恢复投放' : '暂停投放（预算归零）'}</b></div>`, async () => {
      await doExecute({ level: '渠道', id, action: paused ? '恢复' : '暂停', detail: { text: paused ? '恢复投放' : '暂停投放，预算归零' }, impact: paused ? 0 : -channelMetrics(id).gmv });
      render();
    });
  });
  $('#batchExec2').onclick = batchExecuteP0;
  $('#resetAll').onclick = () => showConfirm('重置全部执行动作', '<div class="confirm-row"><span>影响</span><b>清空全部操作日志，恢复原始模拟数据</b></div><div class="tiny muted" style="marginTop:8px">此操作不可撤销。</div>', async () => {
    await resetAll(); render();
  });
  $('#exportLog').onclick = () => {
    const rows = [['时间', '级别', '对象', '动作', '详情', '影响(元)']];
    state.ov.log.forEach(l => rows.push([l.ts, l.level, l.target, l.action, l.detail, Math.round(l.impact || 0)]));
    const csv = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = '智投引擎_操作日志_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); URL.revokeObjectURL(a.href);
    toast('操作日志已导出');
  };
}

/* ---------------- chat ---------------- */
function addMsg(role, text) {
  const box = $('#chatMessages'); const el = document.createElement('div'); el.className = 'msg ' + role; el.innerHTML = role === 'ai' ? text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') : esc(text);
  box.appendChild(el); box.scrollTop = box.scrollHeight;
}
function builtinAnswer(q) {
  const s = q.toLowerCase();
  if (s.includes('加投') || s.includes('值得')) {
    const top = CHANNELS.map(c => ({ c, m: channelMetrics(c.id) })).sort((a, b) => b.m.roas - a.m.roas)[0];
    return `**最值得加投：${top.c.name}**\n当前 ROAS ${fmtNum(top.m.roas)}x，转化率 ${fmtPct(top.m.cvr)}，CPA ${fmtMoney(top.m.cpa)}，明显优于大盘 ${fmtNum(totalMetrics().roas)}x。建议加投 25%，同时把商品「${PRODUCTS.filter(p => p.ch === top.c.id).sort((a, b) => productMetrics(b).roas - productMetrics(a).roas)[0].name}」作为重点承接。`;
  }
  if (s.includes('减投') || s.includes('暂停')) {
    const p = [...PRODUCTS].sort((a, b) => productMetrics(a).roas - productMetrics(b).roas)[0]; const m = productMetrics(p);
    return `**建议减投：${p.name}**\nROAS 仅 ${fmtNum(m.roas)}x，CPA ${fmtMoney(m.cpa)}，转化成本偏高。建议先减投 40% 并收窄词包；若两周内 ROI 未回到 1.8 以上则暂停。`;
  }
  if (s.includes('下月') || s.includes('预测') || s.includes('销售额')) {
    const f = buildForecast(); return `**下月销售额预估**\n未来 30 天 GMV 预计约 ${fmtMoney(f.total)}，环比前 30 天 ${fmtPct(f.growth)}，日均 ${fmtMoney(f.total / 30)}。置信区间随时间放大，重大促销需要单独校准。`;
  }
  if (s.includes('tiktok') || s.includes('漏斗') || s.includes('瓶颈')) {
    const m = channelMetrics('tiktok'); return `**TikTok 漏斗诊断**\n加购率 ${fmtPct(m.atcRate)}（基准 12%）、下单率 ${fmtPct(m.checkoutRate)}、支付率 ${fmtPct(m.payRate)}（基准 68%）。最大流失在加购环节，说明流量兴趣度有但商品页承接不足：建议换素材卖点、加上社会证明与限时优惠，再观察 ROAS 是否回到 1.8 以上。`;
  }
  const ss = buildStrategies().slice(0, 3);
  return '根据当前数据，我建议优先处理：\n' + ss.map((x, i) => `${i + 1}. ${x.title}`).join('\n');
}
async function sendChat(text) {
  if (!text.trim()) return;
  addMsg('user', text); $('#chatInput').value = '';
  const typing = document.createElement('div'); typing.className = 'msg ai'; typing.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  $('#chatMessages').appendChild(typing); $('#chatMessages').scrollTop = 99999;
  let answer;
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'system', content: '你是跨境电商全域投流优化师。基于以下数据回答，中文、简短、带具体数字：\n' + buildContext() }, { role: 'user', content: text }] }) });
    const d = await r.json(); if (!d.ok) throw new Error(d.error); answer = d.content;
  } catch (e) { answer = builtinAnswer(text); }
  typing.innerHTML = answer.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  $('#chatMessages').scrollTop = 99999;
}

/* ---------------- events ---------------- */
function bindEvents() {
  $$('.nav-item').forEach(b => b.onclick = () => { state.section = b.dataset.section; render(); });
  $$('#rangeSelect button').forEach(b => b.onclick = () => {
    state.days = Number(b.dataset.days); $$('#rangeSelect button').forEach(x => x.classList.toggle('active', x === b));
    render(); toast('统计周期已切换为近 ' + state.days + ' 天');
  });
  $('#refreshBtn').onclick = () => { render(); toast('已按最新数据重新计算'); $('#engineTime').textContent = '上次计算 ' + nowStamp(); };
  $('#notifyBtn').onclick = () => { state.section = 'strategy'; state.strategyFilter = 'all'; render(); toast('已展示全部优先策略'); };
  $('#settingsBtn').onclick = () => showModal(`<div class="modal-head"><h3>数据与模型配置</h3><button class="icon-btn" id="closeModal"><i data-lucide="x"></i></button></div>
    <div class="modal-body">
      <div class="field"><label>大模型接口</label><input id="cfgBase" placeholder="https://api.deepseek.com/v1" /><small>兼容 OpenAI Chat Completions 协议</small></div>
      <div class="field"><label>API Key</label><input id="cfgKey" type="password" placeholder="留空则保持服务端已配置密钥" /><small>密钥仅保存在服务端 .env.local.json，不会下发前端</small></div>
      <div class="field"><label>模型名称</label><input id="cfgModel" placeholder="deepseek-chat" /></div>
      <div style="background:var(--primary-soft);border-radius:10px;padding:11px 12px;font-size:11.5px;color:#3b5aa0;line-height:1.6">当前演示使用模拟投放数据。接入真实平台时，可将 Amazon / Google Ads / TikTok / 各电商平台广告 API 的数据按相同字段结构写入数据层。</div>
    </div>
    <div class="modal-foot"><button class="btn" id="cancelCfg">取消</button><button class="btn primary" id="saveCfg">保存配置</button></div>`);
  $('#modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
  document.addEventListener('click', async e => {
    if (e.target.closest('#closeModal') || e.target.closest('#cancelCfg')) closeModal();
    if (e.target.closest('#saveCfg')) {
      const b = { llm: { baseUrl: $('#cfgBase').value.trim(), key: $('#cfgKey').value.trim(), model: $('#cfgModel').value.trim() } };
      if (!b.llm.key) delete b.llm.key; if (!b.llm.baseUrl) delete b.llm.baseUrl; if (!b.llm.model) delete b.llm.model;
      if (!Object.keys(b.llm).length) { closeModal(); toast('未填写修改项'); return; }
      try { const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const d = await r.json(); if (!d.ok) throw new Error(d.error); closeModal(); toast('模型配置已保存'); }
      catch (err) { toast('保存失败：' + err.message); }
    }
  });
  $('#chatFab').onclick = () => $('#chatPanel').classList.toggle('show');
  $('#chatClose').onclick = () => $('#chatPanel').classList.remove('show');
  $('#chatSend').onclick = () => sendChat($('#chatInput').value);
  $('#chatInput').onkeydown = e => { if (e.key === 'Enter') sendChat(e.target.value); };
  $$('#chatQuick .chip').forEach(b => b.onclick = () => sendChat(b.dataset.q));
}

/* ---------------- init：从后端 bootstrap 驱动全部数据 ---------------- */
async function init() {
  try {
    const r = await fetch('/api/bootstrap');
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '数据加载失败');
    CHANNELS = d.channels;
    C = Object.fromEntries(CHANNELS.map(c => [c.id, c]));
    PRODUCTS = d.products;
    KEYWORDS = d.keywords;
    DATES = d.dates;
    DAILY = d.daily;
    state.ov = d.overrides;
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    bindEvents();
    render();
    $('#engineTime').textContent = '上次计算 ' + nowStamp();
  } catch (e) {
    $('#app').innerHTML = '<div class="ai-empty">数据加载失败：' + esc(e.message) + '<br>请确认后端服务已启动。</div>';
  }
}
init();
