const { getDispatcher } = require('../dist/services/proxyService');
const dispatcher = getDispatcher();
const { fetch } = require('undici');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, '../data/web3_tokens.db'));

async function searchCoinGecko(symbol) {
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`, {
      dispatcher,
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (data.coins && data.coins.length > 0) {
      // Find exact symbol match or closest
      const exact = data.coins.find(c => c.symbol.toLowerCase() === symbol.toLowerCase());
      return exact ? exact.id : data.coins[0].id;
    }
  } catch (e) {
    // silent
  }
  return null;
}

async function fetchPriceHistory(coinId, fromTs, toTs) {
  try {
    const fromSec = Math.floor(fromTs / 1000);
    const toSec = Math.floor(toTs / 1000);
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`, {
      dispatcher,
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (data.prices && data.prices.length > 0) {
      return data.prices;
    }
  } catch (e) {
    // silent
  }
  return null;
}

function findMinMaxDuringPeriod(prices, entryTime, exitTime) {
  if (!prices || prices.length === 0) return { min: null, max: null, hitTP: null, hitSL: null };
  
  const filtered = prices.filter(p => p[0] >= entryTime && p[0] <= exitTime);
  if (filtered.length === 0) return { min: null, max: null, hitTP: null, hitSL: null };
  
  let min = Infinity, max = -Infinity;
  let minTime = null, maxTime = null;
  
  for (const [ts, price] of filtered) {
    if (price < min) { min = price; minTime = ts; }
    if (price > max) { max = price; maxTime = ts; }
  }
  
  return { min, max, minTime, maxTime };
}

function checkTPSL(entryPrice, min, max, tpPct = 30, slPct = -15) {
  const tpPrice = entryPrice * (1 + tpPct / 100);
  const slPrice = entryPrice * (1 + slPct / 100);
  
  const hitTP = max !== null && max >= tpPrice;
  const hitSL = min !== null && min <= slPrice;
  
  return { hitTP, hitSL, tpPrice, slPrice };
}

async function main() {
  console.log('=== SOL Token Price Fetcher via CoinGecko Proxy ===\n');
  console.log('Dispatcher:', dispatcher ? 'OK' : 'NULL');
  
  // Get all SOL trades
  const trades = db.prepare(`
    SELECT 
      t.trade_id,
      t.symbol,
      t.contract_address,
      t.chain_id,
      t.price as entry_price,
      t.to_amount,
      t.from_amount,
      t.created_at as entry_time,
      t.closed_at as exit_time,
      s.price as exit_price,
      s.pnl
    FROM sim_trades t
    LEFT JOIN sim_trades s ON s.parent_trade_id = t.trade_id AND s.side = 'SELL'
    WHERE t.side = 'BUY' 
      AND t.status IN ('SUCCESS', 'CLOSED')
      AND t.chain_id LIKE '%501%'
    ORDER BY t.symbol, t.created_at
  `).all();
  
  console.log(`Found ${trades.length} SOL trades\n`);
  
  // Get unique tokens
  const uniqueTokens = {};
  for (const t of trades) {
    if (!uniqueTokens[t.contract_address]) {
      uniqueTokens[t.contract_address] = {
        symbol: t.symbol,
        contract_address: t.contract_address,
        trades: []
      };
    }
    uniqueTokens[t.contract_address].trades.push(t);
  }
  
  const tokenList = Object.values(uniqueTokens);
  console.log(`Unique tokens: ${tokenList.length}\n`);
  
  // Fetch prices for each token
  const results = [];
  let found = 0, notFound = 0, tpHit = 0, slHit = 0, noData = 0;
  
  for (let i = 0; i < tokenList.length; i++) {
    const token = tokenList[i];
    process.stdout.write(`\r[${i+1}/${tokenList.length}] ${token.symbol}...`);
    
    // Search CoinGecko
    const coinId = await searchCoinGecko(token.symbol);
    
    if (!coinId) {
      notFound++;
      for (const trade of token.trades) {
        results.push({
          symbol: token.symbol,
          contract_address: token.contract_address,
          entry_price: parseFloat(trade.entry_price),
          exit_price: trade.exit_price ? parseFloat(trade.exit_price) : null,
          pnl: trade.pnl ? parseFloat(trade.pnl) : null,
          coin_id: null,
          min_during: null,
          max_during: null,
          hit_tp: null,
          hit_sl: null,
          data_quality: 'no_coingecko'
        });
      }
      await new Promise(r => setTimeout(r, 200));
      continue;
    }
    
    found++;
    
    // Fetch historical prices for the earliest and latest trade
    const earliest = Math.min(...token.trades.map(t => t.entry_time));
    const latest = Math.max(...token.trades.map(t => t.exit_time || Date.now()));
    
    const prices = await fetchPriceHistory(coinId, earliest, latest);
    
    for (const trade of token.trades) {
      const entryPrice = parseFloat(trade.entry_price);
      const exitPrice = trade.exit_price ? parseFloat(trade.exit_price) : null;
      
      if (!prices) {
        noData++;
        results.push({
          symbol: token.symbol,
          contract_address: token.contract_address,
          entry_price: entryPrice,
          exit_price: exitPrice,
          pnl: trade.pnl ? parseFloat(trade.pnl) : null,
          coin_id: coinId,
          min_during: null,
          max_during: null,
          hit_tp: null,
          hit_sl: null,
          data_quality: 'no_price_history'
        });
        continue;
      }
      
      const { min, max } = findMinMaxDuringPeriod(prices, trade.entry_time, trade.exit_time || Date.now());
      const { hitTP, hitSL } = checkTPSL(entryPrice, min, max);
      
      if (hitTP) tpHit++;
      if (hitSL) slHit++;
      
      const actualPnl = exitPrice ? ((exitPrice - entryPrice) / entryPrice * 100) : null;
      const simPnl = hitTP ? 30 : hitSL ? -15 : actualPnl;
      
      results.push({
        symbol: token.symbol,
        contract_address: token.contract_address,
        entry_price: entryPrice,
        exit_price: exitPrice,
        pnl: actualPnl,
        sim_pnl: simPnl,
        coin_id: coinId,
        min_during: min,
        max_during: max,
        hit_tp: hitTP,
        hit_sl: hitSL,
        data_quality: 'real'
      });
    }
    
    // Rate limit - CoinGecko free tier: 10-30 calls/min
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n\n=== Results ===');
  console.log(`Total trades: ${results.length}`);
  console.log(`Unique tokens: ${tokenList.length}`);
  console.log(`CoinGecko found: ${found}`);
  console.log(`CoinGecko not found: ${notFound}`);
  console.log(`No price history: ${noData}`);
  console.log(`TP hit (>=30%): ${tpHit}`);
  console.log(`SL hit (<=-15%): ${slHit}`);
  
  // Calculate overall PnL
  const withPnl = results.filter(r => r.pnl !== null);
  const totalInvested = withPnl.reduce((s, r) => s + r.entry_price * (r.exit_price ? 1 : 0), 0);
  const totalPnl = withPnl.reduce((s, r) => s + (r.pnl || 0), 0);
  const avgPnl = withPnl.length > 0 ? totalPnl / withPnl.length : 0;
  
  console.log(`\nActual PnL (avg): ${avgPnl.toFixed(2)}%`);
  
  // Simulated PnL with TP/SL
  const withSim = results.filter(r => r.sim_pnl !== null);
  const simTotal = withSim.reduce((s, r) => s + r.sim_pnl, 0);
  const simAvg = withSim.length > 0 ? simTotal / withSim.length : 0;
  
  console.log(`Sim PnL with TP/SL (avg): ${simAvg.toFixed(2)}%`);
  console.log(`\nDifference: ${(simAvg - avgPnl).toFixed(2)}%`);
  
  // Show TP hits
  const tpTrades = results.filter(r => r.hit_tp);
  if (tpTrades.length > 0) {
    console.log(`\n=== TP Hits (${tpTrades.length}) ===`);
    for (const r of tpTrades) {
      console.log(`  ${r.symbol} | entry: ${r.entry_price} | max: ${r.max_during?.toFixed(6)} | actual: ${r.pnl?.toFixed(2)}%`);
    }
  }
  
  // Show SL hits
  const slTrades = results.filter(r => r.hit_sl);
  if (slTrades.length > 0) {
    console.log(`\n=== SL Hits (${slTrades.length}) ===`);
    for (const r of slTrades) {
      console.log(`  ${r.symbol} | entry: ${r.entry_price} | min: ${r.min_during?.toFixed(6)} | actual: ${r.pnl?.toFixed(2)}%`);
    }
  }
  
  // Show no data tokens
  const noDataTokens = results.filter(r => r.data_quality !== 'real');
  if (noDataTokens.length > 0) {
    console.log(`\n=== No Data (${noDataTokens.length}) ===`);
    for (const r of noDataTokens) {
      console.log(`  ${r.symbol} | ${r.data_quality} | ${r.contract_address.substring(0, 20)}...`);
    }
  }
}

main().catch(console.error);
