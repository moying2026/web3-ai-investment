// 模拟交易服务 — BUY/SELL 独立记录 + 挂单→成交两层结构

import { db } from '../db/database';
import { AnalysisResult } from './aiAnalysisService';
import { v4 as uuidv4 } from 'uuid';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

const DEFAULT_BUY_AMOUNT = 100;  // 默认买入金额 $100（BUY 推荐）
const BUY_AMOUNT_MAP: Record<string, number> = {
  'BUY': 100,   // AI推荐买入：$100
  'HOLD': 50,   // AI建议持有：$50
  'AVOID': 10,  // AI建议回避：$10（小额对比验证）
};
const DEFAULT_STOP_LOSS = -20;   // 止损 -20%
const DEFAULT_TAKE_PROFIT = 50;  // 止盈 +50%

// 链 → 支付代币映射（贴近实盘）
const CHAIN_PAYMENT_TOKEN: Record<string, string> = {
  'bsc': 'BNB',
  '56': 'BNB',
  'solana': 'SOL',
  'CT_501': 'SOL',
  'base': 'ETH',
  '8453': 'ETH',
  'eth': 'ETH',
  '1': 'ETH',
};

function getPaymentToken(chainId: string): string {
  return CHAIN_PAYMENT_TOKEN[chainId] || 'USDT';
}

// ==================== 初始化表 ====================

export function ensureSimTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sim_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL UNIQUE,
      parent_trade_id TEXT,                -- SELL 关联的 BUY trade_id
      trade_type TEXT DEFAULT 'manual',
      strategy TEXT,
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      symbol TEXT,
      side TEXT NOT NULL,                  -- 'BUY' 或 'SELL'，独立记录
      order_type TEXT DEFAULT 'MARKET',
      payment_token TEXT DEFAULT 'USDT',   -- 支付代币（BNB/SOL/ETH/USDT）
      payment_amount TEXT,                 -- 支付金额（以 payment_token 计价）
      entry_price TEXT NOT NULL,
      entry_amount TEXT,
      entry_quantity TEXT,
      exit_price TEXT,                     -- SELL 记录的成交价
      exit_amount TEXT,
      stop_loss_price TEXT,
      stop_loss_percent REAL,
      take_profit_price TEXT,
      take_profit_percent REAL,
      trigger_reason TEXT,
      trigger_scores TEXT,
      status TEXT DEFAULT 'OPEN',          -- BUY: OPEN/CLOSED; SELL 记录始终 CLOSED
      pnl TEXT,
      pnl_percent REAL,
      holding_duration_minutes INTEGER,
      entry_time TEXT NOT NULL,
      exit_time TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sim_pending_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL UNIQUE,
      parent_trade_id TEXT NOT NULL,       -- 关联的 BUY trade_id
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      symbol TEXT,
      side TEXT NOT NULL DEFAULT 'SELL',
      order_type TEXT NOT NULL,            -- 'STOP_LOSS' 或 'TAKE_PROFIT'
      quantity TEXT NOT NULL,
      trigger_price TEXT NOT NULL,         -- 触发价格
      trigger_percent REAL,                -- 触发百分比
      status TEXT DEFAULT 'PENDING',       -- PENDING / TRIGGERED / CANCELED
      triggered_at TEXT,
      filled_price TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id TEXT NOT NULL UNIQUE DEFAULT 'main',
      total_budget REAL DEFAULT 10000,     -- 总预算
      used_budget REAL DEFAULT 0,           -- 已用预算
      available_budget REAL DEFAULT 10000,  -- 可用预算
      max_per_trade_amount REAL DEFAULT 100, -- 单笔最大投入金额
      max_positions INTEGER DEFAULT 1000,   -- 持币种类上限
      max_chain_pct REAL DEFAULT 40,        -- 单链最大投入占比(%)
      total_trades INTEGER DEFAULT 0,
      winning_trades INTEGER DEFAULT 0,
      losing_trades INTEGER DEFAULT 0,
      total_pnl REAL DEFAULT 0,
      position_count INTEGER DEFAULT 0,
      last_trade_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 确保 portfolio_state 有 main 记录
  const main = (db.prepare("SELECT portfolio_id FROM portfolio_state WHERE portfolio_id = 'main'") as SqliteStatement).get();
  if (!main) {
    db.prepare("INSERT INTO portfolio_state (portfolio_id) VALUES ('main')").run();
  }
}

// ==================== 预算控制 ====================

function getPortfolio(): any {
  return (db.prepare("SELECT * FROM portfolio_state WHERE portfolio_id = 'main'") as SqliteStatement).get();
}

function checkBudget(amount: number, chainId: string): { ok: boolean; reason?: string } {
  const p = getPortfolio();
  if (!p) return { ok: false, reason: 'portfolio_not_found' };

  // 检查可用预算
  if (amount > p.available_budget) {
    return { ok: false, reason: `insufficient_budget: need $${amount}, available $${p.available_budget}` };
  }

  // 检查单笔最大投入
  if (amount > p.max_per_trade_amount) {
    return { ok: false, reason: `exceeds_max_per_trade: $${amount} > $${p.max_per_trade_amount}` };
  }

  // 检查持仓数量上限
  const openCount = (db.prepare("SELECT COUNT(*) as c FROM sim_trades WHERE side = 'BUY' AND status = 'OPEN'") as SqliteStatement).get() as any;
  if (openCount && openCount.c >= p.max_positions) {
    return { ok: false, reason: `max_positions_reached: ${openCount.c}/${p.max_positions}` };
  }

  // 检查单链投入比例
  const chainInvested = (db.prepare(
    "SELECT COALESCE(SUM(CAST(entry_amount AS REAL)), 0) as s FROM sim_trades WHERE side = 'BUY' AND status = 'OPEN' AND chain_id = ?"
  ) as SqliteStatement).get(chainId) as any;
  const chainMax = p.total_budget * (p.max_chain_pct / 100);
  if (chainInvested && (chainInvested.s + amount) > chainMax) {
    return { ok: false, reason: `chain_limit_exceeded: ${chainId} invested $${chainInvested.s}, limit $${chainMax} (${p.max_chain_pct}%)` };
  }

  return { ok: true };
}

function deductBudget(amount: number): void {
  db.prepare("UPDATE portfolio_state SET used_budget = used_budget + ?, available_budget = available_budget - ?, updated_at = datetime('now') WHERE portfolio_id = 'main'").run(amount, amount);
}

function releaseBudget(amount: number): void {
  db.prepare("UPDATE portfolio_state SET used_budget = MAX(0, used_budget - ?), available_budget = available_budget + ?, updated_at = datetime('now') WHERE portfolio_id = 'main'").run(amount, amount);
}

export function getPortfolioInfo(): any {
  ensureSimTables();
  const p = getPortfolio();
  if (!p) return null;

  const openTrades = (db.prepare(
    "SELECT COUNT(*) as c FROM sim_trades WHERE side = 'BUY' AND status = 'OPEN'"
  ) as SqliteStatement).get() as any;

  // 计算持仓市值
  const openPositions = (db.prepare(`
    SELECT st.chain_id, st.contract_address, st.entry_amount, t.price_latest
    FROM sim_trades st
    LEFT JOIN tokens t ON st.chain_id = t.chain_id AND st.contract_address = t.contract_address
    WHERE st.side = 'BUY' AND st.status = 'OPEN'
  `) as SqliteStatement).all() as any[];

  let totalMarketValue = 0;
  for (const pos of openPositions) {
    const entryAmt = parseFloat(pos.entry_amount || '0');
    const latestPrice = parseFloat(pos.price_latest || '0');
    // 简单估算：如果有最新价，用最新价；否则用买入价
    totalMarketValue += entryAmt; // 保守估算
  }

  return {
    portfolio_id: p.portfolio_id,
    total_budget: p.total_budget,
    used_budget: p.used_budget,
    available_budget: p.available_budget,
    max_per_trade_amount: p.max_per_trade_amount,
    max_positions: p.max_positions,
    max_chain_pct: p.max_chain_pct,
    open_positions: openTrades?.c || 0,
    total_market_value: totalMarketValue,
    total_trades: p.total_trades,
    winning_trades: p.winning_trades,
    losing_trades: p.losing_trades,
    total_pnl: p.total_pnl,
    last_trade_at: p.last_trade_at,
  };
}

export function updateBudget(config: { total_budget?: number; max_per_trade_amount?: number; max_positions?: number; max_chain_pct?: number }): any {
  ensureSimTables();
  const p = getPortfolio();
  if (!p) return null;

  const updates: string[] = [];
  const params: any[] = [];

  if (config.total_budget !== undefined) {
    const diff = config.total_budget - p.total_budget;
    updates.push('total_budget = ?');
    params.push(config.total_budget);
    updates.push('available_budget = available_budget + ?');
    params.push(diff);
  }
  if (config.max_per_trade_amount !== undefined) {
    updates.push('max_per_trade_amount = ?');
    params.push(config.max_per_trade_amount);
  }
  if (config.max_positions !== undefined) {
    updates.push('max_positions = ?');
    params.push(config.max_positions);
  }
  if (config.max_chain_pct !== undefined) {
    updates.push('max_chain_pct = ?');
    params.push(config.max_chain_pct);
  }

  if (updates.length === 0) return getPortfolioInfo();

  updates.push("updated_at = datetime('now')");
  params.push('main');
  db.prepare(`UPDATE portfolio_state SET ${updates.join(', ')} WHERE portfolio_id = ?`).run(...params);

  console.log(`[Sim] 预算更新:`, config);
  return getPortfolioInfo();
}

// ==================== BUY：独立买入记录 ====================

export function executeAutoBuy(analysisResults: AnalysisResult[]): number {
  ensureSimTables();
  let buyCount = 0;

  for (const result of analysisResults) {
    // 检查是否已有同一代币的 OPEN BUY 记录
    const existing = (db.prepare(`
      SELECT id FROM sim_trades
      WHERE chain_id = ? AND contract_address = ? AND side = 'BUY' AND status = 'OPEN'
    `) as SqliteStatement).get(result.chainId, result.contractAddress) as any;
    if (existing) continue;

    // 获取当前价格
    const token = (db.prepare('SELECT price_latest FROM tokens WHERE chain_id = ? AND contract_address = ?') as SqliteStatement)
      .get(result.chainId, result.contractAddress) as any;
    if (!token || !token.price_latest) continue;

    const entryPrice = parseFloat(token.price_latest);
    if (entryPrice <= 0) continue;

    const buyAmount = BUY_AMOUNT_MAP[result.recommendation] || 10;
    const paymentToken = getPaymentToken(result.chainId);

    // 预算检查
    const budgetCheck = checkBudget(buyAmount, result.chainId);
    if (!budgetCheck.ok) {
      console.log(`[Sim] SKIP ${result.symbol}: ${budgetCheck.reason}`);
      continue;
    }

    const tradeType = 'ai_auto';
    const strategy = `ai_${result.recommendation.toLowerCase()}`;
    const triggerReason = `AI评分${result.score}分(${result.recommendation}): ${result.reasons.slice(0, 3).join('; ')}`;

    const tradeId = uuidv4();
    const entryQuantity = (buyAmount / entryPrice).toString();
    const stopLossPrice = (entryPrice * (1 + DEFAULT_STOP_LOSS / 100)).toString();
    const takeProfitPrice = (entryPrice * (1 + DEFAULT_TAKE_PROFIT / 100)).toString();
    const now = new Date().toISOString();

    // 插入 BUY 记录
    (db.prepare(`INSERT INTO sim_trades (
      trade_id, trade_type, strategy, chain_id, contract_address, symbol,
      side, order_type, payment_token, payment_amount, entry_price, entry_amount, entry_quantity,
      stop_loss_price, stop_loss_percent, take_profit_price, take_profit_percent,
      trigger_reason, trigger_scores, status, entry_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MARKET', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`)).run(
      tradeId, tradeType, strategy, result.chainId, result.contractAddress, result.symbol,
      'BUY', paymentToken, buyAmount.toString(), entryPrice.toString(), buyAmount.toString(), entryQuantity,
      stopLossPrice, DEFAULT_STOP_LOSS, takeProfitPrice, DEFAULT_TAKE_PROFIT,
      triggerReason, JSON.stringify(result.dimensionScores), now
    );

    // 创建独立的挂单（止损 + 止盈）
    createPendingSellOrders(tradeId, result.chainId, result.contractAddress, result.symbol, entryQuantity, entryPrice);

    // 扣减预算
    deductBudget(buyAmount);

    // 更新组合统计
    (db.prepare(`UPDATE portfolio_state SET total_trades = total_trades + 1, position_count = position_count + 1, last_trade_at = datetime('now') WHERE portfolio_id = 'main'`)).run();

    buyCount++;
    console.log(`[Sim] BUY: ${result.symbol} @ $${entryPrice.toFixed(8)} | ${buyAmount} ${paymentToken} | AI: ${result.score}分(${result.recommendation})`);
  }

  return buyCount;
}

// ==================== 挂单创建 ====================

function createPendingSellOrders(
  buyTradeId: string, chainId: string, contractAddress: string,
  symbol: string | null, quantity: string | null, entryPrice: number
): void {
  if (!quantity) return;
  const qty = parseFloat(quantity);
  const halfQty = (qty / 2).toString();

  const stopLossPrice = entryPrice * (1 + DEFAULT_STOP_LOSS / 100);
  const takeProfitPrice = entryPrice * (1 + DEFAULT_TAKE_PROFIT / 100);

  // 止损挂单
  const slOrderId = uuidv4();
  (db.prepare(`INSERT INTO sim_pending_orders (
    order_id, parent_trade_id, chain_id, contract_address, symbol,
    side, order_type, quantity, trigger_price, trigger_percent, status
  ) VALUES (?, ?, ?, ?, ?, 'SELL', 'STOP_LOSS', ?, ?, ?, 'PENDING')`)).run(
    slOrderId, buyTradeId, chainId, contractAddress, symbol,
    halfQty, stopLossPrice.toString(), DEFAULT_STOP_LOSS
  );

  // 止盈挂单
  const tpOrderId = uuidv4();
  (db.prepare(`INSERT INTO sim_pending_orders (
    order_id, parent_trade_id, chain_id, contract_address, symbol,
    side, order_type, quantity, trigger_price, trigger_percent, status
  ) VALUES (?, ?, ?, ?, ?, 'SELL', 'TAKE_PROFIT', ?, ?, ?, 'PENDING')`)).run(
    tpOrderId, buyTradeId, chainId, contractAddress, symbol,
    halfQty, takeProfitPrice.toString(), DEFAULT_TAKE_PROFIT
  );

  console.log(`[Sim] 挂单: SL@${stopLossPrice.toFixed(8)} TP@${takeProfitPrice.toFixed(8)} for ${symbol}`);
}

// ==================== 挂单触发检查 ====================

export function checkAndTriggerPendingOrders(): number {
  ensureSimTables();
  let triggerCount = 0;

  const pendingOrders = (db.prepare(`
    SELECT po.*, t.price_latest
    FROM sim_pending_orders po
    JOIN tokens t ON po.chain_id = t.chain_id AND po.contract_address = t.contract_address
    WHERE po.status = 'PENDING'
  `) as SqliteStatement).all() as any[];

  for (const order of pendingOrders) {
    const currentPrice = parseFloat(order.price_latest);
    if (!currentPrice || currentPrice <= 0) continue;

    const triggerPrice = parseFloat(order.trigger_price);
    let shouldTrigger = false;

    if (order.order_type === 'STOP_LOSS' && currentPrice <= triggerPrice) {
      shouldTrigger = true;
    } else if (order.order_type === 'TAKE_PROFIT' && currentPrice >= triggerPrice) {
      shouldTrigger = true;
    }

    if (shouldTrigger) {
      executePendingOrder(order, currentPrice);
      triggerCount++;
    }
  }

  return triggerCount;
}

function executePendingOrder(order: any, currentPrice: number): void {
  const now = new Date().toISOString();
  const buyTrade = (db.prepare('SELECT * FROM sim_trades WHERE trade_id = ?') as SqliteStatement)
    .get(order.parent_trade_id) as any;

  // 更新挂单状态
  (db.prepare(`UPDATE sim_pending_orders SET
    status = 'TRIGGERED', triggered_at = ?, filled_price = ?
    WHERE order_id = ?`)).run(now, currentPrice.toString(), order.order_id);

  // 取消同组另一个挂单（止损/止盈互斥，触发一个取消另一个）
  (db.prepare(`UPDATE sim_pending_orders SET status = 'CANCELED'
    WHERE parent_trade_id = ? AND order_id != ? AND status = 'PENDING'`)).run(
    order.parent_trade_id, order.order_id
  );

  // 创建独立 SELL 记录
  const sellTradeId = uuidv4();
  const entryPrice = buyTrade ? parseFloat(buyTrade.entry_price) : 0;
  const sellQuantity = parseFloat(order.quantity);
  const sellAmount = sellQuantity * currentPrice;
  const pnl = entryPrice > 0 ? (currentPrice - entryPrice) * sellQuantity : 0;
  const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
  const holdingMinutes = buyTrade ? Math.floor((Date.now() - new Date(buyTrade.entry_time).getTime()) / 60000) : 0;

  (db.prepare(`INSERT INTO sim_trades (
    trade_id, parent_trade_id, trade_type, strategy, chain_id, contract_address, symbol,
    side, order_type, entry_price, entry_amount, entry_quantity,
    exit_price, exit_amount, status, pnl, pnl_percent,
    holding_duration_minutes, entry_time, exit_time
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SELL', 'MARKET', ?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?, ?, ?)`)).run(
    sellTradeId, order.parent_trade_id, buyTrade?.trade_type || 'triggered', buyTrade?.strategy || null,
    order.chain_id, order.contract_address, order.symbol,
    entryPrice.toString(), order.quantity, order.quantity,
    currentPrice.toString(), sellAmount.toString(),
    pnl.toFixed(6), pnlPercent, holdingMinutes, now, now
  );

  // 关闭原始 BUY 记录
  if (buyTrade) {
    (db.prepare(`UPDATE sim_trades SET
      status = 'CLOSED', exit_price = ?, exit_amount = ?, exit_reason = ?,
      exit_time = ?, pnl = ?, pnl_percent = ?, holding_duration_minutes = ?,
      updated_at = datetime('now')
      WHERE trade_id = ?`)).run(
      currentPrice.toString(), sellAmount.toString(), order.order_type,
      now, pnl.toFixed(6), pnlPercent, holdingMinutes, order.parent_trade_id
    );

    // 释放预算
    const entryAmount = parseFloat(buyTrade.entry_amount || '0');
    if (entryAmount > 0) releaseBudget(entryAmount);
  }

  // 更新组合统计
  const isWin = pnl > 0;
  (db.prepare(`UPDATE portfolio_state SET
    winning_trades = winning_trades + ?, losing_trades = losing_trades + ?,
    total_pnl = CAST(total_pnl AS REAL) + ?,
    position_count = (SELECT COUNT(*) FROM sim_trades WHERE side = 'BUY' AND status = 'OPEN'),
    updated_at = datetime('now') WHERE portfolio_id = 'main'`)).run(isWin ? 1 : 0, isWin ? 0 : 1, pnl);

  console.log(`[Sim] SELL ${order.order_type}: ${order.symbol} @ $${currentPrice.toFixed(8)} | 盈亏: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
}

// ==================== 手动平仓（创建独立 SELL 记录） ====================

export function closePosition(trade: any, exitPrice: number, exitReason: string): void {
  ensureSimTables();
  const entryPrice = parseFloat(trade.entry_price);
  const pnl = (exitPrice - entryPrice) / entryPrice * parseFloat(trade.entry_amount || '100');
  const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  const holdingMinutes = Math.floor((Date.now() - new Date(trade.entry_time).getTime()) / 60000);
  const exitAmount = trade.entry_quantity ? (parseFloat(trade.entry_quantity) * exitPrice).toString() : null;
  const now = new Date().toISOString();

  // 创建独立 SELL 记录
  const sellTradeId = uuidv4();
  (db.prepare(`INSERT INTO sim_trades (
    trade_id, parent_trade_id, trade_type, strategy, chain_id, contract_address, symbol,
    side, order_type, entry_price, entry_amount, entry_quantity,
    exit_price, exit_amount, exit_reason, status, pnl, pnl_percent,
    holding_duration_minutes, entry_time, exit_time
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SELL', 'MARKET', ?, ?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?, ?, ?)`)).run(
    sellTradeId, trade.trade_id, trade.trade_type, trade.strategy,
    trade.chain_id, trade.contract_address, trade.symbol,
    entryPrice.toString(), trade.entry_amount, trade.entry_quantity,
    exitPrice.toString(), exitAmount, exitReason,
    pnl.toFixed(6), pnlPercent, holdingMinutes, now, now
  );

  // 关闭原始 BUY 记录
  (db.prepare(`UPDATE sim_trades SET
    status = 'CLOSED', exit_price = ?, exit_amount = ?, exit_reason = ?,
    exit_time = ?, pnl = ?, pnl_percent = ?, holding_duration_minutes = ?, updated_at = datetime('now')
    WHERE trade_id = ?`)).run(
    exitPrice.toString(), exitAmount, exitReason, now,
    pnl.toFixed(6), pnlPercent, holdingMinutes, trade.trade_id
  );

  // 取消关联挂单
  (db.prepare(`UPDATE sim_pending_orders SET status = 'CANCELED'
    WHERE parent_trade_id = ? AND status = 'PENDING'`)).run(trade.trade_id);

  // 释放预算
  const entryAmount = parseFloat(trade.entry_amount || '0');
  if (entryAmount > 0) releaseBudget(entryAmount);

  // 更新组合统计
  const isWin = pnl > 0;
  (db.prepare(`UPDATE portfolio_state SET
    winning_trades = winning_trades + ?, losing_trades = losing_trades + ?,
    total_pnl = CAST(total_pnl AS REAL) + ?,
    position_count = (SELECT COUNT(*) FROM sim_trades WHERE side = 'BUY' AND status = 'OPEN'),
    updated_at = datetime('now') WHERE portfolio_id = 'main'`)).run(isWin ? 1 : 0, isWin ? 0 : 1, pnl);

  console.log(`[Sim] SELL(manual): ${trade.symbol} @ $${exitPrice.toFixed(8)} | 原因: ${exitReason} | 盈亏: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
}

// ==================== 兼容旧接口 ====================

// 检查持仓，自动止盈止损（现在调用挂单触发检查）
export function checkAndClosePositions(): number {
  return checkAndTriggerPendingOrders();
}

// ==================== 查询接口 ====================

// 获取所有挂单
export function getPendingOrders(status: string = 'PENDING'): any[] {
  ensureSimTables();
  return (db.prepare(
    'SELECT * FROM sim_pending_orders WHERE status = ? ORDER BY created_at DESC'
  ) as SqliteStatement).all(status);
}

// 按方向查询交易记录
export function getTradesBySide(side: 'BUY' | 'SELL', limit: number = 50): any[] {
  ensureSimTables();
  return (db.prepare(
    'SELECT * FROM sim_trades WHERE side = ? ORDER BY entry_time DESC LIMIT ?'
  ) as SqliteStatement).all(side, limit);
}

// 获取模拟交易准确性统计（独立 BUY/SELL）
export function getAccuracyStats(): any {
  ensureSimTables();
  const total = (db.prepare("SELECT COUNT(*) as c FROM ai_analysis").get() as any).c;
  const buyCount = (db.prepare("SELECT COUNT(*) as c FROM ai_analysis WHERE recommendation = 'BUY'").get() as any).c;

  const allTrades = (db.prepare(`
    SELECT st.*, aa.score as ai_score, aa.recommendation as ai_recommendation
    FROM sim_trades st
    JOIN ai_analysis aa ON st.chain_id = aa.chain_id AND st.contract_address = aa.contract_address
    WHERE st.trade_type = 'ai_auto' AND st.side = 'BUY'
  `) as SqliteStatement).all() as any[];

  const buyTrades = allTrades.filter(t => t.ai_recommendation === 'BUY');
  const holdTrades = allTrades.filter(t => t.ai_recommendation === 'HOLD');
  const avoidTrades = allTrades.filter(t => t.ai_recommendation === 'AVOID');

  let profitableCount = 0;
  let totalPnl = 0;
  let totalReturn = 0;
  let misjudgeCount = 0;
  let missCount = 0;

  for (const trade of allTrades) {
    if (trade.status === 'CLOSED' && trade.pnl) {
      const pnl = parseFloat(trade.pnl);
      if (pnl > 0) profitableCount++;
      totalPnl += pnl;
      totalReturn += trade.pnl_percent || 0;
      if (trade.ai_recommendation === 'BUY' && pnl < 0) misjudgeCount++;
      if (trade.ai_recommendation === 'AVOID' && pnl > 0) missCount++;
    }
  }

  const closedTrades = allTrades.filter(t => t.status === 'CLOSED').length;
  const winRate = closedTrades > 0 ? (profitableCount / closedTrades * 100) : 0;
  const avgReturn = closedTrades > 0 ? (totalReturn / closedTrades) : 0;
  const misjudgeRate = closedTrades > 0 ? (misjudgeCount / closedTrades * 100) : 0;
  const missRate = closedTrades > 0 ? (missCount / closedTrades * 100) : 0;

  // 独立 SELL 统计
  const sellTrades = (db.prepare(
    "SELECT * FROM sim_trades WHERE side = 'SELL' ORDER BY entry_time DESC"
  ) as SqliteStatement).all() as any[];
  const sellCount = sellTrades.length;
  const sellPnl = sellTrades.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);

  // 按评分区间统计
  const scoreBands = [
    { min: 0, max: 29, label: '0-29 (低分)' },
    { min: 30, max: 49, label: '30-49' },
    { min: 50, max: 69, label: '50-69' },
    { min: 70, max: 100, label: '70-100 (BUY)' },
  ];

  const bandStats = scoreBands.map(band => {
    const bandTrades = allTrades.filter(t => t.ai_score >= band.min && t.ai_score <= band.max);
    const bandClosed = bandTrades.filter(t => t.status === 'CLOSED');
    const bandProfitable = bandClosed.filter(t => t.pnl && parseFloat(t.pnl) > 0);
    const bandPnl = bandClosed.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);
    const bandAvgReturn = bandClosed.length > 0 ? bandClosed.reduce((sum, t) => sum + (t.pnl_percent || 0), 0) / bandClosed.length : 0;
    return {
      scoreRange: band.label,
      total: bandTrades.length,
      closed: bandClosed.length,
      profitable: bandProfitable.length,
      winRate: bandClosed.length > 0 ? (bandProfitable.length / bandClosed.length * 100).toFixed(1) + '%' : '0%',
      avgReturn: bandAvgReturn.toFixed(2) + '%',
      totalPnl: bandPnl.toFixed(2),
    };
  });

  const recStats = ['BUY', 'HOLD', 'AVOID'].map(rec => {
    const recTrades = allTrades.filter(t => t.ai_recommendation === rec);
    const recClosed = recTrades.filter(t => t.status === 'CLOSED');
    const recProfitable = recClosed.filter(t => t.pnl && parseFloat(t.pnl) > 0);
    const recPnl = recClosed.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);
    return {
      recommendation: rec,
      total: recTrades.length,
      closed: recClosed.length,
      profitable: recProfitable.length,
      winRate: recClosed.length > 0 ? (recProfitable.length / recClosed.length * 100).toFixed(1) + '%' : '0%',
      totalPnl: recPnl.toFixed(2),
    };
  });

  return {
    totalAnalysis: total,
    buyRecommendations: buyCount,
    tradesOpened: allTrades.length,
    tradesClosed: closedTrades,
    profitableTrades: profitableCount,
    winRate: winRate.toFixed(1) + '%',
    totalPnl: totalPnl.toFixed(2),
    avgReturn: avgReturn.toFixed(2) + '%',
    misjudgeRate: misjudgeRate.toFixed(1) + '%',
    missRate: missRate.toFixed(1) + '%',
    // 独立 BUY/SELL 统计
    buyCount: allTrades.length,
    sellCount: sellCount,
    sellPnl: sellPnl.toFixed(2),
    scoreBands: bandStats,
    recommendationStats: recStats,
  };
}
