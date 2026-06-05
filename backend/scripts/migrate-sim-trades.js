#!/usr/bin/env node
/**
 * 迁移 sim_trades 表：旧字段名 → Web3 swap 语义新字段名
 * 旧：entry_price, entry_amount, entry_quantity, exit_price, exit_amount, exit_reason, exit_time, entry_time, status(OPEN/CLOSED)
 * 新：price, from_amount, to_amount, created_at, updated_at, closed_at, status(PENDING/SUCCESS/FAILED)
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'web3_tokens.db');
const db = new DatabaseSync(DB_PATH);

console.log('[Migration] 开始迁移 sim_trades 表...');

// 检查当前表结构
const oldCols = db.prepare('PRAGMA table_info(sim_trades)').all().map(c => c.name);
console.log('[Migration] 当前字段:', oldCols.join(', '));

// 如果已经是新结构，跳过
if (oldCols.includes('price') && oldCols.includes('from_amount') && !oldCols.includes('entry_price')) {
  console.log('[Migration] sim_trades 已是新结构，跳过');
  process.exit(0);
}

const rowCount = db.prepare('SELECT COUNT(*) as c FROM sim_trades').get().c;
console.log(`[Migration] sim_trades 有 ${rowCount} 行数据`);

// 创建新表
db.exec(`
  CREATE TABLE IF NOT EXISTS sim_trades_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT NOT NULL UNIQUE,
    tx_hash TEXT,
    parent_trade_id TEXT,
    trade_type TEXT DEFAULT 'manual',
    strategy TEXT,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    symbol TEXT,
    side TEXT NOT NULL,
    order_type TEXT DEFAULT 'MARKET',
    is_simulated INTEGER DEFAULT 1,
    payment_token TEXT DEFAULT 'USDT',
    payment_amount TEXT,
    from_token TEXT,
    from_amount TEXT,
    from_contract TEXT,
    to_token TEXT,
    to_amount TEXT,
    to_contract TEXT,
    price TEXT,
    price_impact TEXT,
    gas_fee TEXT,
    gas_token TEXT,
    fee_amount TEXT,
    fee_token TEXT,
    stop_loss_price TEXT,
    stop_loss_percent REAL,
    take_profit_price TEXT,
    take_profit_percent REAL,
    trigger_reason TEXT,
    trigger_scores TEXT,
    status TEXT DEFAULT 'PENDING',
    swap_status TEXT,
    pnl TEXT,
    pnl_percent REAL,
    holding_duration_minutes INTEGER,
    created_at INTEGER,
    updated_at INTEGER,
    closed_at INTEGER
  )
`);

// 迁移数据：旧字段 → 新字段
// status 映射：OPEN → PENDING（未平仓）, CLOSED → SUCCESS（已平仓）
db.exec(`
  INSERT INTO sim_trades_new (
    id, trade_id, trade_type, strategy, chain_id, contract_address, symbol,
    side, order_type, is_simulated,
    from_token, from_amount, to_token, to_amount, price,
    stop_loss_price, stop_loss_percent, take_profit_price, take_profit_percent,
    trigger_reason, trigger_scores, status, pnl, pnl_percent,
    holding_duration_minutes, created_at, updated_at, closed_at
  )
  SELECT
    id, trade_id, trade_type, strategy, chain_id, contract_address, symbol,
    side, order_type, is_simulated,
    CASE WHEN side = 'BUY' THEN 'USDT' ELSE symbol END as from_token,
    CASE WHEN side = 'BUY' THEN entry_amount ELSE entry_quantity END as from_amount,
    CASE WHEN side = 'BUY' THEN symbol ELSE 'USDT' END as to_token,
    CASE WHEN side = 'BUY' THEN entry_quantity ELSE entry_amount END as to_amount,
    entry_price as price,
    stop_loss_price, stop_loss_percent, take_profit_price, take_profit_percent,
    trigger_reason, trigger_scores,
    CASE WHEN status = 'OPEN' THEN 'PENDING' WHEN status = 'CLOSED' THEN 'SUCCESS' ELSE status END as status,
    pnl, pnl_percent, holding_duration_minutes,
    COALESCE(entry_time, created_at, datetime('now')) as created_at,
    COALESCE(updated_at, datetime('now')) as updated_at,
    exit_time as closed_at
  FROM sim_trades
`);

// 替换旧表
db.exec('DROP TABLE sim_trades');
db.exec('ALTER TABLE sim_trades_new RENAME TO sim_trades');

// 验证
const newCols = db.prepare('PRAGMA table_info(sim_trades)').all().map(c => c.name);
const newCount = db.prepare('SELECT COUNT(*) as c FROM sim_trades').get().c;
console.log('[Migration] 新字段:', newCols.join(', '));
console.log(`[Migration] 迁移完成，${newCount} 行数据已迁移`);

// 检查 sim_pending_orders 表结构
const poCols = db.prepare('PRAGMA table_info(sim_pending_orders)').all().map(c => c.name);
console.log('[Migration] sim_pending_orders 字段:', poCols.join(', '));

// 检查 portfolio_state 表结构
const psCols = db.prepare('PRAGMA table_info(portfolio_state)').all().map(c => c.name);
console.log('[Migration] portfolio_state 字段:', psCols.join(', '));

// 如果 portfolio_state 缺少预算字段，添加
if (!psCols.includes('total_budget')) {
  console.log('[Migration] 添加 portfolio_state 预算字段...');
  db.exec('ALTER TABLE portfolio_state ADD COLUMN total_budget REAL DEFAULT 10000');
  db.exec('ALTER TABLE portfolio_state ADD COLUMN used_budget REAL DEFAULT 0');
  db.exec('ALTER TABLE portfolio_state ADD COLUMN available_budget REAL DEFAULT 10000');
  db.exec('ALTER TABLE portfolio_state ADD COLUMN max_per_trade_amount REAL DEFAULT 100');
  db.exec('ALTER TABLE portfolio_state ADD COLUMN max_positions INTEGER DEFAULT 1000');
  db.exec('ALTER TABLE portfolio_state ADD COLUMN max_chain_pct REAL DEFAULT 40');
  console.log('[Migration] portfolio_state 预算字段已添加');
}

console.log('[Migration] 全部完成！');
