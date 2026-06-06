/**
 * 历史数据迁移：为已平仓BUY记录补生成独立SELL记录
 * 
 * 执行方式：node scripts/migrate-sell-records.js
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');

const { db } = require(path.join(__dirname, '..', 'dist', 'db', 'database'));
require(path.join(__dirname, '..', 'dist', 'services', 'simTradeService')).ensureSimTables();

// 查找需要迁移的BUY记录
const orphanBuys = db.prepare(`
  SELECT t.* FROM sim_trades t 
  WHERE t.side = 'BUY' 
    AND t.closed_at IS NOT NULL 
    AND NOT EXISTS (SELECT 1 FROM sim_trades s WHERE s.parent_trade_id = t.trade_id AND s.side = 'SELL')
  ORDER BY t.created_at ASC
`).all();

console.log(`[Migration] 找到 ${orphanBuys.length} 笔需要补SELL记录的BUY`);

if (orphanBuys.length === 0) {
  console.log('[Migration] 无需迁移');
  process.exit(0);
}

const insertSell = db.prepare(`INSERT INTO sim_trades (
  trade_id, parent_trade_id, trade_type, strategy, chain_id, contract_address, symbol,
  side, is_simulated,
  from_token, from_amount, from_contract,
  to_token, to_amount, to_contract,
  price, price_impact, gas_fee, gas_token,
  trigger_reason,
  status, pnl, pnl_percent, holding_duration_minutes,
  created_at, updated_at, closed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 'SELL', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?, ?)`);

const updateBuyStatus = db.prepare(`UPDATE sim_trades SET status = 'CLOSED' WHERE trade_id = ?`);

let migrated = 0;
let skipped = 0;
let totalSellPnl = 0;

db.exec('BEGIN');
try {
  for (const buy of orphanBuys) {
    const buyFromAmount = parseFloat(buy.from_amount || '0');
    const buyToAmount = parseFloat(buy.to_amount || '0');
    const buyPnl = parseFloat(buy.pnl || '0');
    const entryPrice = parseFloat(buy.price || '0');

    // 从BUY的pnl反推exitPrice
    let exitPrice = 0;
    if (buyToAmount > 0) {
      exitPrice = (buyPnl + buyFromAmount) / buyToAmount;
    } else if (entryPrice > 0 && buyFromAmount > 0) {
      exitPrice = entryPrice * (1 + buyPnl / buyFromAmount);
    }

    if (exitPrice <= 0) {
      console.log(`[SKIP] ${buy.symbol} (${buy.trade_id.substring(0,8)}): 无法推算exitPrice`);
      skipped++;
      continue;
    }

    const sellFromAmount = buyToAmount;
    const sellToAmount = buyToAmount * exitPrice;
    const pnl = sellToAmount - buyFromAmount;
    const pnlPct = buyFromAmount > 0 ? (pnl / buyFromAmount) * 100 : 0;
    const holdMin = Math.floor((buy.closed_at - buy.created_at) / 60000);

    insertSell.run(
      uuidv4(), buy.trade_id, buy.trade_type, buy.strategy, buy.chain_id,
      buy.contract_address, buy.symbol,
      buy.to_token || null, sellFromAmount.toString(), buy.to_contract || null,
      buy.from_token || null, sellToAmount.toFixed(6), buy.from_contract || null,
      exitPrice.toString(), null, null, null,
      'migrated:historical',
      pnl.toFixed(6), pnlPct, holdMin,
      buy.closed_at, buy.closed_at, buy.closed_at
    );

    updateBuyStatus.run(buy.trade_id);
    totalSellPnl += pnl;
    migrated++;
    if (migrated % 50 === 0) console.log(`[Migration] 已处理 ${migrated}/${orphanBuys.length}...`);
  }

  db.exec('COMMIT');
  console.log(`\n[Migration] 完成！`);
  console.log(`  迁移: ${migrated} 笔`);
  console.log(`  跳过: ${skipped} 笔`);
  console.log(`  SELL总PnL: $${totalSellPnl.toFixed(2)}`);

  const verify = db.prepare(`SELECT COUNT(*) as c FROM sim_trades WHERE side = 'SELL'`).get();
  const verifyOrphan = db.prepare(`
    SELECT COUNT(*) as c FROM sim_trades t 
    WHERE t.side = 'BUY' AND t.closed_at IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM sim_trades s WHERE s.parent_trade_id = t.trade_id AND s.side = 'SELL')
  `).get();
  console.log(`\n[验证] SELL总数: ${verify.c}`);
  console.log(`[验证] 仍无SELL的BUY: ${verifyOrphan.c}`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('[Migration] 失败，已回滚:', err.message);
  process.exit(1);
}
