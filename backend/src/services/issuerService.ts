// 发行方历史代币数据采集服务
// 数据源：Binance Web3 API /bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/dev/created/tokens/info

import { db } from '../db/database';

const { fetch: undiciFetch, ProxyAgent } = require('undici');
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
let dispatcher: any = undefined;
if (PROXY_URL) {
  dispatcher = new ProxyAgent(PROXY_URL);
}

const BASE_URL = 'https://www.binance.com';
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 小时

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

// 发行方历史代币 API 响应
interface IssuerTokenInfo {
  contractAddress: string;
  name: string;
  symbol: string;
  chainId: string;
  marketCap: string;
  athMc: string;
  liquidity: string;
  holderCount: number;
  createTime: number;
  migrated?: boolean;
  migrationPlatform?: string;
}

interface IssuerSummary {
  totalCount: number;
  innerCount: number;
  openCount: number;
  athMc: string;
  newsestTime: number;
  athMcToken: {
    chainId: string;
    contractAddress: string;
    symbol: string;
    name: string;
    icon: string;
  };
}

interface IssuerData {
  tokenList: IssuerTokenInfo[];
  summary: IssuerSummary;
  nativeTokenBalance: string;
  firstReceipt: {
    fundingHash: string;
    fundingFromAddress: string;
    fundingAmount: string;
    fundingTime: number;
  };
}

// 调用发行方历史代币 API
async function fetchIssuerHistory(chainId: string, creatorAddress: string): Promise<IssuerData | null> {
  try {
    const url = `${BASE_URL}/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/dev/created/tokens/info?chainId=${chainId}&creatorAddress=${creatorAddress}`;
    const resp = await undiciFetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      dispatcher,
    }).then((r: any) => r.json());

    if (resp.code === '000000' && resp.success && resp.data) {
      return resp.data;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// 存储发行方历史代币数据
function storeIssuerTokens(creatorAddress: string, chainId: string, data: IssuerData): void {
  const summary = data.summary;
  const now = new Date().toISOString();

  // 更新 issuer_profiles 表
  const migrationRate = summary.totalCount > 0 ? summary.innerCount / summary.totalCount : 0;

  (db.prepare(`
    INSERT OR REPLACE INTO issuer_profiles (
      issuer_address, total_tokens, alive_tokens, dead_tokens,
      survival_rate, first_seen_at, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `) as SqliteStatement).run(
    creatorAddress,
    summary.totalCount || 0,
    summary.innerCount || 0,
    summary.openCount || 0,
    migrationRate,
    data.firstReceipt?.fundingTime ? new Date(data.firstReceipt.fundingTime).toISOString() : now,
    summary.newsestTime ? new Date(summary.newsestTime).toISOString() : now
  );

  // 存储发行方历史代币到 issuer_tokens 表
  (db.prepare(`
    CREATE TABLE IF NOT EXISTS issuer_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issuer_address TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      market_cap TEXT,
      ath_market_cap TEXT,
      liquidity TEXT,
      holder_count INTEGER,
      create_time INTEGER,
      migrated INTEGER DEFAULT 0,
      migration_platform TEXT,
      fetched_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(issuer_address, contract_address)
    )
  `) as SqliteStatement).run();

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO issuer_tokens (
      issuer_address, chain_id, contract_address, name, symbol,
      market_cap, ath_market_cap, liquidity, holder_count,
      create_time, migrated, migration_platform, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) as SqliteStatement;

  let count = 0;
  for (const token of data.tokenList) {
    insertStmt.run(
      creatorAddress,
      token.chainId || chainId,
      token.contractAddress,
      token.name || '',
      token.symbol || '',
      String(token.marketCap || '0'),
      String(token.athMc || '0'),
      String(token.liquidity || '0'),
      Math.floor(Number(token.holderCount || 0)),
      token.createTime || 0,
      token.migrated ? 1 : 0,
      token.migrationPlatform || null,
      now
    );
    count++;
  }

  console.log(`[Issuer] ${creatorAddress.substring(0, 12)}... | total: ${summary.totalCount} | migrated: ${summary.innerCount} | stored: ${count} tokens`);
}

// 采集单个发行方的历史数据
export async function fetchSingleIssuerData(chainId: string, creatorAddress: string): Promise<boolean> {
  if (!creatorAddress) return false;

  const data = await fetchIssuerHistory(chainId, creatorAddress);
  if (!data) return false;

  storeIssuerTokens(creatorAddress, chainId, data);
  return true;
}

// 批量采集发行方数据（首次入库或超过 24 小时未同步）
export async function fetchIssuerData(): Promise<void> {
  const threshold = new Date(Date.now() - SYNC_INTERVAL_MS).toISOString();

  // 获取需要同步的发行方（首次或超过 24 小时）
  const issuers = (db.prepare(`
    SELECT DISTINCT t.creator_address, t.chain_id
    FROM tokens t
    LEFT JOIN issuer_profiles ip ON t.creator_address = ip.issuer_address
    WHERE t.creator_address IS NOT NULL AND t.creator_address != ''
    AND (ip.issuer_address IS NULL OR ip.updated_at < ?)
    LIMIT 5
  `) as SqliteStatement).all(threshold) as any[];

  if (issuers.length === 0) return;
  console.log(`[Issuer] 需要同步 ${issuers.length} 个发行方`);

  let successCount = 0;
  for (const issuer of issuers) {
    const ok = await fetchSingleIssuerData(issuer.chain_id, issuer.creator_address);
    if (ok) successCount++;
    await new Promise(resolve => setTimeout(resolve, 2000)); // 限流
  }
  console.log(`[Issuer] 完成: ${successCount}/${issuers.length}`);
}

// 获取发行方数据供 API 返回
export function getIssuerProfile(creatorAddress: string): any {
  const profile = (db.prepare('SELECT * FROM issuer_profiles WHERE issuer_address = ?') as SqliteStatement).get(creatorAddress);
  if (!profile) return null;

  const tokens = (db.prepare(`
    SELECT * FROM issuer_tokens WHERE issuer_address = ? ORDER BY create_time DESC
  `) as SqliteStatement).all(creatorAddress);

  return { ...profile, tokens };
}
