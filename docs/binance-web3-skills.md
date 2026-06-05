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

## 十、相关文档

- Binance Skills Hub：https://github.com/binance/binance-skills-hub
- Fork 到我们 GitHub：https://github.com/moying2026/binance-skills-hub
- Binance Agentic Wallet CLI：`~/.agents/skills/binance-agentic-wallet/SKILL.md`
- 限价单参考：`~/.agents/skills/binance-agentic-wallet/references/limit-order.md`
- 市价单参考：`~/.agents/skills/binance-agentic-wallet/references/market-order.md`
