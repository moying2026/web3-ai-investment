// 代币分析服务 — 同名检测、发行方风险、地址分析
import { db } from '../db/database';
import { THRESHOLDS } from '../config/thresholds';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

// ============ 同名/跨链检测 ============

export interface SimilarTokenResult {
  sameName: { chain_id: string; contract_address: string; symbol: string; first_seen_at: string }[];
  crossChain: { chain_id: string; contract_address: string; symbol: string }[];
  duplicateCount: number;
  isCrossChainProject: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  riskReasons: string[];
}

export function findSimilarTokens(
  symbol: string,
  chainId: string,
  excludeAddress?: string
): SimilarTokenResult {
  const sameName = (db.prepare(`
    SELECT chain_id, contract_address, symbol, first_seen_at
    FROM tokens
    WHERE UPPER(symbol) = UPPER(?) AND (chain_id != ? OR contract_address != ?)
    ORDER BY first_seen_at ASC
  `) as SqliteStatement).all(symbol, chainId, excludeAddress || '') as any[];

  const chains = new Set(sameName.map((t: any) => t.chain_id));
  const crossChain = sameName.filter((t: any) => t.chain_id !== chainId);

  const isCrossChain = chains.size >= 2 && sameName.length > 0
    && (Date.now() - new Date(sameName[0].first_seen_at).getTime()) > THRESHOLDS.duplicate.crossChainMinAgeDays * 86400000;

  const riskReasons: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' = 'low';

  if (sameName.length > 0 && !isCrossChain) {
    const isCommon = (THRESHOLDS.duplicate.commonSymbols as readonly string[]).includes(symbol.toUpperCase());
    if (isCommon) {
      riskLevel = 'medium';
      riskReasons.push(`常见名称 "${symbol}"，需额外验证`);
    } else {
      riskLevel = 'high';
      riskReasons.push(`发现 ${sameName.length} 个同名代币，疑似仿币`);
    }
  } else if (isCrossChain) {
    riskReasons.push(`真实跨链项目，${chains.size} 条链有同名代币`);
  } else {
    riskReasons.push('无同名代币');
  }

  return { sameName, crossChain, duplicateCount: sameName.length, isCrossChainProject: isCrossChain, riskLevel, riskReasons };
}

// ============ 发行方风险评估 ============

export interface IssuerRiskResult {
  issuerAddress: string;
  totalTokens: number;
  recentTokens7d: number;
  recentTokens30d: number;
  migrationRate: number;
  riskLevel: 'low' | 'medium' | 'high';
  riskReasons: string[];
  confidence: number;
}

export function assessIssuerRisk(issuerAddress: string): IssuerRiskResult {
  const T = THRESHOLDS.issuer;
  const profile = (db.prepare(
    'SELECT * FROM issuer_profiles WHERE issuer_address = ?'
  ) as SqliteStatement).get(issuerAddress) as any;

  if (!profile) {
    return {
      issuerAddress, totalTokens: 0, recentTokens7d: 0, recentTokens30d: 0,
      migrationRate: 0, riskLevel: 'low', riskReasons: ['无发行方历史'], confidence: 0.2,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const recent7d = (db.prepare(
    'SELECT COUNT(*) as c FROM issuer_tokens WHERE issuer_address = ? AND create_time > ?'
  ) as SqliteStatement).get(issuerAddress, now - 7 * 86400) as any;
  const recent30d = (db.prepare(
    'SELECT COUNT(*) as c FROM issuer_tokens WHERE issuer_address = ? AND create_time > ?'
  ) as SqliteStatement).get(issuerAddress, now - 30 * 86400) as any;

  const riskReasons: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  const migrationRate = profile.total_tokens > 0 ? (profile.alive_tokens || 0) / profile.total_tokens : 0;

  if (profile.total_tokens > T.totalTokensHigh) {
    riskLevel = 'high'; riskReasons.push(`发行代币总数过多: ${profile.total_tokens}`);
  } else if (profile.total_tokens > T.totalTokensMedium) {
    riskLevel = 'medium'; riskReasons.push(`发行代币数较多: ${profile.total_tokens}`);
  }

  if (recent7d.c > T.recent7dHigh) {
    riskLevel = 'high'; riskReasons.push(`近7天发行${recent7d.c}个代币（批量发币）`);
  } else if (recent7d.c > T.recent7dMedium) {
    if (riskLevel === 'low') riskLevel = 'medium';
    riskReasons.push(`近7天发行${recent7d.c}个代币`);
  }

  if (migrationRate < T.migrationRateLow && profile.total_tokens > T.minTokensForRateCheck) {
    riskLevel = 'high'; riskReasons.push(`迁移率极低: ${(migrationRate * 100).toFixed(1)}%`);
  } else if (migrationRate < T.migrationRateMedium && profile.total_tokens > T.minTokensForRateCheck) {
    if (riskLevel === 'low') riskLevel = 'medium';
    riskReasons.push(`迁移率偏低: ${(migrationRate * 100).toFixed(1)}%`);
  }

  if (riskReasons.length === 0) riskReasons.push('无异常');
  const confidence = profile.total_tokens > 0 ? Math.min(1, profile.total_tokens / 10) : 0.2;

  return {
    issuerAddress, totalTokens: profile.total_tokens,
    recentTokens7d: recent7d.c, recentTokens30d: recent30d.c,
    migrationRate, riskLevel, riskReasons, confidence,
  };
}

// ============ 地址基础分析 ============

export interface AddressRiskResult {
  score: number;
  riskFlags: string[];
  highlights: string[];
  confidence: number;
}

export function scoreAddressRisk(token: any): AddressRiskResult {
  const T = THRESHOLDS.address;
  let score = 12;
  const riskFlags: string[] = [];
  const highlights: string[] = [];

  const top10 = parseFloat(token.holders_top10_percent || '0');
  const bundles = parseFloat(token.bundles_holding_percent || '0');
  const devHolding = parseFloat(token.dev_holding_percent || '0');
  const smHolding = parseFloat(token.smart_money_holding_percent || '0');
  const holders = token.holders || 0;
  const uniqueTraders = token.unique_trader_24h || 0;

  let dataPoints = 0;

  if (top10 > 0) {
    dataPoints++;
    if (top10 >= T.top10PercentHigh) { score -= 5; riskFlags.push(`前10持仓占比极高: ${top10.toFixed(1)}%`); }
    else if (top10 >= T.top10PercentMedium) { score -= 3; riskFlags.push(`前10持仓占比偏高: ${top10.toFixed(1)}%`); }
    else if (top10 < T.top10PercentHealthy) { score += 3; highlights.push('持仓分布均匀'); }
  }

  if (bundles > 0) {
    dataPoints++;
    if (bundles >= T.bundlesHigh) { score -= 6; riskFlags.push(`疑似批量刷号: ${bundles.toFixed(1)}%`); }
    else if (bundles >= T.bundlesMedium) { score -= 4; riskFlags.push(`批量地址占比偏高: ${bundles.toFixed(1)}%`); }
  }

  if (devHolding > 0) {
    dataPoints++;
    if (devHolding >= T.devHoldingHigh) { score -= 4; riskFlags.push(`开发者持仓过高: ${devHolding.toFixed(1)}%`); }
  }

  if (smHolding > 0) {
    dataPoints++;
    if (smHolding >= T.smHoldingStrong) { score += 4; highlights.push(`Smart Money 重仓: ${smHolding.toFixed(1)}%`); }
    else if (smHolding >= T.smHoldingMedium) { score += 2; highlights.push('Smart Money 关注'); }
  }

  if (holders > 0) {
    dataPoints++;
    if (holders >= T.holdersHealthy) { score += 2; }
    else if (holders < T.holdersLow) { score -= 2; riskFlags.push(`持有人过少: ${holders}`); }
  }

  if (uniqueTraders > 0) {
    dataPoints++;
    if (uniqueTraders >= T.uniqueTradersHealthy) { score += 2; }
    else if (uniqueTraders < T.uniqueTradersLow) { score -= 2; riskFlags.push('交易活跃度极低'); }
  }

  const confidence = Math.min(1, dataPoints / 4);
  return { score: Math.max(0, Math.min(25, score)), riskFlags, highlights, confidence };
}
