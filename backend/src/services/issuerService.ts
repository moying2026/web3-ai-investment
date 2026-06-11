// 发行方历史代币数据采集服务
// 数据源：Binance Web3 API /bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/dev/created/tokens/info

import { db } from '../db/database';
import { logInfo } from './logService';

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

  logInfo('发行方', `${creatorAddress.substring(0, 12)}... | total: ${summary.totalCount} | migrated: ${summary.innerCount} | stored: ${count} tokens`);
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
  logInfo('发行方', `需要同步 ${issuers.length} 个发行方`);

  let successCount = 0;
  for (const issuer of issuers) {
    const ok = await fetchSingleIssuerData(issuer.chain_id, issuer.creator_address);
    if (ok) successCount++;
    await new Promise(resolve => setTimeout(resolve, 2000)); // 限流
  }
  logInfo('发行方', `完成: ${successCount}/${issuers.length}`);
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

// ==================== 发行方列表（分页/排序/筛选） ====================

export function listIssuers(params: {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  blacklist?: string;
  search?: string;
  minTokens?: number;
  maxTokens?: number;
}): any {
  const page = params.page || 1;
  const pageSize = Math.min(params.pageSize || 50, 200);
  const offset = (page - 1) * pageSize;

  const sortFields: Record<string, string> = {
    total_tokens: 'ip.total_tokens',
    survival_rate: 'ip.survival_rate',
    first_seen_at: 'ip.first_seen_at',
    last_seen_at: 'ip.last_seen_at',
    updated_at: 'ip.updated_at',
    blacklisted_at: 'ip.blacklisted_at',
    token_count: 'token_count',
  };
  const sortCol = sortFields[params.sortBy || ''] || 'ip.total_tokens';
  const sortDir = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const conditions: string[] = [];
  const whereParams: any[] = [];

  if (params.blacklist === 'none') {
    conditions.push("(ip.blacklist_status IS NULL OR ip.blacklist_status = 'none')");
  } else if (params.blacklist === 'manual') {
    conditions.push("ip.blacklist_status = 'manual'");
  } else if (params.blacklist === 'blacklisted') {
    conditions.push("ip.blacklist_status != 'none' AND ip.blacklist_status IS NOT NULL");
  }

  if (params.search) {
    conditions.push('ip.issuer_address LIKE ?');
    whereParams.push('%' + params.search + '%');
  }
  if (params.minTokens !== undefined) {
    conditions.push('ip.total_tokens >= ?');
    whereParams.push(params.minTokens);
  }
  if (params.maxTokens !== undefined) {
    conditions.push('ip.total_tokens <= ?');
    whereParams.push(params.maxTokens);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = (db.prepare('SELECT COUNT(*) as c FROM issuer_profiles ip ' + whereClause) as SqliteStatement).get(...whereParams) as any;

  const data = (db.prepare(
    'SELECT ip.*, (SELECT COUNT(*) FROM issuer_tokens it WHERE it.issuer_address = ip.issuer_address) as token_count ' +
    'FROM issuer_profiles ip ' + whereClause +
    ' ORDER BY ' + sortCol + ' ' + sortDir + ' LIMIT ? OFFSET ?'
  ) as SqliteStatement).all(...whereParams, pageSize, offset) as any[];

  return { data, total: total.c, page, pageSize };
}

// ==================== 发行方拉黑/取消拉黑 ====================

export function blacklistIssuer(address: string, action: 'blacklist' | 'unblacklist', reason?: string): any {
  const existing = (db.prepare('SELECT * FROM issuer_profiles WHERE issuer_address = ?') as SqliteStatement).get(address);
  if (!existing) return null;

  const now = new Date().toISOString();
  if (action === 'blacklist') {
    (db.prepare(
      "UPDATE issuer_profiles SET blacklist_status = 'manual', blacklist_reason = ?, blacklisted_at = ?, updated_at = datetime('now') WHERE issuer_address = ?"
    ) as SqliteStatement).run(reason || '手动拉黑', now, address);
  } else {
    (db.prepare(
      "UPDATE issuer_profiles SET blacklist_status = 'none', blacklist_reason = NULL, blacklisted_at = NULL, updated_at = datetime('now') WHERE issuer_address = ?"
    ) as SqliteStatement).run(address);
  }

  return (db.prepare('SELECT * FROM issuer_profiles WHERE issuer_address = ?') as SqliteStatement).get(address);
}

// ==================== 批量刷新发行方数据 ====================

export async function batchRefreshIssuers(addresses: string[]): Promise<{ success: number; failed: number; results: any[] }> {
  let success = 0;
  let failed = 0;
  const results: any[] = [];

  for (const address of addresses) {
    const token = (db.prepare(
      'SELECT chain_id FROM tokens WHERE creator_address = ? LIMIT 1'
    ) as SqliteStatement).get(address) as any;

    if (!token) {
      results.push({ address, status: 'no_tokens' });
      failed++;
      continue;
    }

    const ok = await fetchSingleIssuerData(token.chain_id, address);
    if (ok) {
      results.push({ address, status: 'ok' });
      success++;
    } else {
      results.push({ address, status: 'fetch_failed' });
      failed++;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { success, failed, results };
}

// ==================== 检查发行方是否在黑名单 ====================

export function isIssuerBlacklisted(address: string): { blacklisted: boolean; status: string; reason?: string } {
  if (!address) return { blacklisted: false, status: 'none' };
  const profile = (db.prepare(
    'SELECT blacklist_status, blacklist_reason FROM issuer_profiles WHERE issuer_address = ?'
  ) as SqliteStatement).get(address) as any;

  if (!profile || !profile.blacklist_status || profile.blacklist_status === 'none') {
    return { blacklisted: false, status: 'none' };
  }
  return { blacklisted: true, status: profile.blacklist_status, reason: profile.blacklist_reason };
}
