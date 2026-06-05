// 模拟/实盘统一交易服务 — 表结构对齐 Binance Web3 Swap API

import { db } from '../db/database';
import { AnalysisResult } from './aiAnalysisService';
import { v4 as uuidv4 } from 'uuid';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

const DEFAULT_BUY_AMOUNT = 100;
const BUY_AMOUNT_MAP: Record<string, number> = { 'BUY': 100, 'HOLD': 50, 'AVOID': 10 };
const DEFAULT_STOP_LOSS = -20;
const DEFAULT_TAKE_PROFIT = 50;

const CHAIN_PAYMENT_TOKEN: Record<string, string> = {
  'bsc': 'BNB', '56': 'BNB', 'solana': 'SOL', 'CT_501': 'SOL',
  'base': 'ETH', '8453': 'ETH', 'eth': 'ETH', '1': 'ETH',
};
function getPaymentToken(chainId: string): string { return CHAIN_PAYMENT_TOKEN[chainId] || 'USDT'; }

// ==================== 初始化表 ====================

export function ensureSimTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sim_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL UNIQUE,           -- 系统 UUID
      tx_hash TEXT,                            -- 链上交易哈希（模拟盘为空）
      parent_trade_id TEXT,                    -- SELL 关联的 BUY trade_id
      trade_type TEXT DEFAULT 'manual',        -- manual/auto/live
      strategy TEXT,
      chain_id TEXT NOT NULL,                  -- bsc/solana/base/eth
      dex TEXT,                                -- DEX 名称（PancakeSwap/Uniswap 等）
      contract_address TEXT NOT NULL,
      symbol TEXT,
      side TEXT NOT NULL,                      -- 'BUY'（tokenIn→tokenOut）或 'SELL'（tokenOut→tokenIn）
      is_simulated INTEGER DEFAULT 1,          -- 1=模拟，0=实盘
      -- Web3 swap 字段（对齐 Binance Web3 Swap API）
      from_token TEXT,                         -- 输入代币符号（如 USDT/BNB）
      from_amount TEXT,                        -- 输入数量
      from_contract TEXT,                      -- 输入代币合约地址
      to_token TEXT,                           -- 输出代币符号
      to_amount TEXT,                          -- 输出数量
      to_contract TEXT,                        -- 输出代币合约地址
      price TEXT,                              -- 成交价格（to_amount / from_amount）
      price_impact TEXT,                       -- 价格影响百分比
      gas_fee TEXT,                            -- Gas 费用（原生代币）
      gas_token TEXT,                          -- Gas 代币（BNB/ETH/SOL）
      fee_amount TEXT,                         -- 手续费金额
      fee_token TEXT,                          -- 手续费代币
      -- 止盈止损（本地逻辑）
      stop_loss_price TEXT,
      stop_loss_percent REAL,
      take_profit_price TEXT,
      take_profit_percent REAL,
      trigger_reason TEXT,
      trigger_scores TEXT,
      -- 状态（对齐 Web3 swap 状态）
      status TEXT DEFAULT 'PENDING',           -- PENDING/SUCCESS/FAILED/CANCELLED
      swap_status TEXT,                        -- 交易所原始状态
      -- 盈亏
      pnl TEXT,
      pnl_percent REAL,
      holding_duration_minutes INTEGER,
      -- 时间（毫秒时间戳）
      created_at INTEGER,
      updated_at INTEGER,
      closed_at INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sim_pending_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL UNIQUE,
      parent_trade_id TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      symbol TEXT,
      side TEXT NOT NULL DEFAULT 'SELL',
      order_type TEXT NOT NULL,
      quantity TEXT NOT NULL,
      trigger_price TEXT NOT NULL,
      trigger_percent REAL,
      status TEXT DEFAULT 'PENDING',
      triggered_at INTEGER,
      filled_price TEXT,
      created_at INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id TEXT NOT NULL UNIQUE DEFAULT 'main',
      total_budget REAL DEFAULT 10000,
      used_budget REAL DEFAULT 0,
      available_budget REAL DEFAULT 10000,
      max_per_trade_amount REAL DEFAULT 100,
      max_positions INTEGER DEFAULT 1000,
      max_chain_pct REAL DEFAULT 40,
      total_trades INTEGER DEFAULT 0,
      winning_trades INTEGER DEFAULT 0,
      losing_trades INTEGER DEFAULT 0,
      total_pnl REAL DEFAULT 0,
      position_count INTEGER DEFAULT 0,
      last_trade_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  const main = (db.prepare("SELECT portfolio_id FROM portfolio_state WHERE portfolio_id = 'main'") as SqliteStatement).get();
  if (!main) {
    db.prepare("INSERT INTO portfolio_state (portfolio_id, created_at, updated_at) VALUES ('main', ?, ?)").run(Date.now(), Date.now());
  }
}

// ==================== 预算控制 ====================

function getPortfolio(): any {
  return (db.prepare("SELECT * FROM portfolio_state WHERE portfolio_id = 'main'") as SqliteStatement).get();
}

function checkBudget(amount: number, chainId: string): { ok: boolean; reason?: string } {
  const p = getPortfolio();
  if (!p) return { ok: false, reason: 'portfolio_not_found' };
  if (amount > p.available_budget) return { ok: false, reason: `insufficient_budget: need $${amount}, available $${p.available_budget}` };
  if (amount > p.max_per_trade_amount) return { ok: false, reason: `exceeds_max_per_trade: $${amount} > $${p.max_per_trade_amount}` };
  const openCount = (db.prepare("SELECT COUNT(*) as c FROM sim_trades WHERE side = 'BUY' AND status = 'SUCCESS'") as SqliteStatement).get() as any;
  if (openCount && openCount.c >= p.max_positions) return { ok: false, reason: `max_positions_reached: ${openCount.c}/${p.max_positions}` };
  const chainInvested = (db.prepare("SELECT COALESCE(SUM(CAST(from_amount AS REAL)), 0) as s FROM sim_trades WHERE side = 'BUY' AND status = 'SUCCESS' AND chain_id = ?") as SqliteStatement).get(chainId) as any;
  const chainMax = p.total_budget * (p.max_chain_pct / 100);
  if (chainInvested && (chainInvested.s + amount) > chainMax) return { ok: false, reason: `chain_limit_exceeded: ${chainId} invested $${chainInvested.s}, limit $${chainMax}` };
  return { ok: true };
}

function deductBudget(amount: number): void {
  db.prepare("UPDATE portfolio_state SET used_budget = used_budget + ?, available_budget = available_budget - ?, updated_at = ? WHERE portfolio_id = 'main'").run(amount, amount, Date.now());
}

function releaseBudget(amount: number): void {
  db.prepare("UPDATE portfolio_state SET used_budget = MAX(0, used_budget - ?), available_budget = available_budget + ?, updated_at = ? WHERE portfolio_id = 'main'").run(amount, amount, Date.now());
}

export function getPortfolioInfo(): any {
  ensureSimTables();
  const p = getPortfolio();
  if (!p) return null;
  const openTrades = (db.prepare("SELECT COUNT(*) as c FROM sim_trades WHERE side = 'BUY' AND status = 'SUCCESS'") as SqliteStatement).get() as any;
  return {
    portfolio_id: p.portfolio_id, total_budget: p.total_budget, used_budget: p.used_budget,
    available_budget: p.available_budget, max_per_trade_amount: p.max_per_trade_amount,
    max_positions: p.max_positions, max_chain_pct: p.max_chain_pct,
    open_positions: openTrades?.c || 0, total_trades: p.total_trades,
    winning_trades: p.winning_trades, losing_trades: p.losing_trades, total_pnl: p.total_pnl,
  };
}

export function updateBudget(config: { total_budget?: number; max_per_trade_amount?: number; max_positions?: number; max_chain_pct?: number }): any {
  ensureSimTables();
  const p = getPortfolio();
  if (!p) return null;
  const updates: string[] = [];
  const params: any[] = [];
  if (config.total_budget !== undefined) { updates.push('total_budget = ?', 'available_budget = available_budget + ?'); params.push(config.total_budget, config.total_budget - p.total_budget); }
  if (config.max_per_trade_amount !== undefined) { updates.push('max_per_trade_amount = ?'); params.push(config.max_per_trade_amount); }
  if (config.max_positions !== undefined) { updates.push('max_positions = ?'); params.push(config.max_positions); }
  if (config.max_chain_pct !== undefined) { updates.push('max_chain_pct = ?'); params.push(config.max_chain_pct); }
  if (updates.length === 0) return getPortfolioInfo();
  updates.push('updated_at = ?'); params.push(Date.now(), 'main');
  db.prepare(`UPDATE portfolio_state SET ${updates.join(', ')} WHERE portfolio_id = ?`).run(...params);
  return getPortfolioInfo();
}

// ==================== 统一下单函数（Web3 swap 语义） ====================

interface PlaceOrderParams {
  chain_id: string;
  contract_address: string;
  symbol?: string;
  dex?: string;
  side: 'BUY' | 'SELL';
  from_token?: string;        // 输入代币（如 USDT/BNB）
  from_amount?: number;       // 输入数量
  from_contract?: string;     // 输入代币合约
  to_token?: string;          // 输出代币
  to_amount?: number;         // 输出数量
  to_contract?: string;       // 输出代币合约
  price?: number;             // 成交价格
  price_impact?: number;      // 价格影响
  gas_fee?: number;           // Gas 费用
  gas_token?: string;         // Gas 代币
  is_simulated?: number;
  strategy?: string;
  trigger_reason?: string;
  trigger_scores?: any;
  stop_loss_percent?: number;
  take_profit_percent?: number;
  parent_trade_id?: string;
}

export function placeOrder(params: PlaceOrderParams): any {
  ensureSimTables();
  const isSimulated = params.is_simulated ?? 1;
  const now = Date.now();
  const tradeId = uuidv4();
  const paymentToken = getPaymentToken(params.chain_id);

  // 计算价格：如果没提供 price，用 to_amount / from_amount
  const fromAmount = params.from_amount || 0;
  const toAmount = params.to_amount || 0;
  const price = params.price || (fromAmount > 0 && toAmount > 0 ? toAmount / fromAmount : 0);
  const slPct = params.stop_loss_percent ?? DEFAULT_STOP_LOSS;
  const tpPct = params.take_profit_percent ?? DEFAULT_TAKE_PROFIT;
  const slPrice = price > 0 ? (price * (1 + slPct / 100)).toString() : '0';
  const tpPrice = price > 0 ? (price * (1 + tpPct / 100)).toString() : '0';

  if (params.side === 'BUY') {
    const budgetCheck = checkBudget(fromAmount, params.chain_id);
    if (!budgetCheck.ok) {
      console.log(`[Swap] SKIP ${params.symbol}: ${budgetCheck.reason}`);
      return { success: false, reason: budgetCheck.reason };
    }
  }

  if (isSimulated === 1) {
    // 模拟盘：本地直接生成 SUCCESS 记录
    (db.prepare(`INSERT INTO sim_trades (
      trade_id, trade_type, strategy, chain_id, dex, contract_address, symbol, side, is_simulated,
      from_token, from_amount, from_contract, to_token, to_amount, to_contract,
      price, price_impact, gas_fee, gas_token,
      stop_loss_price, stop_loss_percent, take_profit_price, take_profit_percent,
      trigger_reason, trigger_scores, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESS', ?, ?)`)).run(
      tradeId, 'auto', params.strategy || null, params.chain_id, params.dex || null,
      params.contract_address, params.symbol || null, params.side,
      params.from_token || paymentToken, fromAmount.toString(), params.from_contract || null,
      params.to_token || params.symbol || null, toAmount.toString(), params.to_contract || null,
      price.toString(), params.price_impact?.toString() || null,
      params.gas_fee?.toString() || null, params.gas_token || paymentToken,
      slPrice, slPct, tpPrice, tpPct,
      params.trigger_reason || null, params.trigger_scores ? JSON.stringify(params.trigger_scores) : null,
      now, now
    );

    if (params.side === 'BUY') {
      deductBudget(fromAmount);
      createPendingSellOrders(tradeId, params.chain_id, params.contract_address, params.symbol || null, toAmount.toString(), price);
      db.prepare("UPDATE portfolio_state SET total_trades = total_trades + 1, position_count = position_count + 1, last_trade_at = ? WHERE portfolio_id = 'main'").run(now);
    }

    console.log(`[Swap] ${params.side}: ${params.symbol} | ${fromAmount} ${params.from_token || paymentToken} → ${toAmount} ${params.to_token || params.symbol}`);
    return { success: true, trade_id: tradeId, status: 'SUCCESS', is_simulated: 1 };
  } else {
    // 实盘：记录为 PENDING，等待链上 txHash 回调
    (db.prepare(`INSERT INTO sim_trades (
      trade_id, trade_type, strategy, chain_id, dex, contract_address, symbol, side, is_simulated,
      from_token, from_amount, from_contract, to_token, to_amount, to_contract,
      price, price_impact, gas_fee, gas_token,
      stop_loss_price, stop_loss_percent, take_profit_price, take_profit_percent,
      trigger_reason, trigger_scores, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`)).run(
      tradeId, 'live', params.strategy || null, params.chain_id, params.dex || null,
      params.contract_address, params.symbol || null, params.side,
      params.from_token || paymentToken, fromAmount.toString(), params.from_contract || null,
      params.to_token || params.symbol || null, toAmount.toString(), params.to_contract || null,
      price.toString(), params.price_impact?.toString() || null,
      params.gas_fee?.toString() || null, params.gas_token || paymentToken,
      slPrice, slPct, tpPrice, tpPct,
      params.trigger_reason || null, params.trigger_scores ? JSON.stringify(params.trigger_scores) : null,
      now, now
    );
    return { success: true, trade_id: tradeId, status: 'PENDING', is_simulated: 0 };
  }
}

// ==================== 挂单管理 ====================

function createPendingSellOrders(buyTradeId: string, chainId: string, contractAddress: string, symbol: string | null, quantity: string, entryPrice: number): void {
  if (!quantity || parseFloat(quantity) <= 0) return;
  const halfQty = (parseFloat(quantity) / 2).toString();
  const now = Date.now();
  const slPrice = entryPrice * (1 + DEFAULT_STOP_LOSS / 100);
  const tpPrice = entryPrice * (1 + DEFAULT_TAKE_PROFIT / 100);

  (db.prepare(`INSERT INTO sim_pending_orders (order_id, parent_trade_id, chain_id, contract_address, symbol, side, order_type, quantity, trigger_price, trigger_percent, status, created_at) VALUES (?, ?, ?, ?, ?, 'SELL', 'STOP_LOSS', ?, ?, ?, 'PENDING', ?)`)).run(uuidv4(), buyTradeId, chainId, contractAddress, symbol, halfQty, slPrice.toString(), DEFAULT_STOP_LOSS, now);
  (db.prepare(`INSERT INTO sim_pending_orders (order_id, parent_trade_id, chain_id, contract_address, symbol, side, order_type, quantity, trigger_price, trigger_percent, status, created_at) VALUES (?, ?, ?, ?, ?, 'SELL', 'TAKE_PROFIT', ?, ?, ?, 'PENDING', ?)`)).run(uuidv4(), buyTradeId, chainId, contractAddress, symbol, halfQty, tpPrice.toString(), DEFAULT_TAKE_PROFIT, now);
}

export function checkAndTriggerPendingOrders(): number {
  ensureSimTables();
  let triggerCount = 0;
  const pendingOrders = (db.prepare(`SELECT po.*, t.price_latest FROM sim_pending_orders po JOIN tokens t ON po.chain_id = t.chain_id AND po.contract_address = t.contract_address WHERE po.status = 'PENDING'`) as SqliteStatement).all() as any[];
  for (const order of pendingOrders) {
    const currentPrice = parseFloat(order.price_latest);
    if (!currentPrice || currentPrice <= 0) continue;
    const triggerPrice = parseFloat(order.trigger_price);
    let shouldTrigger = false;
    if (order.order_type === 'STOP_LOSS' && currentPrice <= triggerPrice) shouldTrigger = true;
    if (order.order_type === 'TAKE_PROFIT' && currentPrice >= triggerPrice) shouldTrigger = true;
    if (shouldTrigger) { executePendingOrder(order, currentPrice); triggerCount++; }
  }
  return triggerCount;
}

function executePendingOrder(order: any, currentPrice: number): void {
  const now = Date.now();
  const buyTrade = (db.prepare('SELECT * FROM sim_trades WHERE trade_id = ?') as SqliteStatement).get(order.parent_trade_id) as any;

  (db.prepare(`UPDATE sim_pending_orders SET status = 'TRIGGERED', triggered_at = ?, filled_price = ? WHERE order_id = ?`)).run(now, currentPrice.toString(), order.order_id);
  (db.prepare(`UPDATE sim_pending_orders SET status = 'CANCELED' WHERE parent_trade_id = ? AND order_id != ? AND status = 'PENDING'`)).run(order.parent_trade_id, order.order_id);

  const entryPrice = buyTrade ? parseFloat(buyTrade.price) : 0;
  const sellQty = parseFloat(order.quantity);
  const sellAmount = sellQty * currentPrice;
  const pnl = entryPrice > 0 ? (currentPrice - entryPrice) * sellQty : 0;
  const pnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
  const holdMin = buyTrade ? Math.floor((now - buyTrade.created_at) / 60000) : 0;

  (db.prepare(`INSERT INTO sim_trades (
    trade_id, parent_trade_id, trade_type, strategy, chain_id, contract_address, symbol,
    side, is_simulated, from_token, from_amount, to_token, to_amount, price,
    status, pnl, pnl_percent, holding_duration_minutes, created_at, updated_at, closed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SELL', 1, ?, ?, ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?, ?)`)).run(
    uuidv4(), order.parent_trade_id, buyTrade?.trade_type || 'triggered', buyTrade?.strategy || null,
    order.chain_id, order.contract_address, order.symbol,
    buyTrade?.to_token || null, order.quantity, buyTrade?.from_token || null, sellAmount.toString(),
    currentPrice.toString(),
    pnl.toFixed(6), pnlPct, holdMin, now, now, now
  );

  if (buyTrade) {
    (db.prepare(`UPDATE sim_trades SET status = 'SUCCESS', closed_at = ?, updated_at = ?, pnl = ?, pnl_percent = ?, holding_duration_minutes = ? WHERE trade_id = ?`)).run(now, now, pnl.toFixed(6), pnlPct, holdMin, order.parent_trade_id);
    const entryAmount = parseFloat(buyTrade.from_amount || '0');
    if (entryAmount > 0) releaseBudget(entryAmount);
  }

  const isWin = pnl > 0;
  (db.prepare(`UPDATE portfolio_state SET winning_trades = winning_trades + ?, losing_trades = losing_trades + ?, total_pnl = CAST(total_pnl AS REAL) + ?, position_count = (SELECT COUNT(*) FROM sim_trades WHERE side = 'BUY' AND status = 'SUCCESS'), updated_at = ? WHERE portfolio_id = 'main'`)).run(isWin ? 1 : 0, isWin ? 0 : 1, pnl, now);
  console.log(`[Swap] SELL ${order.order_type}: ${order.symbol} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
}

// ==================== 手动平仓 ====================

export function closePosition(trade: any, exitPrice: number, exitReason: string): void {
  ensureSimTables();
  const now = Date.now();
  const entryPrice = parseFloat(trade.price);
  const pnl = (exitPrice - entryPrice) / entryPrice * parseFloat(trade.from_amount || '100');
  const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  const holdMin = Math.floor((now - trade.created_at) / 60000);
  const exitQty = trade.to_amount;
  const exitAmount = exitQty ? (parseFloat(exitQty) * exitPrice).toString() : null;

  (db.prepare(`INSERT INTO sim_trades (
    trade_id, parent_trade_id, trade_type, strategy, chain_id, contract_address, symbol,
    side, is_simulated, from_token, from_amount, to_token, to_amount, price,
    status, pnl, pnl_percent, holding_duration_minutes, trigger_reason, created_at, updated_at, closed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SELL', 1, ?, ?, ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?, ?, ?)`)).run(
    uuidv4(), trade.trade_id, trade.trade_type, trade.strategy,
    trade.chain_id, trade.contract_address, trade.symbol,
    trade.to_token || null, exitQty, trade.from_token || null, exitAmount,
    exitPrice.toString(),
    pnl.toFixed(6), pnlPct, holdMin, exitReason, now, now, now
  );

  (db.prepare(`UPDATE sim_trades SET status = 'SUCCESS', closed_at = ?, updated_at = ?, pnl = ?, pnl_percent = ?, holding_duration_minutes = ? WHERE trade_id = ?`)).run(now, now, pnl.toFixed(6), pnlPct, holdMin, trade.trade_id);
  (db.prepare(`UPDATE sim_pending_orders SET status = 'CANCELED' WHERE parent_trade_id = ? AND status = 'PENDING'`)).run(trade.trade_id);

  const entryAmount = parseFloat(trade.from_amount || '0');
  if (entryAmount > 0) releaseBudget(entryAmount);

  const isWin = pnl > 0;
  (db.prepare(`UPDATE portfolio_state SET winning_trades = winning_trades + ?, losing_trades = losing_trades + ?, total_pnl = CAST(total_pnl AS REAL) + ?, position_count = (SELECT COUNT(*) FROM sim_trades WHERE side = 'BUY' AND status = 'SUCCESS'), updated_at = ? WHERE portfolio_id = 'main'`)).run(isWin ? 1 : 0, isWin ? 0 : 1, pnl, now);
  console.log(`[Swap] SELL(manual): ${trade.symbol} | PnL: $${pnl.toFixed(2)}`);
}

// ==================== 兼容旧接口 ====================

export function checkAndClosePositions(): number { return checkAndTriggerPendingOrders(); }

// ==================== 全量买入 ====================

export function executeAutoBuyAll(): number {
  ensureSimTables();
  let buyCount = 0;
  const allTokens = (db.prepare(`SELECT t.chain_id, t.contract_address, t.symbol, t.price_latest FROM tokens t WHERE t.price_latest IS NOT NULL AND CAST(t.price_latest AS REAL) > 0`) as SqliteStatement).all() as any[];
  const aiMap = new Map<string, any>();
  try { const rows = (db.prepare('SELECT chain_id, contract_address, score, recommendation FROM ai_analysis') as SqliteStatement).all() as any[]; for (const r of rows) aiMap.set(`${r.chain_id}:${r.contract_address}`, r); } catch (e) {}

  for (const token of allTokens) {
    const existing = (db.prepare(`SELECT id FROM sim_trades WHERE chain_id = ? AND contract_address = ? AND side = 'BUY' AND status = 'SUCCESS'`) as SqliteStatement).get(token.chain_id, token.contract_address) as any;
    if (existing) continue;
    const entryPrice = parseFloat(token.price_latest);
    if (entryPrice <= 0) continue;
    const ai = aiMap.get(`${token.chain_id}:${token.contract_address}`);
    const rec = ai ? ai.recommendation : 'AVOID';
    const buyAmount = BUY_AMOUNT_MAP[rec] || 10;
    const paymentToken = getPaymentToken(token.chain_id);
    const result = placeOrder({
      chain_id: token.chain_id, contract_address: token.contract_address, symbol: token.symbol, side: 'BUY',
      from_token: paymentToken, from_amount: buyAmount, to_token: token.symbol, to_amount: buyAmount / entryPrice,
      price: entryPrice, is_simulated: 1, strategy: ai ? `ai_${rec.toLowerCase()}` : 'no_ai',
      trigger_reason: ai ? `AI:${ai.score}分(${rec})` : '无AI评估', trigger_scores: ai?.dimensionScores,
      stop_loss_percent: DEFAULT_STOP_LOSS, take_profit_percent: DEFAULT_TAKE_PROFIT,
    });
    if (result.success) buyCount++;
  }
  return buyCount;
}

// ==================== 查询接口 ====================

export function getPendingOrders(status: string = 'PENDING'): any[] {
  ensureSimTables();
  return (db.prepare('SELECT * FROM sim_pending_orders WHERE status = ? ORDER BY created_at DESC') as SqliteStatement).all(status);
}

export function getTradesBySide(side: 'BUY' | 'SELL', limit: number = 50): any[] {
  ensureSimTables();
  return (db.prepare('SELECT * FROM sim_trades WHERE side = ? ORDER BY created_at DESC LIMIT ?') as SqliteStatement).all(side, limit);
}

export function getAccuracyStats(): any {
  ensureSimTables();
  const total = (db.prepare("SELECT COUNT(*) as c FROM ai_analysis").get() as any).c;
  const buyCount = (db.prepare("SELECT COUNT(*) as c FROM ai_analysis WHERE recommendation = 'BUY'").get() as any).c;
  const allTrades = (db.prepare(`SELECT st.*, aa.score as ai_score, aa.recommendation as ai_recommendation FROM sim_trades st JOIN ai_analysis aa ON st.chain_id = aa.chain_id AND st.contract_address = aa.contract_address WHERE st.trade_type = 'auto' AND st.side = 'BUY'`) as SqliteStatement).all() as any[];
  const closedTrades = allTrades.filter(t => t.status === 'SUCCESS' && t.pnl);
  const profitable = closedTrades.filter(t => parseFloat(t.pnl) > 0);
  const totalPnl = closedTrades.reduce((s, t) => s + parseFloat(t.pnl || '0'), 0);
  const winRate = closedTrades.length > 0 ? (profitable.length / closedTrades.length * 100) : 0;
  const sellTrades = (db.prepare("SELECT * FROM sim_trades WHERE side = 'SELL' ORDER BY created_at DESC") as SqliteStatement).all() as any[];
  return { totalAnalysis: total, buyRecommendations: buyCount, tradesOpened: allTrades.length, tradesClosed: closedTrades.length, profitableTrades: profitable.length, winRate: winRate.toFixed(1) + '%', totalPnl: totalPnl.toFixed(2), buyCount: allTrades.length, sellCount: sellTrades.length, sellPnl: sellTrades.reduce((s, t) => s + parseFloat(t.pnl || '0'), 0).toFixed(2) };
}
