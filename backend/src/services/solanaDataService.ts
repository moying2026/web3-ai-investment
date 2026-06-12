// SOL链数据采集服务 — DexScreener交易数据 + RugCheck合约审计
// 数据源：DexScreener API（价格/成交量）、RugCheck API（安全审计）
// 采集策略：首次入库采集，之后随轮询增量更新

import { db } from '../db/database';
import { logInfo, logWarn, logError } from './logService';

const { fetch: undiciFetch, ProxyAgent } = require('undici');

// 代理配置（从 proxyService 获取）
function getProxyDispatcher(): any {
  try {
    const { getDispatcher } = require('./proxyService');
    return getDispatcher();
  } catch {
    return undefined;
  }
}

// ============ 类型定义 ============

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: { usd: number; base: number; quote: number };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
}

interface RugCheckReport {
  tokenProgram: string;
  tokenType: string;
  risks: Array<{
    name: string;
    value: string;
    description: string;
    score: number;
    level: 'warn' | 'danger' | 'info';
  }>;
  score: number;
  score_normalised: number;
  lpLockedPct: number;
  markets?: Array<{
    marketType: string;
    lp: { quote: { symbol: string } };
  }>;
  tokenMeta?: {
    name: string;
    symbol: string;
    uri: string;
  };
}

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

// ============ DexScreener API ============

/**
 * 从 DexScreener 获取代币交易数据
 * 支持批量查询（一次最多30个地址）
 */
export async function fetchDexScreenerData(contractAddresses: string[]): Promise<Map<string, DexScreenerPair>> {
  const result = new Map<string, DexScreenerPair>();
  if (contractAddresses.length === 0) return result;

  // DexScreener 批量限制：每次最多30个地址
  const chunks: string[][] = [];
  for (let i = 0; i < contractAddresses.length; i += 30) {
    chunks.push(contractAddresses.slice(i, i + 30));
  }

  const dispatcher = getProxyDispatcher();

  for (const chunk of chunks) {
    try {
      const addresses = chunk.join(',');
      const url = `https://api.dexscreener.com/latest/dex/tokens/${addresses}`;
      const fetchOptions: any = {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(15000),
      };
      if (dispatcher) fetchOptions.dispatcher = dispatcher;

      const resp = await undiciFetch(url, fetchOptions);
      if (!resp.ok) {
        logWarn('SOL数据', `DexScreener HTTP ${resp.status} for ${chunk.length} tokens`);
        continue;
      }

      const json = await resp.json();
      const pairs: DexScreenerPair[] = json.pairs || [];

      // 按 baseToken.address 索引，取流动性最大的交易对
      for (const pair of pairs) {
        const addr = pair.baseToken.address.toLowerCase();
        const existing = result.get(addr);
        if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
          result.set(addr, pair);
        }
      }

      logInfo('SOL数据', `DexScreener: chunk ${chunk.length} addresses, got ${pairs.length} pairs`);
    } catch (err: any) {
      logError('SOL数据', `DexScreener chunk failed: ${err.message}`);
    }

    // 速率限制：每批次间隔 500ms
    if (chunks.length > 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return result;
}

// ============ RugCheck API ============

/**
 * 从 RugCheck 获取代币安全审计
 */
export async function fetchRugCheckAudit(contractAddress: string): Promise<RugCheckReport | null> {
  const dispatcher = getProxyDispatcher();
  try {
    const url = `https://api.rugcheck.xyz/v1/tokens/${contractAddress}/report/summary`;
    const fetchOptions: any = {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    };
    if (dispatcher) fetchOptions.dispatcher = dispatcher;

    const resp = await undiciFetch(url, fetchOptions);
    if (!resp.ok) {
      logWarn('SOL审计', `RugCheck HTTP ${resp.status} for ${contractAddress}`);
      return null;
    }

    const json = await resp.json();
    return json as RugCheckReport;
  } catch (err: any) {
    logError('SOL审计', `RugCheck failed for ${contractAddress}: ${err.message}`);
    return null;
  }
}

// ============ 数据映射与入库 ============

/**
 * 将 DexScreener 数据映射到 tokens 表字段并更新
 */
export function updateTokenFromDexScreener(chainId: string, contractAddress: string, pair: DexScreenerPair): void {
  const now = new Date().toISOString();
  try {
    (db.prepare(`UPDATE tokens SET
      price_latest = ?,
      percent_change_5m = ?,
      percent_change_1h = ?,
      percent_change_4h = ?,
      percent_change_24h = ?,
      volume_5m = ?,
      volume_1h = ?,
      volume_4h = ?,
      volume_24h = ?,
      count_5m = ?,
      count_1h = ?,
      count_4h = ?,
      count_24h = ?,
      count_24h_buy = ?,
      count_24h_sell = ?,
      liquidity = ?,
      market_cap = ?,
      updated_at = ?
    WHERE chain_id = ? AND contract_address = ?
    `) as SqliteStatement).run(
      pair.priceUsd || '0',
      pair.priceChange?.m5?.toString() || null,
      pair.priceChange?.h1?.toString() || null,
      pair.priceChange?.h6?.toString() || null,  // h6 映射到 4h 字段
      pair.priceChange?.h24?.toString() || null,
      pair.volume?.m5?.toString() || '0',
      pair.volume?.h1?.toString() || '0',
      pair.volume?.h6?.toString() || '0',
      pair.volume?.h24?.toString() || '0',
      (pair.txns?.m5?.buys || 0) + (pair.txns?.m5?.sells || 0),
      (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0),
      (pair.txns?.h6?.buys || 0) + (pair.txns?.h6?.sells || 0),
      (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
      pair.txns?.h24?.buys || 0,
      pair.txns?.h24?.sells || 0,
      pair.liquidity?.usd?.toString() || '0',
      pair.marketCap?.toString() || pair.fdv?.toString() || '0',
      now,
      chainId, contractAddress
    );
  } catch (err: any) {
    logError('SOL数据', `更新 DexScreener 数据失败 ${contractAddress}: ${err.message}`);
  }
}

/**
 * 将 RugCheck 审计数据映射到 token_audit 表
 */
export function saveRugCheckAudit(chainId: string, contractAddress: string, report: RugCheckReport): void {
  try {
    // 确保 token_audit 表存在
    db.exec(`CREATE TABLE IF NOT EXISTS token_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      risk_level TEXT,
      risk_level_enum TEXT,
      buy_tax TEXT,
      sell_tax TEXT,
      unusual_buy_tax REAL DEFAULT 0,
      unusual_sell_tax REAL DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      risk_items TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(chain_id, contract_address)
    )`);

    // 映射 RugCheck 分数到风险等级
    const scoreNorm = report.score_normalised || 0;
    let riskLevel = 'low';
    let riskLevelEnum = 'safe';
    if (scoreNorm >= 50) { riskLevel = 'high'; riskLevelEnum = 'dangerous'; }
    else if (scoreNorm >= 20) { riskLevel = 'medium'; riskLevelEnum = 'warning'; }
    else if (scoreNorm >= 10) { riskLevel = 'low'; riskLevelEnum = 'caution'; }

    // 提取风险项
    const riskItems = report.risks?.map(r => ({
      name: r.name,
      description: r.description,
      level: r.level,
      score: r.score,
    })) || [];

    // 是否可mint（从 risks 中检测）
    const hasMintRisk = report.risks?.some(r =>
      r.name.toLowerCase().includes('mint') || r.name.toLowerCase().includes('freeze')
    );
    const isVerified = hasMintRisk ? 0 : 1;

    (db.prepare(`INSERT INTO token_audit (
      chain_id, contract_address, risk_level, risk_level_enum,
      buy_tax, sell_tax, is_verified, risk_items, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chain_id, contract_address) DO UPDATE SET
      risk_level = excluded.risk_level,
      risk_level_enum = excluded.risk_level_enum,
      is_verified = excluded.is_verified,
      risk_items = excluded.risk_items,
      fetched_at = excluded.fetched_at
    `) as SqliteStatement).run(
      chainId, contractAddress,
      riskLevel, riskLevelEnum,
      null, null,  // SOL 无 buy/sell tax 概念
      isVerified,
      JSON.stringify(riskItems)
    );
  } catch (err: any) {
    logError('SOL审计', `保存 RugCheck 审计失败 ${contractAddress}: ${err.message}`);
  }
}

// ============ 批量采集入口 ============

/**
 * 批量采集 SOL 链代币的 DexScreener 数据
 * 从 tokens 表中取所有 SOL 链代币，分批查询
 */
export async function fetchAllSolTokenData(): Promise<{ updated: number; failed: number }> {
  const solTokens = (db.prepare(
    "SELECT contract_address, symbol FROM tokens WHERE chain_id = 'CT_501'"
  ) as SqliteStatement).all() as any[];

  if (solTokens.length === 0) {
    logInfo('SOL数据', '无 SOL 代币需要更新');
    return { updated: 0, failed: 0 };
  }

  logInfo('SOL数据', `开始 DexScreener 数据采集: ${solTokens.length} 个 SOL 代币`);

  const addresses = solTokens.map(t => t.contract_address);
  const dexData = await fetchDexScreenerData(addresses);

  let updated = 0;
  let failed = 0;

  for (const token of solTokens) {
    const pair = dexData.get(token.contract_address.toLowerCase());
    if (pair) {
      updateTokenFromDexScreener('CT_501', token.contract_address, pair);
      updated++;
    } else {
      failed++;
    }
  }

  logInfo('SOL数据', `DexScreener 采集完成: updated=${updated} failed=${failed} total=${solTokens.length}`);
  return { updated, failed };
}

/**
 * 批量采集 SOL 链代币的 RugCheck 审计
 * 只采集没有审计数据的代币
 */
export async function fetchAllSolAudits(): Promise<{ audited: number; failed: number }> {
  // 取没有审计数据的 SOL 代币
  const unaudited = (db.prepare(`
    SELECT t.contract_address, t.symbol
    FROM tokens t
    LEFT JOIN token_audit ta ON t.chain_id = ta.chain_id AND t.contract_address = ta.contract_address
    WHERE t.chain_id = 'CT_501' AND ta.id IS NULL
    LIMIT 100
  `) as SqliteStatement).all() as any[];

  if (unaudited.length === 0) {
    logInfo('SOL审计', '所有 SOL 代币已有审计数据');
    return { audited: 0, failed: 0 };
  }

  logInfo('SOL审计', `开始 RugCheck 审计采集: ${unaudited.length} 个待审计`);

  let audited = 0;
  let failed = 0;

  for (const token of unaudited) {
    try {
      const report = await fetchRugCheckAudit(token.contract_address);
      if (report) {
        saveRugCheckAudit('CT_501', token.contract_address, report);
        audited++;
        logInfo('SOL审计', `${token.symbol}: score=${report.score} normalized=${report.score_normalised} risks=${report.risks?.length || 0}`);
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    // 速率限制：每个请求间隔 200ms
    await new Promise(r => setTimeout(r, 200));
  }

  logInfo('SOL审计', `RugCheck 审计完成: audited=${audited} failed=${failed}`);
  return { audited, failed };
}

/**
 * 查询单个 SOL 代币的完整数据（DexScreener + RugCheck）
 */
export async function fetchSingleSolTokenData(contractAddress: string): Promise<{
  dexData: DexScreenerPair | null;
  audit: RugCheckReport | null;
}> {
  // DexScreener
  const dexMap = await fetchDexScreenerData([contractAddress]);
  const dexData = dexMap.get(contractAddress.toLowerCase()) || null;

  // RugCheck
  const audit = await fetchRugCheckAudit(contractAddress);

  // 入库
  if (dexData) {
    updateTokenFromDexScreener('CT_501', contractAddress, dexData);
  }
  if (audit) {
    saveRugCheckAudit('CT_501', contractAddress, audit);
  }

  return { dexData, audit };
}
