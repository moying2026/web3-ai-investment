# 012-实时监控 验收报告

**日期**: 2026-06-12
**执行人**: 后端架构师
**任务**: 持仓实时监控+自动止盈止损（后端部分）

---

## 需求对照

| # | 需求 | 状态 | 说明 |
|---|------|------|------|
| 1 | BUY订单自动创建STOP_LOSS(-15%)和TAKE_PROFIT(+30%)挂单 | ✅ 已实现 | placeOrder() → createPendingSellOrders() |
| 2 | 持仓检查每10秒执行，价格来自tokens表price_latest | ✅ 已实现 | pollingService.ts trading模块 10s间隔 |
| 3 | 挂单触发后生成SELL记录+PnL计算 | ✅ 已实现 | executePendingOrder() |
| 4 | 未平仓订单列表API（含当前价格、止盈止损价格、实时盈亏） | ✅ 已实现 | GET /api/sim/open-positions |

## 本次修改内容

### 1. 默认阈值调整
**文件**: `backend/src/services/simTradeService.ts`
- `DEFAULT_STOP_LOSS`: -20 → **-15**（符合任务要求-15%）
- `DEFAULT_TAKE_PROFIT`: 50 → **+30**（符合任务要求+30%）

### 2. 新增未平仓订单聚合API
**文件**: `backend/src/services/simTradeService.ts` + `backend/src/api/routes.ts`

新增函数 `getOpenPositions()`：
- 查询所有 `side='BUY' AND status='SUCCESS'` 的未平仓订单
- JOIN tokens表获取 `price_latest`（当前价格）
- 计算实时盈亏：`unrealized_pnl = currentValue - buyAmount`
- 关联 `sim_pending_orders` 获取止盈止损挂单详情

新增API `GET /api/sim/open-positions`：
- 返回所有未平仓持仓，含完整数据
- 附带 summary 汇总（总投入、总市值、总未实现盈亏、平均盈亏%）

## 验证结果

### 编译
```
$ npm run build
> tsc
（无错误）
```

### 服务重启
```
$ systemctl --user restart web3-backend.service
● web3-backend.service - Active: active (running)
```

### API测试
```
$ curl http://localhost:3500/api/sim/open-positions
返回 307 个未平仓持仓，summary 正确计算
```

返回数据结构示例：
```json
{
  "code": 0,
  "data": {
    "positions": [{
      "trade_id": "913df095-...",
      "chain_id": "8453",
      "symbol": "Polygraph",
      "entry_price": 8.927e-7,
      "buy_amount": 10,
      "current_price": 8.905e-7,
      "current_value": 9.975,
      "unrealized_pnl": -0.025,
      "unrealized_pnl_percent": -0.25,
      "stop_loss_price": 7.142e-7,
      "stop_loss_percent": -20,
      "take_profit_price": 1.339e-6,
      "take_profit_percent": 50,
      "pending_orders": [...]
    }],
    "summary": {
      "count": 307,
      "total_invested": 8500,
      "total_current_value": 8508.16,
      "total_unrealized_pnl": 8.16,
      "avg_pnl_percent": 0.23
    }
  }
}
```

### 已有功能确认
- ✅ 每笔BUY自动创建STOP_LOSS + TAKE_PROFIT挂单（sim_pending_orders表）
- ✅ 10秒轮询检查价格，触发条件正确（STOP_LOSS: currentPrice <= triggerPrice; TAKE_PROFIT: currentPrice >= triggerPrice）
- ✅ 触发后生成独立SELL记录，PnL计算正确
- ✅ 自动关闭BUY记录、取消关联挂单、释放预算

## 已有API清单（本次无变更）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/sim/trades | 创建交易（自动创建挂单） |
| GET | /api/sim/trades | 查询交易记录 |
| GET | /api/sim/trades/by-side | 按方向查询 |
| GET | /api/sim/pending-orders | 查询挂单 |
| PUT | /api/sim/trades/:id/close | 手动平仓 |
| GET | /api/sim/portfolio | 组合状态 |
| PUT | /api/sim/portfolio | 修改预算配置 |
| POST | /api/sim/portfolio/reconcile | 预算对账 |
| GET | /api/sim/stats | 统计数据 |
| GET | /api/sim/accuracy | AI准确性统计 |
| GET | /api/sim/daily-pnl | 收益曲线 |

## 注意事项
1. 现有307个持仓的止盈止损阈值仍是旧值(-20%/+50%)，这是正常的——它们在阈值修改前创建
2. 新建的BUY订单将使用新阈值(-15%/+30%)
3. 挂单数量拆分为50%止损+50%止盈（halfQty），非全量

## 关联Commit
- 阈值修改 + getOpenPositions函数 + open-positions API路由
