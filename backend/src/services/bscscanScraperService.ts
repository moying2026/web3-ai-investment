// BscScan 链上数据抓取服务
// 通过桌面自动化工作台 (HAS:9223) 打开 BscScan 页面，从 iframe 提取结构化数据
// 不依赖 API Key，使用真实浏览器环境

import { db } from '../db/database';

const HAS_BASE = 'http://127.0.0.1:9223';
const BSCSCAN_BASE = 'https://bscscan.com';

// 链上数据 tab ID（桌面自动化工作台中预设的 tab）
const CHAIN_DATA_TAB_ID = 'tab-1780921639939-2';

// 通用 HAS execute 调用
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

// 导航到指定页面并等待加载
async function navigateTo(tabId: string, url: string): Promise<void> {
  const resp = await fetch(`${HAS_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tabId,
      script: `(function(){ window.location.href='${url}'; return 'navigating'; })()`,
    }),
  });
  // 等待页面加载
  await new Promise(r => setTimeout(r, 5000));
}

// 等待 iframe 内表格加载完成
async function waitForTable(tabId: string, maxWait: number = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const result = await hasExecute(tabId, `(function(){
        const iframe=document.querySelector('#tokentxnsiframe');
        if(!iframe) return JSON.stringify({ready:false,reason:'no_iframe'});
        const doc=iframe.contentDocument;
        if(!doc) return JSON.stringify({ready:false,reason:'no_doc'});
        const rows=doc.querySelectorAll('table tbody tr');
        return JSON.stringify({ready:rows.length>0,count:rows.length});
      })()`);
      if (result?.ready) return true;
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

// 解析交易记录行
function parseTransactionRows(rows: any[]): any[] {
  return rows.map(r => ({
    tx_hash: r.hash || '',
    method: r.method || '',
    block: r.block || '',
    timestamp: r.timestamp || '',
    age: r.age || '',
    from: r.from || '',
    to: r.to || '',
    amount: r.amount || '',
  }));
}

// ============ 公开接口 ============

// 获取代币交易记录
export async function getTokenTransfers(contractAddress: string, page: number = 1): Promise<any> {
  const url = `${BSCSCAN_BASE}/token/${contractAddress}#transactions`;

  // 导航到目标页面
  await navigateTo(CHAIN_DATA_TAB_ID, url);

  // 等待表格加载
  const ready = await waitForTable(CHAIN_DATA_TAB_ID);
  if (!ready) {
    return { error: 'Table not loaded after waiting', contract: contractAddress };
  }

  // 提取表格数据
  const data = await hasExecute(CHAIN_DATA_TAB_ID, `(function(){
    const iframe=document.querySelector('#tokentxnsiframe');
    if(!iframe) return JSON.stringify({error:'iframe not found'});
    const doc=iframe.contentDocument;
    const rows=doc.querySelectorAll('table tbody tr');
    const result=[...rows].map(r=>{
      const c=r.querySelectorAll('td');
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
    return JSON.stringify({count:result.length,transactions:result});
  })()`);

  return {
    contract: contractAddress,
    chain: 'bsc',
    source: 'bscscan_scrape',
    ...data,
  };
}

// 获取代币基本信息
export async function getTokenInfo(contractAddress: string): Promise<any> {
  const url = `${BSCSCAN_BASE}/token/${contractAddress}`;
  await navigateTo(CHAIN_DATA_TAB_ID, url);
  await new Promise(r => setTimeout(r, 3000));

  const data = await hasExecute(CHAIN_DATA_TAB_ID, `(function(){
    // 从页面提取代币基本信息
    const title = document.querySelector('.card-header h4, .text-muted.mb-1')?.innerText || '';
    // 代币名称和符号通常在页面标题区域
    const nameEl = document.querySelector('.hash-tag.text-truncate');
    // 持有人数
    const holderText = document.body.innerText;
    const holderMatch = holderText.match(/holders[:\\s]*([\\d,]+)/i);
    // 总供应量
    const supplyMatch = holderText.match(/total\\s*supply[:\\s]*([\\d,.]+)/i);

    // 从页面顶部提取代币概览信息
    const overviewCards = document.querySelectorAll('.card .row .col');
    const overview = {};
    overviewCards.forEach(card => {
      const label = card.querySelector('.text-muted, small')?.innerText?.trim();
      const value = card.querySelector('.fw-medium, .fs-5, h6')?.innerText?.trim();
      if(label && value) overview[label] = value;
    });

    return JSON.stringify({
      name: title,
      holder_count: holderMatch ? holderMatch[1] : null,
      total_supply: supplyMatch ? supplyMatch[1] : null,
      overview: overview,
    });
  })()`);

  return {
    contract: contractAddress,
    chain: 'bsc',
    source: 'bscscan_scrape',
    ...data,
  };
}

// 获取持有人数据
export async function getHolders(contractAddress: string): Promise<any> {
  const url = `${BSCSCAN_BASE}/token/${contractAddress}#balances`;
  await navigateTo(CHAIN_DATA_TAB_ID, url);

  // 等待表格加载（balances tab 可能需要额外时间）
  await new Promise(r => setTimeout(r, 6000));

  const data = await hasExecute(CHAIN_DATA_TAB_ID, `(function(){
    const iframe=document.querySelector('#tokentxnsiframe');
    if(!iframe) return JSON.stringify({error:'iframe not found'});
    const doc=iframe.contentDocument;
    const rows=doc.querySelectorAll('table tbody tr');
    const holders=[...rows].map(r=>{
      const c=r.querySelectorAll('td');
      return {
        rank: c[0]?.innerText?.trim() || '',
        address: c[1]?.innerText?.trim() || '',
        quantity: c[2]?.innerText?.trim() || '',
        percentage: c[3]?.innerText?.trim() || '',
      };
    });
    return JSON.stringify({count:holders.length,holders:holders});
  })()`);

  return {
    contract: contractAddress,
    chain: 'bsc',
    source: 'bscscan_scrape',
    ...data,
  };
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
      chain_data_tab: chainTab ? {
        id: chainTab.id,
        url: chainTab.url,
        status: chainTab.status,
      } : null,
    };
  } catch (err: any) {
    return { connected: false, error: err.message };
  }
}
