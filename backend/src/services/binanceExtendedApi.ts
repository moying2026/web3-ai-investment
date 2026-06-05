// 币安 Web3 API 扩展数据采集服务
// 包含：合约安全审计、代币动态信息、Smart Money 信号、社交热度、创建者钱包分析

import { db } from '../db/database';

const { fetch: undiciFetch, ProxyAgent } = require('undici');
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
let dispatcher: any = undefined;
if (PROXY_URL) {
  dispatcher = new ProxyAgent(PROXY_URL);
}

const BASE_URL = 'https://web3.binance.com';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

// 请求节流
let lastRequestTime = 0;
async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
  lastRequestTime = Date.now();
}

// ============ 1. 合约安全审计 ============

interface AuditData {
  riskLevel: number;
  riskLevelEnum: string;
  buyTax: string;
  sellTax: string;
  unusualBuyTax: boolean;
  unusualSellTax: boolean;
  isVerified: boolean | null;
  riskItems: Array<{
    id: string;
    name: string;
    details: Array<{ title: string; isHit: boolean; riskType: string }>;
  }>;
}

export async function fetchTokenAudit(chainId: string, contractAddress: string): Promise<AuditData | null> {
  await throttle();
  try {
    const resp = await undiciFetch(`${BASE_URL}/bapi/defi/v1/public/wallet-direct/security/token/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ binanceChainId: chainId, contractAddress, requestId: `audit-${Date.now()}` }),
      dispatcher,
    }).then((r: any) => r.json());

    if (resp.code !== '000000' || !resp.data) return null;
    const d = resp.data;
    return {
      riskLevel: d.riskLevel || 0,
      riskLevelEnum: d.riskLevelEnum || 'UNKNOWN',
      buyTax: d.extraInfo?.buyTax || '0',
      sellTax: d.extraInfo?.sellTax || '0',
      unusualBuyTax: d.extraInfo?.unusualBuyTax || false,
      unusualSellTax: d.extraInfo?.unusualSellTax || false,
      isVerified: d.extraInfo?.isVerified,
      riskItems: d.riskItems || [],
    };
  } catch { return null; }
}

// ============ 2. 代币实时动态信息 ============

interface TokenDynamicInfo {
  price: string;
  marketCap: string;
  holders: number;
  liquidity: string;
  volume24h: string;
  smartMoneyHolders: number;
  smartMoneyHoldingPercent: number;
  devHoldingPercent: number;
  top10HoldersPercentage: number;
  priceHigh24h: string;
  priceLow24h: string;
}

export async function fetchTokenDynamicInfo(chainId: string, contractAddress: string): Promise<TokenDynamicInfo | null> {
  await throttle();
  try {
    const resp = await undiciFetch(`${BASE_URL}/bapi/defi/v4/public/wallet-direct/buw/wallet/market/token/dynamic/info/ai?chainId=${chainId}&contractAddress=${contractAddress}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      dispatcher,
    }).then((r: any) => r.json());

    if (resp.code !== '000000' || !resp.data) return null;
    const d = resp.data;
    return {
      price: d.price || '0',
      marketCap: d.marketCap || '0',
      holders: d.holders || 0,
      liquidity: d.liquidity || '0',
      volume24h: d.volume24h || '0',
      smartMoneyHolders: d.smartMoneyHolders || 0,
      smartMoneyHoldingPercent: d.smartMoneyHoldingPercent || 0,
      devHoldingPercent: d.devHoldingPercent || 0,
      top10HoldersPercentage: d.top10HoldersPercentage || 0,
      priceHigh24h: d.priceHigh24h || '0',
      priceLow24h: d.priceLow24h || '0',
    };
  } catch { return null; }
}

// ============ 3. Smart Money 信号 ============

interface SmartMoneySignal {
  signalId: number;
  ticker: string;
  chainId: string;
  contractAddress: string;
  direction: string;
  smartMoneyCount: number;
  alertPrice: string;
  currentPrice: string;
  signalTriggerTime: number;
  status: string;
}

export async function fetchSmartMoneySignals(chainId: string = '56', pageSize: number = 20): Promise<SmartMoneySignal[]> {
  await throttle();
  try {
    const resp = await undiciFetch(`${BASE_URL}/bapi/defi/v1/public/wallet-direct/buw/wallet/web/signal/smart-money/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId, page: 1, pageSize }),
      dispatcher,
    }).then((r: any) => r.json());

    if (resp.code !== '000000' || !Array.isArray(resp.data)) return [];
    return resp.data.map((s: any) => ({
      signalId: s.signalId,
      ticker: s.ticker,
      chainId: s.chainId,
      contractAddress: s.contractAddress,
      direction: s.direction,
      smartMoneyCount: s.smartMoneyCount,
      alertPrice: s.alertPrice,
      currentPrice: s.currentPrice,
      signalTriggerTime: s.signalTriggerTime,
      status: s.status,
    }));
  } catch { return []; }
}

// ============ 4. 社交热度排行 ============

interface SocialHypeItem {
  chainId: string;
  contractAddress: string;
  symbol: string;
  hypeScore: number;
  mentionCount: number;
  sentimentScore: number;
}

export async function fetchSocialHypeRank(chainId: string = '56'): Promise<SocialHypeItem[]> {
  await throttle();
  try {
    const resp = await undiciFetch(`${BASE_URL}/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/social/hype/rank/leaderboard/ai?chainId=${chainId}&sentiment=all&timeRange=24h`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      dispatcher,
    }).then((r: any) => r.json());

    if (resp.code !== '000000' || !Array.isArray(resp.data)) return [];
    return resp.data.map((item: any) => ({
      chainId: item.chainId || chainId,
      contractAddress: item.contractAddress || '',
      symbol: item.symbol || item.ticker || '',
      hypeScore: item.hypeScore || item.score || 0,
      mentionCount: item.mentionCount || 0,
      sentimentScore: item.sentimentScore || 0,
    }));
  } catch { return []; }
}

// ============ 5. 创建者钱包分析 ============

interface CreatorPnlData {
  address: string;
  chainId: string;
  totalPnl: string;
  totalPnlPercent: number;
  activePositions: number;
  winRate: number;
}

export async function fetchCreatorPnl(address: string, chainId: string = '56'): Promise<CreatorPnlData | null> {
  await throttle();
  try {
    const resp = await undiciFetch(`${BASE_URL}/bapi/defi/v3/public/wallet-direct/buw/wallet/address/pnl/active-position-list/ai?address=${address}&chainId=${chainId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      dispatcher,
    }).then((r: any) => r.json());

    if (resp.code !== '000000' || !resp.data) return null;
    const d = resp.data;
    return {
      address,
      chainId,
      totalPnl: d.totalPnl || '0',
      totalPnlPercent: d.totalPnlPercent || 0,
      activePositions: d.activePositions || d.positionList?.length || 0,
      winRate: d.winRate || 0,
    };
  } catch { return null; }
}

// ============ 数据库操作 ============

// 创建扩展表
export function initExtendedTables(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS smart_money_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER UNIQUE,
    chain_id TEXT,
    contract_address TEXT,
    ticker TEXT,
    direction TEXT,
    smart_money_count INTEGER,
    alert_price TEXT,
    current_price TEXT,
    signal_trigger_time INTEGER,
    status TEXT,
    fetched_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS token_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    risk_level INTEGER,
    risk_level_enum TEXT,
    buy_tax TEXT,
    sell_tax TEXT,
    unusual_buy_tax INTEGER,
    unusual_sell_tax INTEGER,
    is_verified INTEGER,
    risk_items TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE(chain_id, contract_address)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS token_dynamic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    price TEXT,
    market_cap TEXT,
    holders INTEGER,
    liquidity TEXT,
    volume_24h TEXT,
    smart_money_holders INTEGER,
    smart_money_holding_percent REAL,
    dev_holding_percent REAL,
    top10_holders_percent REAL,
    price_high_24h TEXT,
    price_low_24h TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE(chain_id, contract_address)
  )`);

  console.log('[Extended] 扩展表初始化完成');
}

// 存储审计数据
export function storeAuditData(chainId: string, contractAddress: string, data: AuditData): void {
  (db.prepare(`INSERT OR REPLACE INTO token_audit (
    chain_id, contract_address, risk_level, risk_level_enum,
    buy_tax, sell_tax, unusual_buy_tax, unusual_sell_tax, is_verified, risk_items, fetched_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`) as SqliteStatement).run(
    chainId, contractAddress, data.riskLevel, data.riskLevelEnum,
    data.buyTax, data.sellTax, data.unusualBuyTax ? 1 : 0, data.unusualSellTax ? 1 : 0,
    data.isVerified === null ? null : (data.isVerified ? 1 : 0),
    JSON.stringify(data.riskItems)
  );
}

// 存储动态信息
export function storeDynamicInfo(chainId: string, contractAddress: string, data: TokenDynamicInfo): void {
  (db.prepare(`INSERT OR REPLACE INTO token_dynamic (
    chain_id, contract_address, price, market_cap, holders, liquidity, volume_24h,
    smart_money_holders, smart_money_holding_percent, dev_holding_percent,
    top10_holders_percent, price_high_24h, price_low_24h, fetched_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`) as SqliteStatement).run(
    chainId, contractAddress, data.price, data.marketCap, data.holders, data.liquidity,
    data.volume24h, data.smartMoneyHolders, data.smartMoneyHoldingPercent,
    data.devHoldingPercent, data.top10HoldersPercentage, data.priceHigh24h, data.priceLow24h
  );
}

// 存储 Smart Money 信号
export function storeSmartMoneySignals(signals: SmartMoneySignal[]): number {
  let count = 0;
  const stmt = db.prepare(`INSERT OR IGNORE INTO smart_money_signals (
    signal_id, chain_id, contract_address, ticker, direction, smart_money_count,
    alert_price, current_price, signal_trigger_time, status, fetched_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`) as SqliteStatement;

  for (const s of signals) {
    try {
      stmt.run(s.signalId, s.chainId, s.contractAddress, s.ticker, s.direction,
        s.smartMoneyCount, s.alertPrice, s.currentPrice, s.signalTriggerTime, s.status);
      count++;
    } catch { /* ignore duplicates */ }
  }
  return count;
}

// ============ 批量采集逻辑 ============

// 采集审计数据（限流：每轮最多 5 个代币）
export async function fetchBatchAuditData(): Promise<void> {
  const tokens = (db.prepare(`
    SELECT t.chain_id, t.contract_address, t.symbol
    FROM tokens t
    LEFT JOIN token_audit ta ON t.chain_id = ta.chain_id AND t.contract_address = ta.contract_address
    WHERE ta.chain_id IS NULL
    ORDER BY t.first_seen_at DESC LIMIT 5
  `) as SqliteStatement).all() as any[];

  if (tokens.length === 0) return;
  console.log(`[Extended] 需要采集审计数据: ${tokens.length} 个代币`);

  for (const token of tokens) {
    const data = await fetchTokenAudit(token.chain_id, token.contract_address);
    if (data) {
      storeAuditData(token.chain_id, token.contract_address, data);
      console.log(`[Extended] ${token.symbol}: risk=${data.riskLevelEnum} buyTax=${data.buyTax} sellTax=${data.sellTax}`);
    }
  }
}

// 采集动态信息（限流：每轮最多 10 个代币）
export async function fetchBatchDynamicInfo(): Promise<void> {
  const tokens = (db.prepare(`
    SELECT t.chain_id, t.contract_address, t.symbol
    FROM tokens t
    LEFT JOIN token_dynamic td ON t.chain_id = td.chain_id AND t.contract_address = td.contract_address
    WHERE td.chain_id IS NULL
    ORDER BY t.first_seen_at DESC LIMIT 10
  `) as SqliteStatement).all() as any[];

  if (tokens.length === 0) return;
  console.log(`[Extended] 需要采集动态信息: ${tokens.length} 个代币`);

  for (const token of tokens) {
    const data = await fetchTokenDynamicInfo(token.chain_id, token.contract_address);
    if (data) {
      storeDynamicInfo(token.chain_id, token.contract_address, data);
      console.log(`[Extended] ${token.symbol}: price=${data.price} smartMoney=${data.smartMoneyHolders}`);
    }
  }
}

// 采集 Smart Money 信号
export async function fetchBatchSmartMoneySignals(): Promise<void> {
  const signals = await fetchSmartMoneySignals('56', 20);
  if (signals.length === 0) return;
  const count = storeSmartMoneySignals(signals);
  if (count > 0) console.log(`[Extended] 存储 ${count} 条 Smart Money 信号`);
}

// 统一入口：批量采集扩展数据
export async function fetchExtendedData(): Promise<void> {
  await fetchBatchAuditData();
  await fetchBatchDynamicInfo();
  await fetchBatchSmartMoneySignals();
}
