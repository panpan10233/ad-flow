const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8788);
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, '.env.local.json');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { llm: { baseUrl: 'https://api.openai.com/v1', key: '', model: 'gpt-4o-mini' } }; }
}
function saveConfig(cfg) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 }); }
function health(cfg) {
  return {
    ok: true,
    llm: { configured: !!(cfg.llm && cfg.llm.key), model: cfg.llm?.model || '', baseUrl: cfg.llm?.baseUrl || '' },
    channels: ['Amazon Ads', 'AliExpress', 'SHEIN Ads', 'TikTok Ads', 'Google Ads · 独立站']
  };
}
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(data));
}
function body(req) {
  return new Promise(resolve => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
}
async function apiChat(req, cfg) {
  const b = await body(req);
  const messages = b.messages || [];
  if (!messages.length) return { ok: false, error: '缺少 messages' };
  if (!cfg.llm || !cfg.llm.key) return { ok: false, code: 503, degrade: true, error: '未配置大模型密钥，前端将使用内置分析' };
  try {
    const r = await fetch(cfg.llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.llm.key },
      body: JSON.stringify({ model: cfg.llm.model, messages, temperature: 0.4, max_tokens: 900 }),
      signal: AbortSignal.timeout(45000)
    });
    const t = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 180));
    const d = JSON.parse(t);
    return { ok: true, model: cfg.llm.model, content: d.choices?.[0]?.message?.content || '', usage: d.usage };
  } catch (e) { return { ok: false, degrade: true, error: '大模型调用失败：' + e.message }; }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return json(res, 204, {});
  try {
    if (u.pathname === '/api/health') return json(res, 200, health(loadConfig()));
    if (u.pathname === '/api/config' && req.method === 'POST') {
      const b = await body(req); const cfg = loadConfig();
      if (b.llm) cfg.llm = {
        baseUrl: String(b.llm.baseUrl || cfg.llm?.baseUrl || 'https://api.openai.com/v1').trim(),
        key: String(b.llm.key || cfg.llm?.key || '').trim(),
        model: String(b.llm.model || cfg.llm?.model || 'gpt-4o-mini').trim()
      };
      saveConfig(cfg);
      return json(res, 200, { ok: true, health: health(cfg) });
    }
    if (u.pathname === '/api/chat' && req.method === 'POST') {
      const r = await apiChat(req, loadConfig()); return json(res, r.code || 200, r);
    }
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    if (p.startsWith('/.env')) return json(res, 403, { error: 'forbidden' });
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) return json(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { json(res, 500, { ok: false, error: String(e.message || e) }); }
});

server.listen(PORT, () => {
  console.log('\n  智投引擎 AdFlow 已启动');
  console.log('  ➜  本地访问: http://localhost:' + PORT);
  console.log('  ➜  密钥文件: ' + CONFIG_FILE + '（仅存本地，不会下发前端）');
  console.log('  ➜  按 Ctrl+C 停止\n');
});
