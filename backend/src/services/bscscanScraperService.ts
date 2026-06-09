// BscScan 链上数据抓取服务
// 通过桌面自动化工作台 (HAS:9223) 打开 BscScan 页面，从 iframe 提取结构化数据
// 不依赖 API Key，使用真实浏览器环境
// 支持数据库持久化 + 增量同步

import { db } from '../db/database';

const HAS_BASE = 'http://127.0.0.1:9223';
const BSCSCAN_BASE = 'https://bscscan.com';
const CHAIN_DATA_TAB_ID = 'tab-1780921639939-2';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

// ============ HAS 通信 ============

async function hasExecute(tabId: string, script: string): Promise<any> {
  const resp = await fetch(`${HAS_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabId, script }),
  });
  if (!resp.ok) throw new Error(`HAS execute failed: HTTP ${resp.status}`);
  const data: any = await resp.json();
  if (!data.success) throw new Error(`HAS error: ${data.error || JSON.stringify(data)}`);
  return data.result ? JSON.parse(data.result) : null;
}

async function navigateTo(tabId: string, url: string, waitMs: number = 5000): Promise<void> {
  const resp = await fetch(`${HAS_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabId, script: `window.location.href='${url}'` }),
  });
  await new Promise(r => setTimeout(r, waitMs));
}

async function waitForTable(tabId: string, maxWait: number = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const result = await hasExecute(tabId, `(function(){
        var iframe=document.querySelector('#tokentxnsiframe');
        if(!iframe) return JSON.stringify({ready:false});
        var doc=iframe.contentDocument;
        if(!doc) return JSON.stringify({ready:false});
        var rows=doc.querySelectorAll('table tbody tr');
        return JSON.stringify({ready:rows.length>0,count:rows.length});
      })()`);
      if (result?.ready) return true;
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function goToPage(tabId: string, page: number): Promise<void> {
  await fetch(`${HAS_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabId, script: `(function(){ var iframe=document.querySelector('#tokentxnsiframe'); if(!iframe) return; iframe.src=iframe.src.replace(/&p=[0-9]+/,'&p=${page}'); })()` }),
  });
  await new Promise(r => setTimeout(r, 3000));
}

async function getTotalPages(tabId: string): Promise<number> {
  const result = await hasExecute(tabId, `(function(){
    var iframe=document.querySelector('#tokentxnsiframe');
    if(!iframe) return JSON.stringify({total:0});
    var doc=iframe.contentDocument;
    if(!doc) return JSON.stringify({total:0});
    var text=doc.body?.innerText||'';
    var m=text.match(/Page\\s+[0-9]+\\s+of\\s+([0-9,]+)/i);
    return JSON.stringify({total:m?parseInt(m[1].replace(/,/g,'')):0});
  })()`);
  return result?.total || 0;
}

// 从 iframe 提取当前页的交易记录
async function extractTransactions(tabId: string): Promise<any[]> {
  const data = await hasExecute(tabId, `(function(){
    var iframe=document.querySelector('#tokentxnsiframe');
    if(!iframe) return JSON.stringify({transactions:[]});
    var doc=iframe.contentDocument;
    var rows=doc.querySelectorAll('table tbody tr');
    var result=[...rows].map(function(r){
      var c=r.querySelectorAll('td');
      return {
        hash: c[1]?.querySelector('a')?.innerText?.trim() || c[1]?.innerText?.trim() || '',
        method: c[2]?.innerText?.trim() || '',
        block: c[4]?.innerText?.trim() || '',
        timestamp: c[5]?.innerText?.trim() || '',
        age: c[6]?.innerText?.trim() || '',
        from: c[8]?.innerText?.trim() || '',
        to: c[10]?.innerText?.trim() || '',
        amount: c[11]?.innerText?.trim() || '',
      };
    });
    return JSON.stringify({transactions:result});
  })()`);
  return data?.transactions || [];
}

// ============ 数据库操作 ============

// 插入交易记录（INSERT OR IGNORE 去重）
function insertTransactions(chain: string, contractAddress: string, txs: any[]): number {
  const stmt = db.prepare(`INSERT OR IGNORE INTO onchain_transactions
    (chain, contract_address, tx_hash, method, block_number, timestamp, from_address, to_address, amount, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'bscscan_scrape')`) as SqliteStatement;
  let inserted = 0;
  for (const tx of txs) {
    const blockNum = parseInt(tx.block) || 0;
    const result = stmt.run(chain, contractAddress, tx.hash, tx.method, blockNum, tx.timestamp, tx.from, tx.to, tx.amount);
    inserted += result.changes;
  }
  return inserted;
}

// 查询数据库中的交易记录（支持分页）
function queryTransactions(chain: string, contractAddress: string, page: number = 1, limit: number = 25): any {
  const offset = (page - 1) * limit;
  const countRow = (db.prepare(`SELECT COUNT(*) as total FROM onchain_transactions WHERE chain = ? AND contract_address = ?`) as SqliteStatement).get(chain, contractAddress);
  const total = countRow?.total || 0;
  const rows = (db.prepare(`SELECT * FROM onchain_transactions WHERE chain = ? AND contract_address = ? ORDER BY block_number DESC, id DESC LIMIT ? OFFSET ?`) as SqliteStatement).all(chain, contractAddress, limit, offset);
  return {
    transactions: rows,
    total: total,
    page: page,
    limit: limit,
    total_pages: Math.ceil(total / limit),
  };
}

// 获取数据库中该合约最新的 block_number
function getLatestBlockNumber(chain: string, contractAddress: string): number {
  const row = (db.prepare(`SELECT MAX(block_number) as max_block FROM onchain_transactions WHERE chain = ? AND contract_address = ?`) as SqliteStatement).get(chain, contractAddress);
  return row?.max_block || 0;
}

// ============ 公开接口 ============

// 获取代币交易记录（先查数据库，后台增量同步）
export async function getTokenTransfers(contractAddress: string, page: number = 1, limit: number = 25): Promise<any> {
  // 1. 先查数据库
  const dbResult = queryTransactions('bsc', contractAddress, page, limit);

  // 2. 如果数据库无记录，触发初始抓取（5 页）
  if (dbResult.total === 0) {
    // 异步执行初始抓取，不阻塞响应
    initialScrape(contractAddress).catch(err => {
      console.error(`[BscScan] Initial scrape failed for ${contractAddress}:`, err.message);
    });
    return {
      contract: contractAddress,
      chain: 'bsc',
      source: 'db',
      ...dbResult,
      sync_status: 'initial_scraping',
    };
  }

  // 3. 后台增量同步（不阻塞响应）
  incrementalSync(contractAddress).catch(err => {
    console.error(`[BscScan] Incremental sync failed for ${contractAddress}:`, err.message);
  });

  return {
    contract: contractAddress,
    chain: 'bsc',
    source: 'db',
    ...dbResult,
    sync_status: 'syncing',
  };
}

// 初始抓取（5 页 = 125 条）
async function initialScrape(contractAddress: string): Promise<void> {
  console.log(`[BscScan] Initial scrape for ${contractAddress}...`);
  const url = `${BSCSCAN_BASE}/token/${contractAddress}#transactions`;
  await navigateTo(CHAIN_DATA_TAB_ID, url);
  const ready = await waitForTable(CHAIN_DATA_TAB_ID);
  if (!ready) {
    console.error(`[BscScan] Table not loaded for ${contractAddress}`);
    return;
  }

  let totalInserted = 0;
  for (let p = 1; p <= 5; p++) {
    if (p > 1) {
      await goToPage(CHAIN_DATA_TAB_ID, p);
    }
    const txs = await extractTransactions(CHAIN_DATA_TAB_ID);
    if (txs.length === 0) break;
    const inserted = insertTransactions('bsc', contractAddress, txs);
    totalInserted += inserted;
    console.log(`[BscScan] Page ${p}: ${txs.length} rows, ${inserted} new inserted`);
  }
  console.log(`[BscScan] Initial scrape done: ${totalInserted} records inserted for ${contractAddress}`);
}

// 增量同步（抓取比数据库最新 block 更新的记录）
async function incrementalSync(contractAddress: string): Promise<void> {
  const latestBlock = getLatestBlockNumber('bsc', contractAddress);
  if (latestBlock === 0) return; // 无记录，不触发同步

  console.log(`[BscScan] Incremental sync for ${contractAddress} from block ${latestBlock}...`);
  const url = `${BSCSCAN_BASE}/token/${contractAddress}#transactions`;
  await navigateTo(CHAIN_DATA_TAB_ID, url);
  const ready = await waitForTable(CHAIN_DATA_TAB_ID);
  if (!ready) return;

  // 只抓取第 1 页（最新记录）
  const txs = await extractTransactions(CHAIN_DATA_TAB_ID);
  let newCount = 0;
  for (const tx of txs) {
    const blockNum = parseInt(tx.block) || 0;
    if (blockNum > latestBlock) {
      const inserted = insertTransactions('bsc', contractAddress, [tx]);
      newCount += inserted;
    }
  }
  if (newCount > 0) {
    console.log(`[BscScan] Incremental sync: ${newCount} new records for ${contractAddress}`);
  }
}

// 手动触发抓取（供 API 调用）
export async function scrapePages(contractAddress: string, pages: number = 5, order: string = 'asc'): Promise<any> {
  const url = `${BSCSCAN_BASE}/token/${contractAddress}#transactions`;
  await navigateTo(CHAIN_DATA_TAB_ID, url);
  const ready = await waitForTable(CHAIN_DATA_TAB_ID);
  if (!ready) return { error: 'Table not loaded' };

  // 获取总页数
  const totalPages = await getTotalPages(CHAIN_DATA_TAB_ID);
  const actualPages = Math.min(pages, totalPages);

  // 倒序抓取：从最后一页开始
  const startPage = order === 'desc' ? totalPages : 1;
  const endPage = order === 'desc' ? Math.max(1, totalPages - pages + 1) : actualPages;
  const step = order === 'desc' ? -1 : 1;

  let totalInserted = 0;
  const results = [];
  let p = startPage;
  while (order === 'desc' ? p >= endPage : p <= endPage) {
    if (p === startPage) {
      // 第一页需要导航
      await goToPage(CHAIN_DATA_TAB_ID, p);
    } else {
      await goToPage(CHAIN_DATA_TAB_ID, p);
    }
    const txs = await extractTransactions(CHAIN_DATA_TAB_ID);
    if (txs.length === 0) { p += step; continue; }
    const inserted = insertTransactions('bsc', contractAddress, txs);
    totalInserted += inserted;
    results.push({ page: p, rows: txs.length, inserted });
    console.log(`[BscScan] Page ${p}/${totalPages}: ${txs.length} rows, ${inserted} new`);
    p += step;
    // 间隔 3-5 秒避免限流
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
  }

  const dbResult = queryTransactions('bsc', contractAddress, 1, 25);
  return {
    contract: contractAddress,
    order: order,
    total_pages: totalPages,
    scraped_pages: results.length,
    total_inserted: totalInserted,
    page_results: results,
    db_total: dbResult.total,
  };
}

// 获取代币基本信息
export async function getTokenInfo(contractAddress: string): Promise<any> {
  const url = `${BSCSCAN_BASE}/token/${contractAddress}`;
  await navigateTo(CHAIN_DATA_TAB_ID, url);
  await new Promise(r => setTimeout(r, 3000));

  const data = await hasExecute(CHAIN_DATA_TAB_ID, `(function(){
    var holderText = document.body.innerText;
    var holderMatch = holderText.match(/holders[:\\s]*([\\d,]+)/i);
    var supplyMatch = holderText.match(/total\\s*supply[:\\s]*([\\d,.]+)/i);
    var overviewCards = document.querySelectorAll('.card .row .col');
    var overview = {};
    overviewCards.forEach(function(card) {
      var label = card.querySelector('.text-muted, small')?.innerText?.trim();
      var value = card.querySelector('.fw-medium, .fs-5, h6')?.innerText?.trim();
      if(label && value) overview[label] = value;
    });
    var title = document.querySelector('h1, .card-header h4')?.innerText?.trim() || '';
    return JSON.stringify({
      name: title,
      holder_count: holderMatch ? holderMatch[1] : null,
      total_supply: supplyMatch ? supplyMatch[1] : null,
      overview: overview,
    });
  })()`);

  return { contract: contractAddress, chain: 'bsc', source: 'bscscan_scrape', ...data };
}

// 获取持有人数据
export async function getHolders(contractAddress: string): Promise<any> {
  const url = `${BSCSCAN_BASE}/token/${contractAddress}#balances`;
  await navigateTo(CHAIN_DATA_TAB_ID, url);
  await new Promise(r => setTimeout(r, 6000));

  const data = await hasExecute(CHAIN_DATA_TAB_ID, `(function(){
    var iframe=document.querySelector('#tokentxnsiframe');
    if(!iframe) return JSON.stringify({error:'iframe not found'});
    var doc=iframe.contentDocument;
    var rows=doc.querySelectorAll('table tbody tr');
    var holders=[...rows].map(function(r){
      var c=r.querySelectorAll('td');
      return {
        rank: c[0]?.innerText?.trim() || '',
        address: c[1]?.innerText?.trim() || '',
        quantity: c[2]?.innerText?.trim() || '',
        percentage: c[3]?.innerText?.trim() || '',
      };
    });
    return JSON.stringify({count:holders.length,holders:holders});
  })()`);

  return { contract: contractAddress, chain: 'bsc', source: 'bscscan_scrape', ...data };
}

// 检查 HAS 连接状态
export async function checkHASConnection(): Promise<any> {
  try {
    const resp = await fetch(`${HAS_BASE}/tabs`);
    if (!resp.ok) return { connected: false, error: `HTTP ${resp.status}` };
    const data: any = await resp.json();
    const chainTab = data.tabs?.find((t: any) => t.id === CHAIN_DATA_TAB_ID);
    return {
      connected: true,
      has_tabs: data.tabs?.length || 0,
      chain_data_tab: chainTab ? { id: chainTab.id, url: chainTab.url, status: chainTab.status } : null,
    };
  } catch (err: any) {
    return { connected: false, error: err.message };
  }
}

// 查询数据库统计
export function getDBStats(contractAddress: string): any {
  const total = (db.prepare(`SELECT COUNT(*) as c FROM onchain_transactions WHERE chain='bsc' AND contract_address=?`) as SqliteStatement).get(contractAddress);
  const latest = (db.prepare(`SELECT MAX(block_number) as max_block, MIN(block_number) as min_block FROM onchain_transactions WHERE chain='bsc' AND contract_address=?`) as SqliteStatement).get(contractAddress);
  return {
    contract: contractAddress,
    total_records: total?.c || 0,
    latest_block: latest?.max_block || 0,
    oldest_block: latest?.min_block || 0,
  };
}
