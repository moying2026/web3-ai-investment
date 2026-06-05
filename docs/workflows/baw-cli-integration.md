# baw CLI 实盘对接方案

> 版本：v1.0
> 日期：2026-06-06
> baw CLI 版本：1.1.1
> 安装路径：npm global (`~/.npm-global/lib/node_modules/@binance/agentic-wallet`)

---

## 一、认证流程

### 1.1 登录流程（auth signin → auth verify）

```
1. 调用 baw auth signin --json
2. 返回 { urlForWeb, qrCodeId, pairingCode }
3. 用户在 Binance App 中扫码确认
4. 调用 baw auth verify --qrCodeId <id> --json 等待确认
5. 验证成功后获得 agentSessionId cookie
```

### 1.2 认证状态检查

```bash
baw wallet status --json
# 返回 { connectionStatus, walletCreateStatus }
```

### 1.3 认证 API 端点（直接调用，不经过 CLI）

| 端点 | 方法 | 说明 |
|:--|:--|:--|
| /bapi/defi/v1/public/wallet-direct/agent-wallet/login | POST | 发起登录 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/login/confirm | POST | 确认登录 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/login/query | GET | 查询登录状态 |
| /bapi/defi/v1/public/wallet-direct/agent-wallet/login/logout | POST | 登出 |

认证后所有请求需要带 `Cookie: agentSessionId=<sessionId>`。

---

## 二、模拟盘下单流程

模拟盘不调用 baw CLI / 链上 API，直接在本地生成交易记录。

### 2.1 流程

```
1. AI 分析 → 评分 → 决策买入
2. 调用 token/audit API 安全检查
3. 调用 placeOrder({ is_simulated: 1 })
4. 本地生成 PENDING 记录 → 立即标记 SUCCESS
5. 创建止损止盈挂单（sim_pending_orders）
6. 每次价格更新时检查挂单是否触发
```

### 2.2 关键代码

```typescript
// simTradeService.ts
const result = placeOrder({
  chain_id: '56',
  contract_address: '0x...',
  symbol: 'TOKEN',
  side: 'BUY',
  from_token: 'USDT',
  from_amount: 100,
  to_token: 'TOKEN',
  to_amount: 1000,
  price: 0.1,
  is_simulated: 1,  // 模拟盘
  strategy: 'ai_buy',
  stop_loss_percent: -20,
  take_profit_percent: 50,
});
// 本地直接标记 SUCCESS，不调用任何链上 API
```

---

## 三、实盘下单流程

### 3.1 市价 Swap（market-order）

```
1. AI 分析 → 评分 → 决策买入
2. 调用 token/audit API 安全检查
3. 调用 market-order quote 获取报价
4. 用户确认（或自动确认）
5. 调用 market-order swap 执行交易
6. 返回 orderId（≠ 链上成交）
7. 轮询 market-order list 确认状态
8. 确认成交后更新 sim_trades 状态为 SUCCESS
```

### 3.2 市价 Swap API

```bash
# 报价
baw market-order quote \
  --fromTokenQty 100 \
  --fromToken 0x55d398326f99059fF775485246999027B3197955 \
  --toToken 0x... \
  --binanceChainId 56 \
  --json

# 执行
baw market-order swap \
  --fromTokenQty 100 \
  --fromToken 0x55d398326f99059fF775485246999027B3197955 \
  --toToken 0x... \
  --binanceChainId 56 \
  --slippage auto \
  --mev true \
  --gasLevel HIGH \
  --json
# 返回: { "data": { "orderId": "xxx" } }

# 查询状态
baw market-order list --orderId xxx --json
```

### 3.3 实盘下单代码

```typescript
// simTradeService.ts
const result = placeOrder({
  chain_id: '56',
  contract_address: '0x...',
  symbol: 'TOKEN',
  side: 'BUY',
  from_token: 'USDT',
  from_amount: 100,
  to_token: 'TOKEN',
  to_amount: 1000,
  price: 0.1,
  is_simulated: 0,  // 实盘
  strategy: 'ai_buy',
});
// 返回: { success: true, trade_id: 'uuid', status: 'PENDING', is_simulated: 0 }
// 需要后续轮询确认链上成交
```

---

## 四、止盈止损实现

### 4.1 实盘：limit-order sell（链上限价单）

实盘止盈止损使用 baw 的 limit-order sell，提交到链上，到价自动成交，不需要我们轮询。

```bash
# 止损：价格跌到 $80 时卖出
baw limit-order sell \
  --triggerPrice 80 \
  --fromTokenQty 1000 \
  --fromToken 0x... \
  --toToken 0x55d398326f99059fF775485246999027B3197955 \
  --binanceChainId 56 \
  --json
# 返回: { "data": { "strategyId": "xxx" } }

# 止盈：价格涨到 $150 时卖出
baw limit-order sell \
  --triggerPrice 150 \
  --fromTokenQty 500 \
  --fromToken 0x... \
  --toToken 0x55d398326f99059fF775485246999027B3197955 \
  --binanceChainId 56 \
  --json
```

### 4.2 模拟盘：本地价格检查

模拟盘止盈止损使用本地价格检查，在每次价格更新时触发。

```
1. 买入成功后创建 sim_pending_orders（止损 + 止盈）
2. 每次 fetchPriceInfo 更新价格后调用 checkAndTriggerPendingOrders()
3. 价格触发 → 创建独立 SELL 记录 → 释放预算
```

### 4.3 止盈止损 API

```bash
# 查询限价单状态
baw limit-order list --json

# 取消限价单
baw limit-order cancel --strategyId xxx --json
```

---

## 五、错误处理和重试机制

### 5.1 baw CLI 错误码

| 错误 | 说明 | 处理 |
|:--|:--|:--|
| HTTP 401 | 未登录 | 重新执行 auth signin |
| HTTP 403 | 无权限 | 检查钱包连接状态 |
| HTTP 408 | 请求超时 | 重试（指数退避） |
| HTTP 429 | 限流 | 等待 Retry-After 后重试 |
| ORDER_API_ERROR | 下单失败 | 检查余额/滑点/流动性 |
| LIMIT_ORDER_API_ERROR | 限价单失败 | 检查参数/余额 |

### 5.2 重试策略

```typescript
async function retryBawCommand(command: string, maxRetries = 3): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await execBaw(command);
      return result;
    } catch (err) {
      if (err.code === 401) {
        // 重新认证
        await reauth();
        continue;
      }
      if (err.code === 429) {
        // 限流，等待后重试
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      if (i === maxRetries - 1) throw err;
    }
  }
}
```

### 5.3 链上成交确认

市价单提交后需要轮询确认：

```typescript
async function confirmSwap(orderId: string, maxWaitMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await bawMarketOrderList(orderId);
    if (status === 'SUCCESS') return true;
    if (status === 'FAILED') return false;
    await sleep(3000); // 3 秒轮询
  }
  return false; // 超时
}
```

---

## 六、模拟盘→实盘切换逻辑

### 6.1 核心原则

**同一套代码，只改 is_simulated 字段。**

```typescript
// 下单
const result = placeOrder({
  ...params,
  is_simulated: config.isLive ? 0 : 1,
});

// 止盈止损
if (config.isLive) {
  // 实盘：调 baw limit-order sell
  await bawLimitOrderSell(triggerPrice, quantity, tokenAddress);
} else {
  // 模拟盘：创建本地挂单
  createPendingSellOrders(tradeId, chainId, contractAddress, symbol, quantity, price);
}
```

### 6.2 配置项

```typescript
// config.ts
export const TRADING_CONFIG = {
  isLive: false,           // true=实盘, false=模拟盘
  defaultSlippage: 'auto', // 滑点
  mevProtection: true,     // MEV 保护
  gasLevel: 'HIGH',        // Gas 等级
  maxRetries: 3,           // 重试次数
  confirmTimeoutMs: 60000, // 链上确认超时
};
```

### 6.3 切换流程

```
模拟盘 → 实盘：
1. 确保 baw CLI 已安装且已登录
2. 确保钱包有足够余额
3. 修改 config.isLive = true
4. 重启服务

实盘 → 模拟盘：
1. 修改 config.isLive = false
2. 重启服务
3. 实盘未成交的限价单需要手动取消
```

---

## 七、集成架构图

```
┌─────────────────────────────────────────────────┐
│                  AI 分析管线                      │
│  (audit + smart-money + token-info + ranking)    │
└──────────────────────┬──────────────────────────┘
                       │ 买入决策
                       ▼
┌─────────────────────────────────────────────────┐
│              placeOrder() 统一下单                │
│  is_simulated=1 → 本地 SUCCESS                   │
│  is_simulated=0 → 调用链上 API                   │
└──────────────────────┬──────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
    ┌─────────────┐    ┌──────────────┐
    │  模拟盘      │    │   实盘        │
    │  本地记录    │    │  baw swap    │
    │  本地挂单    │    │  baw limit   │
    └─────────────┘    └──────────────┘
              │                 │
              ▼                 ▼
    ┌─────────────────────────────────┐
    │  sim_trades 表（统一存储）        │
    │  sim_pending_orders（挂单）       │
    │  portfolio_state（预算/统计）     │
    └─────────────────────────────────┘
```

---

## 八、相关文档

- baw CLI SKILL.md：`~/.agents/skills/binance-agentic-wallet/SKILL.md`
- 认证参考：`~/.agents/skills/binance-agentic-wallet/references/authentication.md`
- 市价单参考：`~/.agents/skills/binance-agentic-wallet/references/market-order.md`
- 限价单参考：`~/.agents/skills/binance-agentic-wallet/references/limit-order.md`
- Skills API 端点明细：`docs/binance-web3-skills.md` 第十一章
