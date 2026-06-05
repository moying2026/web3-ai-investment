# Binance Web3 Skills 能力清单

> 版本：v1.0
> 日期：2026-06-05
> 更新人：项目牧羊人
> 来源：https://github.com/binance/binance-skills-hub（已 fork 到 https://github.com/moying2026/binance-skills-hub）
> 安装路径：~/.agents/skills/

---

## 一、Skills 总览

| Skill | 用途 | CLI | 版本 |
|:--|:--|:--|:--|
| binance-agentic-wallet | Web3 钱包操作（交易/余额/转账） | baw | 1.1.1 |
| binance-tokenized-securities-info | Ondo 代币化美股数据 | - | - |
| crypto-market-rank | 市场排行榜（趋势/聪明钱/交易员） | - | 3.0 |
| meme-rush | Meme 代币实时发射台 + AI 热门话题 | - | 2.0 |
| query-address-info | 钱包地址持仓查询 | - | 2.0 |
| query-token-audit | 代币安全审计（蜜罐/跑路/恶意合约） | - | 1.4 |
| query-token-info | 代币详情（价格/K线/持有人/社交） | - | 2.0 |
| trading-signal | 聪明钱交易信号（买卖事件） | - | 2.0 |

---

## 二、binance-agentic-wallet（核心交易能力）

### 2.1 认证

| 命令 | 说明 |
|:--|:--|
| `baw auth signin` | 登录/连接钱包 |
| `baw auth verify` | 验证登录状态 |
| `baw auth signout` | 登出/断开钱包 |

### 2.2 钱包查看

| 命令 | 说明 |
|:--|:--|
| `baw wallet status` | 钱包连接状态 |
| `baw wallet chains` | 支持的链列表 |
| `baw wallet address` | 钱包地址 |
| `baw wallet balance` | 代币余额 |
| `baw wallet tx-history` | 交易历史 |
| `baw wallet settings` | 安全设置 + 每日额度 |
| `baw wallet tx-lock` | 待确认交易检查 |

### 2.3 市价交易（Swap）

| 命令 | 说明 |
|:--|:--|
| `baw market-order swap` | 市价 swap（即时交易） |
| `baw market-order quote` | 获取报价（不交易） |
| `baw market-order list` | 查看市价单状态 |

**参数：**
- `--fromTokenQty`：数量
- `--fromToken`：源代币合约地址
- `--toToken`：目标代币合约地址
- `--binanceChainId`：56(BSC) / CT_501(Solana)
- `--slippage`：滑点（auto 或 0-100）
- `--mev`：MEV 保护（true/false）
- `--gasLevel`：LOW/MEDIUM/HIGH

**返回：** `{ "success": true, "data": { "orderId": "xxx" } }`

### 2.4 限价交易（止盈止损核心）

| 命令 | 说明 |
|:--|:--|
| `baw limit-order buy` | 限价买入（到价自动成交） |
| `baw limit-order sell` | 限价卖出（到价自动成交） |
| `baw limit-order list` | 查看限价单状态 |
| `baw limit-order cancel` | 取消限价单 |

**参数：**
- `--triggerPrice`：触发价格（USD）
- `--fromTokenQty`：数量
- `--fromToken`：源代币合约地址
- `--toToken`：目标代币合约地址（USDT/USDC/BNB）
- `--binanceChainId`：56(BSC) / CT_501(Solana)

**返回：** `{ "success": true, "data": { "strategyId": "xxx" } }`

**关键：限价单提交到链上，到价自动成交，不需要我们轮询检测！**

### 2.5 转账

| 命令 | 说明 |
|:--|:--|
| `baw wallet send` | 发送/转账代币 |

### 2.6 预测市场

| 命令 | 说明 |
|:--|:--|
| `baw prediction category list` | 预测市场分类 |
| `baw prediction market list` | 浏览预测市场 |
| `baw prediction trade place-order` | 下注 |
| `baw prediction position list` | 我的仓位 |
| `baw prediction trade redeem` | 兑换奖励 |

---

## 三、query-token-audit（代币安全审计）

检测蜜罐、跑路合约、恶意函数。交易前必须审计。

| API | 功能 |
|:--|:--|
| Token Security Audit | 代币安全扫描 |

---

## 四、query-token-info（代币详情）

| 子命令 | 功能 |
|:--|:--|
| search | 按关键词/符号/合约搜索代币 |
| meta | 静态信息：名称/符号/Logo/社交/创建者 |
| dynamic | 实时数据：价格/24h涨跌/成交量/持有人/流动性 |
| kline | OHLCV K线数据 |

---

## 五、trading-signal（聪明钱信号）

追踪专业投资者的链上买卖事件：
- 买入/卖出信号
- 触发价格 vs 当前价格
- 最大涨幅
- 退出率

支持链：BSC、Solana

---

## 六、crypto-market-rank（市场排行榜）

| 排行榜 | 说明 |
|:--|:--|
| 社交热度排行 | 按社交讨论量排名 |
| 趋势排行 | 热门代币 |
| Binance Alpha | Alpha 代币 |
| 聪明钱净流入 | 哪些代币收到最多聪明钱 |
| 交易员 PnL 排行 | ALL / KOL |

---

## 七、meme-rush（Meme 发射台）

| 子命令 | 功能 |
|:--|:--|
| meme-rush | Pump.fun / Four.meme 实时发射台 |
| topic-rush | AI 检测的热门叙事 + 关联代币 |

---

## 八、binance-tokenized-securities-info（代币化美股）

Ondo 代币化美股数据：
- 支持的股票代币列表
- RWA 元数据（公司信息/审计报告）
- 链上数据（价格/持有人/流通量/市值）
- 美股基本面（PE/股息率/52周区间）
- K线数据

---

## 九、集成建议

### 9.1 模拟盘 → 实盘切换

当前模拟盘使用本地轮询检测价格。切换实盘时：
1. 安装 `baw` CLI：`npm install -g @binance/agentic-wallet`
2. 登录：`baw auth signin`
3. 买入用 `baw market-order swap`（市价）或 `baw limit-order buy`（限价）
4. 止盈止损用 `baw limit-order sell`（链上限价单，到价自动成交）
5. 不需要 30 秒轮询，链上自动执行

### 9.2 代币安全审计

交易前调用 `query-token-audit` 检查合约安全性。

### 9.3 聪明钱信号

结合 `trading-signal` 追踪专业投资者的买卖信号。

### 9.4 表结构对齐

`baw` 返回的字段：
- 市价单：`orderId`
- 限价单：`strategyId`

sim_trades 表的 `exchange_order_id` 字段存储这些 ID。

---

## 十一、底层 API 端点明细（直接调用，不经过 CLI）

> 以下 API 端点从 baw CLI 源码（@binance/agentic-wallet@1.1.1）提取。
> 基础 URL：`https://web3.binance.com`
> 所有 API 均为 REST，可直接用 Node.js fetch/axios 调用。
> 数据 API 无需认证，交易 API 需要 `agentSessionId` cookie。

### 11.1 交易 API（核心，需登录）

#### 市价 Swap 报价
```
POST /bapi/defi/v1/public/wallet-direct/web-dex/agent/quote
```
| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| binanceChainId | string | 是 | 56(BSC) / CT_501(Solana) / 8453(Base) / 1(ETH) |
| fromToken | string | 是 | 源代币合约地址 |
| toToken | string | 是 | 目标代币合约地址 |
| amount | string | 是 | 输入数量（人类可读格式） |
| slippage | string | 否 | 滑点："auto" 或 "0.01"-"1" |

返回：`{ code, data: { quoteId, fromCoinSymbol, fromCoinAmount, toCoinSymbol, toCoinAmount, slippage, feeDetail, gasDetails } }`

#### 市价 Swap 下单
```
POST /bapi/defi/v1/public/wallet-direct/web-dex/agent/place-order
```
| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| binanceChainId | string | 是 | 链 ID |
| fromToken | string | 是 | 源代币合约地址 |
| toToken | string | 是 | 目标代币合约地址 |
| amount | string | 是 | 输入数量 |
| slippage | string | 否 | 滑点（默认 auto） |
| mev | boolean | 否 | MEV 保护（默认 true） |
| gasLevel | string | 否 | LOW/MEDIUM/HIGH（默认 HIGH） |

返回：`{ code, data: { orderId, clientOrderId } }`
⚠️ orderId ≠ 链上成交，需轮询 `batch-query-market-orders` 确认状态。

#### 限价单下单
```
POST /bapi/defi/v1/public/wallet-direct/web-dex/agent/place-limit-order
```
| 参数 | 类型 | 必填 | 说明 |
|:--|:--|:--|:--|
| binanceChainId | string | 是 | 链 ID |
| fromToken | string | 是 | 源代币合约地址 |
| toToken | string | 是 | 目标代币合约地址（USDT/USDC/BNB） |
| amount | string | 是 | 输入数量 |
| triggerPrice | string | 是 | 触发价格（USD） |
| side | string | 是 | buy/sell |
| slippage | string | 否 | 滑点 |
| mev | boolean | 否 | MEV 保护 |
| gasLevel | string | 否 | Gas 等级 |

返回：`{ code, data: { strategyId, clientStrategyId } }`
限价单提交到链上，到价自动成交，不需要我们轮询！

#### 查询市价单
```
POST /bapi/defi/v1/public/wallet-direct/web-dex/agent/batch-query-market-orders
```
返回：`{ data: { total, rows: [{ orderId, fromTokenName, fromTokenQty, toTokenName, toTokenActualQty, status, orderTxId, bookTime }] } }`

#### 查询限价单
```
POST /bapi/defi/v1/public/wallet-direct/web-dex/agent/batch-query-limit-orders
```
返回：`{ data: { total, rows: [{ strategyId, fromTokenName, fromTokenQty, toTokenName, toTokenActualQty, price, side, status }] } }`

#### 取消限价单
```
POST /bapi/defi/v1/public/wallet-direct/web-dex/agent/cancel-limit-order
Body: { strategyId: number }
返回：{ data: { strategyId, status: "CANCELED" } }
```

### 11.2 钱包 API（需登录 session）

| 端点 | 方法 | 说明 |
|:--|:--|:--|
| /bapi/defi/v1/public/wallet-direct/agent-wallet/login | POST | 登录 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/login/confirm | POST | 登录确认 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/login/query | GET | 登录状态 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/login/logout | POST | 登出 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/mpc-wallet/list | POST | 钱包列表 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/mpc-wallet/token/list | POST | 代币余额 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/transfer | POST | 转账 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/settings/query | GET | 安全设置 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/trading-limit/query | GET | 每日额度 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/order/tx-lock-status | POST | 交易锁状态 |
| /bapi/defi/v1/public/wallet-direct/agent/tx-history-confirm | GET | 已确认交易 |
| /bapi/defi/v1/public/wallet-direct/agent/tx-history-pending | GET | 待确认交易 |
| /bapi/defi/v1/public/wallet-direct/agent/tx-status | GET | 交易状态 |
| /bapi/defi/v1/public/wallet-direct/mgmt/agent/networks/active | GET | 支持的链 |

### 11.3 数据 API（公开，无需登录）

#### 代币安全审计
```
POST /bapi/defi/v1/public/wallet-direct/security/token/audit
```
请求 Body（3 个必填参数）：
```json
{
  "binanceChainId": "56",       // 必填。56(BSC) / CT_501(Solana) / 8453(Base) / 1(ETH)
  "contractAddress": "0x...",   // 必填。代币合约地址
  "requestId": "550e8400-..."   // 必填。UUID v4 格式
}
```
返回（已验证）：
```json
{
  "code": "000000",
  "data": {
    "riskLevel": 0,              // 0=安全, 1=低风险, 2=中风险, 3=高风险
    "extraInfo": {
      "buyTax": "0.0",
      "sellTax": "0.0",
      "isVerified": true,
      "isFlaggedByVendor": false
    },
    "riskItems": [
      {
        "id": "CONTRACT_RISK",
        "name": "Contract Risk",
        "details": [
          { "title": "Blacklist Restrictions Not Found", "isHit": false, "riskType": "CAUTION" },
          { "title": "Trading Suspension Function Not Found", "isHit": false, "riskType": "CAUTION" }
        ]
      },
      { "id": "TRADING_RISK", "name": "Trading Risk", "details": [...] },
      { "id": "SCAM_RISK", "name": "Scam Detection", "details": [...] }
    ]
  }
}
```

#### 聪明钱信号
```
POST /bapi/defi/v1/public/wallet-direct/buw/wallet/web/signal/smart-money/ai
```
请求 Body：
```json
{
  "chainId": "56",              // 56(BSC) / CT_501(Solana)
  "page": 1,
  "pageSize": 50,               // 最大 100
  "smartSignalType": ""         // 可选，空=全部
}
```
返回（已验证）：
```json
{
  "code": "000000",
  "data": [
    {
      "signalId": 33863,
      "ticker": "代币名",
      "chainId": "56",
      "contractAddress": "0x...",
      "direction": "buy",        // buy/sell
      "smartMoneyCount": 14,      // 聪明钱地址数
      "alertPrice": "0.000154",   // 触发价格
      "currentPrice": "0.000076", // 当前价格
      "highestPrice": "0.000268", // 最高价
      "maxGain": "1.1566",        // 最大涨幅%
      "exitRate": 91,             // 退出率%
      "status": "valid",          // valid/timeout/completed
      "signalTriggerTime": 1780666115000,
      "tokenTag": {
        "Launch Platform": [{ "tagName": "Fourmeme" }],
        "Sensitive Events": [{ "tagName": "Smart Money Add Holdings" }]
      }
    }
  ]
}
```

#### 代币实时动态
```
GET /bapi/defi/v4/public/wallet-direct/buw/wallet/market/token/dynamic/info/ai
```
查询参数：`chainId=56&contractAddress=0x...`
返回（已验证，v4 版本）：
```json
{
  "code": "000000",
  "data": {
    "price": "0.9993",
    "volume24h": "412849323.02",
    "volume24hBuy": "208818590.39",
    "volume24hSell": "204030732.62",
    "count24h": "480131",
    "count24hBuy": "203899",
    "count24hSell": "276232",
    "volume1h": "36133983.27",
    "volume4h": "85061024.01",
    "volume5m": "3499128.99"
  }
}
```

#### 代币搜索
```
GET /bapi/defi/v5/public/wallet-direct/buw/wallet/market/token/search/ai
```
查询参数：`keyword=BNB&chainId=56`
返回（已验证）：
```json
{
  "code": "000000",
  "data": [
    {
      "chainId": "56",
      "contractAddress": "0x...",
      "name": "BNB Attestation",
      "symbol": "BAS",
      "price": "0.0292",
      "percentChange24h": "10.84",
      "volume24h": "6372310.75",
      "marketCap": "73169808.88",
      "liquidity": "2064642.25",
      "holders": "170209",
      "riskLevel": 1,
      "tagsInfo": { "Alpha": [...], "DEX Paid": [...] },
      "links": [{ "label": "website", "link": "https://..." }]
    }
  ]
}
```

#### 社交热度排行
```
GET /bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/social/hype/rank/leaderboard/ai
```
查询参数：`chainId=56&targetLanguage=en&timeRange=1`

#### 统一代币排行
```
POST /bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list/ai
```
请求 Body：`{ "rankType": 10, "chainId": "56", "period": 50, "sortBy": 70, "orderAsc": false, "page": 1, "size": 20 }`

#### 聪明钱净流入排行
```
POST /bapi/defi/v1/public/wallet-direct/tracker/wallet/token/inflow/rank/query/ai
```
请求 Body（必填参数）：
```json
{
  "chainId": "56",              // 必填。56(BSC) / CT_501(Solana) / 8453(Base)
  "tagType": 2,                 // 必填。默认 2
  "period": "24h"               // 必填。如 "24h" / "7d"
}
```

#### Meme 排行
```
GET /bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/exclusive/rank/list/ai
```
查询参数：`chainId=56`

#### 代币元数据
```
GET /bapi/defi/v1/public/wallet-direct/buw/wallet/dex/market/token/meta/info/ai
```
查询参数：`chainId=56&contractAddress=0x...`

#### 钱包持仓查询
```
GET /bapi/defi/v3/public/wallet-direct/buw/wallet/address/pnl/active-position-list/ai
```
查询参数：`address=0x...&chainId=56&offset=0`

#### 发射台（Pump.fun/Four.meme）
```
POST /bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/rank/list/ai
```
请求 Body：`{ "chainId": "CT_501", "rankType": 10, "limit": 20 }`

#### AI 热门话题
```
GET /bapi/defi/v2/public/wallet-direct/buw/wallet/market/token/social-rush/rank/list/ai
```
查询参数：`chainId=56&rankType=10&sort=10&asc=false`

#### 代币化美股
```
POST /bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai
```
请求 Body：`{ "chainId": "56" }`

### 11.4 预测市场 API（需登录）

| 端点 | 方法 | 说明 |
|:--|:--|:--|
| /bapi/defi/v1/public/wallet-direct/prediction/category/list | POST | 分类列表 |
| /bapi/defi/v1/public/wallet-direct/prediction/agent/market/list | POST | 市场列表 |
| /bapi/defi/v1/public/wallet-direct/prediction/agent/market/detail | POST | 市场详情 |
| /bapi/defi/v1/public/wallet-direct/prediction/agent/market/search | POST | 搜索市场 |
| /bapi/defi/v1/public/wallet-direct/prediction/agent/trade/get-quote | POST | 获取报价 |
| /bapi/defi/v1/public/wallet-direct/prediction/agent/trade/place-order-bundle | POST | 下注 |
| /bapi/defi/v1/public/wallet-direct/prediction/agent/trade/batch-cancel | POST | 取消订单 |
| /bapi/defi/v1/public/wallet-direct/prediction/agent/batch-redeem | POST | 兑换奖励 |
| /bapi/defi/v1/public/wallet-direct/prediction/agent/position/list | POST | 我的仓位 |
| /bapi/defi/v1/public/wallet-direct/prediction/agent/pnl/portfolio | POST | 投资组合 |

### 11.5 集成方案

| 我们项目的功能 | 对应 API | 优先级 |
|:--|:--|:--|
| 代币安全审计（交易前检查） | POST /security/token/audit | P0 |
| 聪明钱信号（AI 评分增强） | POST /signal/smart-money/ai | P0 |
| 代币实时价格 | GET /token/dynamic/info/ai | P0 |
| 代币搜索 | GET /token/search/ai | P1 |
| 社交热度排行 | GET /social/hype/rank/leaderboard/ai | P1 |
| 聪明钱流入排行 | POST /inflow/rank/query/ai | P1 |
| 发射台数据 | POST /pulse/rank/list/ai | P1 |
| 实盘 swap 交易 | POST /web-dex/agent/place-order | P2 |
| 实盘限价单（止盈止损） | POST /web-dex/agent/place-limit-order | P2 |
| 钱包余额查询 | POST /mpc-wallet/token/list | P2 |

---

## 十二、相关文档

- Binance Skills Hub：https://github.com/binance/binance-skills-hub
- Fork 到我们 GitHub：https://github.com/moying2026/binance-skills-hub
- Binance Agentic Wallet CLI：`~/.agents/skills/binance-agentic-wallet/SKILL.md`
- 限价单参考：`~/.agents/skills/binance-agentic-wallet/references/limit-order.md`
- 市价单参考：`~/.agents/skills/binance-agentic-wallet/references/market-order.md`
