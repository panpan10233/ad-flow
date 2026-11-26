# 智投引擎 AdFlow · Python 工程化后端

零第三方依赖的 Python 标准库后端，完整复刻原前端「智投引擎」的全部数据生成、指标派生、策略引擎、销售预测与执行层逻辑。前端展示层（UI / 图表 / 事件）保持原样，改由后端 API 驱动。

## 启动

```bash
cd ad-flow
python main.py
```

- Python 3.13+，无需 `pip install`
- 监听 `0.0.0.0:8788`，浏览器打开 <http://localhost:8788/>
- 停止：`Ctrl+C`

## 工程结构

```
ad-flow/
├── main.py                     # 入口：app.api.server.run()
├── app/
│   ├── config.py               # .env.local.json 加载/保存 + health
│   ├── models.py               # Channel/Product/Keyword/DailyRow/Metric/Strategy/ExecutionLog/Override
│   ├── rng.py                  # Python 版 mulberry32（逐位对齐 JS Math.imul / 32 位溢出）
│   ├── catalog.py              # 5 渠道 + 10 商品 + 14 关键词完整配置
│   ├── data_layer.py           # 120 天 × 5 渠道日数据生成、切片、汇总
│   ├── metrics.py              # derive + 渠道/商品/关键词/大盘指标 + override 折算
│   ├── strategy.py             # 四类策略（渠道/漏斗/商品/关键词）与格式化函数
│   ├── forecast.py             # 30 天历史 + 线性回归 + 星期节律 + 置信区间
│   ├── execution.py            # execute/undo/reset + before 快照日志 + JSON 持久化（线程锁）
│   ├── services/
│   │   └── ai.py               # buildContext / builtinDiagnosis / builtinAnswer / chat
│   ├── api/
│   │   ├── router.py           # 13 个 API 端点
│   │   └── server.py           # ThreadingHTTPServer + 静态托管 + CORS + 安全拦截
│   └── static/                 # index.html / styles.css / app.js（API 驱动版）
├── .env.local.json             # 服务端密钥（llm.key 默认为空）
├── .execution.json             # 执行层状态持久化（运行时生成，不下发前端）
└── server.js                   # 原 Node 版参考实现（保留）
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务健康、LLM 配置状态、渠道名 |
| POST | `/api/config` | 更新 LLM 的 baseUrl / key / model |
| GET | `/api/bootstrap` | 渠道/商品/关键词/120 天日期/600 行日数据/执行层状态 |
| GET | `/api/metrics?days=30&offset=0` | 全量派生指标（total/channels/products/keywords） |
| GET | `/api/strategies?days=30` | 策略清单（含 P0 数量） |
| GET | `/api/forecast?days=30` | 30 天预测（hist/pred/lower/upper/growth/lift） |
| GET | `/api/funnel?channel=amazon&days=30` | 5 阶段漏斗 + 三条基准线诊断 |
| POST | `/api/execute` | 执行动作，返回最新 overrides |
| POST | `/api/undo` | `{logId}` 撤销，返回最新 overrides |
| POST | `/api/reset` | 重置执行层 |
| POST | `/api/chat` | 大模型对话；无密钥时返回降级标记 |
| GET | `/api/report?days=30` | CSV 分析报告 |

## 数据与算法一致性

- RNG：`mulberry32(20261125)`，Python 实现逐位对齐 JS 的 `Math.imul` 与 32 位溢出；前后端生成完全相同的 600 行日数据。
- 生成顺序：每渠道每天依次消耗噪声 `.055 / .03 / .06 / .05 / .05 / .04 / .035`。
- 周末因子：`[0.86, 0.95, 1.00, 1.03, 1.08, 1.14, 1.10]`。
- 派生指标：`roas / ctr / cpc / cvr / atcRate / checkoutRate / payRate / aov / cpa`。
- 执行折算：加投 72% 边际效率、减投 60%、暂停归零，**仅作用于当前周期**，历史周期保留为基线。
- 预测：斜率 × 0.55 + 星期节律 + `sin(i*1.7)` 扰动 + 置信区间 `0.035 + 0.0022*i`。

## 前端改造点

- `app/static/app.js` 启动时 `fetch('/api/bootstrap')` 注入 `CHANNELS / C / PRODUCTS / KEYWORDS / DATES / DAILY / state.ov`（const 改 let）。
- `doExecute / undoExecution / resetAll` 先 POST 后端 API，用返回的 `overrides` 更新 `state.ov` 后渲染；确认弹窗与 toast 保留。
- `saveOv()` 改为空操作，持久化以后端为准。
- `buildStrategies() / buildForecast() / channelMetrics()` 等展示层算法保留不动，后端提供等价实现。
- UI、图表、事件绑定与页面渲染未改动。

## 密钥与安全

- `.env.local.json` 中 `llm.key` 默认为空，**未复用 product-radar 的 DeepSeek 密钥**；AI 默认走内置分析，用户可自行填写自己的密钥。
- 密钥只存服务端，任何 API 都不下发 key。
- 静态服务只从 `app/static` 提供文件，并显式拦截 `/.env*` 与 `*.py`，防止密钥与源码泄露。

## 验证

```bash
python -m compileall -q .
node --check app/static/app.js
curl -s http://localhost:8788/api/health
curl -s http://localhost:8788/api/bootstrap | python -c "import sys,json; d=json.load(sys.stdin); print(len(d['dates']), sum(len(v) for v in d['daily'].values()))"
```
