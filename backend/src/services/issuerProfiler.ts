// 发行方画像服务 - 分析发行方行为，建立黑名单机制
import { db } from '../db/database';
import { logInfo, logError } from './logService';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

interface IssuerProfile {
  issuer_address: string;
  total_tokens: number;
  alive_tokens: number;
  dead_tokens: number;
  survival_rate: number;
  avg_lifetime_hours: number;
  first_token_at: string | null;
  last_token_at: string | null;
  migration_count: number;
  same_name_count: number;
  batch_issuance_flag: boolean;
  risk_level: number;
  risk_flags: string[];
  confidence: number;
  evidence: any;
}

interface BatchIssuanceResult {
  detected: boolean;
  count: number;
  threshold: number;
  risk_level: string;
}

interface NameCopyingResult {
  detected: boolean;
  matches: Array<{ hot_token: string; similarity: number; risk_level: string }>;
  max_similarity: number;
}

interface MigrationResult {
  detected: boolean;
  rate: number;
  migrated_count: number;
  total_count: number;
  threshold: number;
}

interface RapidDeathResult {
  detected: boolean;
  avg_lifetime: number;
  sample_count: number;
  threshold_hours: number;
}

interface IssuerRiskScore {
  score: number;
  level: number;
  flags: string[];
  details: {
    batch: BatchIssuanceResult;
    name_copy: NameCopyingResult;
    migration: MigrationResult;
    rapid_death: RapidDeathResult;
  };
}

// 获取或创建发行方画像
export function getOrCreateIssuerProfile(issuerAddress: string): IssuerProfile {
  const existing = (db.prepare('SELECT * FROM issuer_profiles WHERE issuer_address = ?') as SqliteStatement)
    .get(issuerAddress) as any;
  
  if (existing) {
    return existing;
  }
  
  // 创建新画像
  (db.prepare(`INSERT INTO issuer_profiles (issuer_address, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))`) as SqliteStatement)
    .run(issuerAddress);
  
  return (db.prepare('SELECT * FROM issuer_profiles WHERE issuer_address = ?') as SqliteStatement)
    .get(issuerAddress) as IssuerProfile;
}

// 更新发行方统计数据
export function updateIssuerStats(issuerAddress: string): void {
  const profile = getOrCreateIssuerProfile(issuerAddress);
  
  // 获取该发行方的所有代币
  const tokens = (db.prepare(`
    SELECT chain_id, contract_address, symbol, created_at, 
           launch_time, holders, liquidity, market_cap
    FROM tokens 
    WHERE meta_info LIKE ?
  `) as SqliteStatement).all(`%"creatorAddress":"${issuerAddress}"%`) as any[];
  
  if (tokens.length === 0) return;
  
  const now = new Date();
  let aliveCount = 0;
  let deadCount = 0;
  let totalLifetimeHours = 0;
  let lifetimeCount = 0;
  let migrationCount = 0;
  
  for (const token of tokens) {
    // 简单判断存活状态：有流动性且持有人>0
    const isAlive = (parseFloat(token.liquidity || '0') > 0) && (token.holders > 0);
    
    if (isAlive) {
      aliveCount++;
    } else {
      deadCount++;
    }
    
    // 计算存活时间
    if (token.created_at) {
      const createdAt = new Date(token.created_at);
      const lifetimeHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      if (lifetimeHours > 0) {
        totalLifetimeHours += lifetimeHours;
        lifetimeCount++;
      }
    }
  }
  
  const survivalRate = tokens.length > 0 ? aliveCount / tokens.length : 0;
  const avgLifetime = lifetimeCount > 0 ? totalLifetimeHours / lifetimeCount : 0;
  
  // 检查批量发币
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentTokens = tokens.filter(t => new Date(t.created_at) > thirtyDaysAgo);
  const batchFlag = recentTokens.length >= 5;
  
  // 更新数据库
  (db.prepare(`
    UPDATE issuer_profiles SET
      total_tokens = ?,
      alive_tokens = ?,
      dead_tokens = ?,
      survival_rate = ?,
      avg_lifetime_hours = ?,
      first_token_at = ?,
      last_token_at = ?,
      batch_issuance_flag = ?,
      last_analyzed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE issuer_address = ?
  `) as SqliteStatement).run(
    tokens.length,
    aliveCount,
    deadCount,
    survivalRate,
    avgLifetime,
    tokens[tokens.length - 1]?.created_at || null,
    tokens[0]?.created_at || null,
    batchFlag ? 1 : 0,
    issuerAddress
  );
  
  logInfo('发行方画像', `更新 ${issuerAddress.slice(0, 10)}... 统计: ${tokens.length}个代币, 存活率${(survivalRate * 100).toFixed(1)}%`);
}

// 批量发币检测
export function detectBatchIssuance(issuerAddress: string): BatchIssuanceResult {
  const tokens = (db.prepare(`
    SELECT created_at FROM tokens 
    WHERE meta_info LIKE ?
  `) as SqliteStatement).all(`%"creatorAddress":"${issuerAddress}"%`) as any[];
  
  if (tokens.length === 0) {
    return { detected: false, count: 0, threshold: 5, risk_level: 'none' };
  }
  
  // 统计30天内发行的代币
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentTokens = tokens.filter(t => new Date(t.created_at) > thirtyDaysAgo);
  
  const isBatch = recentTokens.length >= 5;
  
  return {
    detected: isBatch,
    count: recentTokens.length,
    threshold: 5,
    risk_level: recentTokens.length >= 10 ? 'high' : isBatch ? 'medium' : 'none'
  };
}

// 同名跟风检测
export function detectNameCopying(tokenSymbol: string, hotTokens: string[] = []): NameCopyingResult {
  const matches: Array<{ hot_token: string; similarity: number; risk_level: string }> = [];
  
  for (const hotToken of hotTokens) {
    // 计算相似度（简单实现：检查是否包含）
    const symbolLower = tokenSymbol.toLowerCase();
    const hotLower = hotToken.toLowerCase();
    
    if (symbolLower === hotLower) {
      matches.push({ hot_token: hotToken, similarity: 1.0, risk_level: 'critical' });
    } else if (symbolLower.includes(hotLower) || hotLower.includes(symbolLower)) {
      matches.push({ hot_token: hotToken, similarity: 0.8, risk_level: 'high' });
    }
  }
  
  return {
    detected: matches.length > 0,
    matches,
    max_similarity: matches.length > 0 ? Math.max(...matches.map(m => m.similarity)) : 0
  };
}

// 高迁移率检测
export function detectHighMigration(issuerAddress: string): MigrationResult {
  // 查找该发行方的所有代币，检查是否有迁移标记
  const tokens = (db.prepare(`
    SELECT contract_address, meta_info FROM tokens 
    WHERE meta_info LIKE ?
  `) as SqliteStatement).all(`%"creatorAddress":"${issuerAddress}"%`) as any[];
  
  if (tokens.length === 0) {
    return { detected: false, rate: 0, migrated_count: 0, total_count: 0, threshold: 0.5 };
  }
  
  // 简化：检查meta_info中是否有迁移相关标记
  let migratedCount = 0;
  for (const token of tokens) {
    try {
      const meta = JSON.parse(token.meta_info || '{}');
      if (meta.migrated || meta.migrationCount > 0) {
        migratedCount++;
      }
    } catch {}
  }
  
  const rate = migratedCount / tokens.length;
  
  return {
    detected: rate > 0.5,
    rate,
    migrated_count: migratedCount,
    total_count: tokens.length,
    threshold: 0.5
  };
}

// 快速死亡检测
export function detectRapidDeath(issuerAddress: string): RapidDeathResult {
  const tokens = (db.prepare(`
    SELECT created_at, liquidity, holders FROM tokens 
    WHERE meta_info LIKE ?
  `) as SqliteStatement).all(`%"creatorAddress":"${issuerAddress}"%`) as any[];
  
  if (tokens.length === 0) {
    return { detected: false, avg_lifetime: 0, sample_count: 0, threshold_hours: 24 };
  }
  
  let totalLifetime = 0;
  let count = 0;
  const now = new Date();
  
  for (const token of tokens) {
    if (token.created_at) {
      const createdAt = new Date(token.created_at);
      const lifetimeHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      
      // 只计算已"死亡"的代币（流动性为0或持有人为0）
      if (parseFloat(token.liquidity || '0') === 0 || token.holders === 0) {
        totalLifetime += lifetimeHours;
        count++;
      }
    }
  }
  
  const avgLifetime = count > 0 ? totalLifetime / count : 0;
  
  return {
    detected: avgLifetime < 24 && count > 0,
    avg_lifetime: avgLifetime,
    sample_count: count,
    threshold_hours: 24
  };
}

// 计算发行方综合风险评分
export function calculateIssuerRisk(issuerAddress: string): IssuerRiskScore {
  // 运行所有检测
  const batch = detectBatchIssuance(issuerAddress);
  const nameCopy = detectNameCopying('', []); // 需要外部传入热门代币列表
  const migration = detectHighMigration(issuerAddress);
  const rapidDeath = detectRapidDeath(issuerAddress);
  
  // 计算风险分数（0-100）
  let score = 0;
  const flags: string[] = [];
  
  if (batch.detected) {
    score += batch.count >= 10 ? 25 : 15;
    flags.push(`批量发币: ${batch.count}个/30天`);
  }
  
  if (nameCopy.detected) {
    score += nameCopy.max_similarity >= 0.9 ? 30 : 20;
    flags.push(`同名跟风: 相似度${(nameCopy.max_similarity * 100).toFixed(0)}%`);
  }
  
  if (migration.detected) {
    score += 20;
    flags.push(`高迁移率: ${(migration.rate * 100).toFixed(0)}%`);
  }
  
  if (rapidDeath.detected) {
    score += 25;
    flags.push(`快速死亡: 平均${rapidDeath.avg_lifetime.toFixed(0)}小时`);
  }
  
  // 限制在0-100
  score = Math.min(score, 100);
  
  // 确定风险等级
  let level: number;
  if (score >= 70) level = 5;
  else if (score >= 50) level = 4;
  else if (score >= 30) level = 3;
  else if (score >= 15) level = 2;
  else level = 1;
  
  // 更新发行方画像的风险信息
  (db.prepare(`
    UPDATE issuer_profiles SET
      risk_level = ?,
      risk_flags = ?,
      confidence = ?,
      updated_at = datetime('now')
    WHERE issuer_address = ?
  `) as SqliteStatement).run(
    level,
    JSON.stringify(flags),
    Math.min(1, (flags.length / 4)),
    issuerAddress
  );
  
  return {
    score,
    level,
    flags,
    details: { batch, name_copy: nameCopy, migration, rapid_death: rapidDeath }
  };
}

// 添加到黑名单
export function addToBlacklist(
  issuerAddress: string,
  reason: string,
  riskLevel: number,
  evidence: any,
  source: string = 'algorithm'
): { success: boolean; message: string } {
  try {
    // 检查是否已在黑名单
    const existing = (db.prepare('SELECT id FROM issuer_blacklist WHERE issuer_address = ?') as SqliteStatement)
      .get(issuerAddress) as any;
    
    if (existing) {
      return { success: false, message: '该发行方已在黑名单中' };
    }
    
    // 获取关联的代币
    const tokens = (db.prepare(`
      SELECT contract_address FROM tokens 
      WHERE meta_info LIKE ?
    `) as SqliteStatement).all(`%"creatorAddress":"${issuerAddress}"%`) as any[];
    
    const affectedTokens = tokens.map((t: any) => t.contract_address);
    
    // 插入黑名单
    (db.prepare(`
      INSERT INTO issuer_blacklist (
        issuer_address, reason, risk_level, evidence, 
        affected_tokens, tokens_affected, source,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `) as SqliteStatement).run(
      issuerAddress,
      reason,
      riskLevel,
      JSON.stringify(evidence),
      JSON.stringify(affectedTokens),
      affectedTokens.length,
      source
    );
    
    // 更新发行方画像的黑名单状态
    (db.prepare(`
      UPDATE issuer_profiles SET
        blacklist_status = 'blacklisted',
        blacklist_reason = ?,
        blacklisted_at = datetime('now'),
        updated_at = datetime('now')
      WHERE issuer_address = ?
    `) as SqliteStatement).run(reason, issuerAddress);
    
    logInfo('黑名单', `添加 ${issuerAddress.slice(0, 10)}... 原因: ${reason}, 影响 ${affectedTokens.length} 个代币`);
    
    return { success: true, message: '成功添加到黑名单' };
  } catch (err: any) {
    logError('黑名单', `添加失败: ${err.message}`);
    return { success: false, message: `添加失败: ${err.message}` };
  }
}

// 从黑名单移除
export function removeFromBlacklist(
  issuerAddress: string,
  reviewNotes: string
): { success: boolean; message: string } {
  try {
    const existing = (db.prepare('SELECT id FROM issuer_blacklist WHERE issuer_address = ?') as SqliteStatement)
      .get(issuerAddress) as any;
    
    if (!existing) {
      return { success: false, message: '该发行方不在黑名单中' };
    }
    
    // 更新状态为已移除
    (db.prepare(`
      UPDATE issuer_blacklist SET
        status = 'removed',
        review_notes = ?,
        reviewed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE issuer_address = ?
    `) as SqliteStatement).run(reviewNotes, issuerAddress);
    
    // 更新发行方画像
    (db.prepare(`
      UPDATE issuer_profiles SET
        blacklist_status = 'removed',
        updated_at = datetime('now')
      WHERE issuer_address = ?
    `) as SqliteStatement).run(issuerAddress);
    
    logInfo('黑名单', `移除 ${issuerAddress.slice(0, 10)}... 原因: ${reviewNotes}`);
    
    return { success: true, message: '成功从黑名单移除' };
  } catch (err: any) {
    logError('黑名单', `移除失败: ${err.message}`);
    return { success: false, message: `移除失败: ${err.message}` };
  }
}

// 检查是否在黑名单
export function isBlacklisted(issuerAddress: string): boolean {
  const result = (db.prepare(
    "SELECT id FROM issuer_blacklist WHERE issuer_address = ? AND status = 'active'"
  ) as SqliteStatement).get(issuerAddress) as any;
  
  return !!result;
}

// 获取黑名单列表
export function getBlacklist(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  riskLevel?: number;
} = {}): { list: any[]; total: number } {
  const page = params.page || 1;
  const pageSize = Math.min(params.pageSize || 20, 100);
  const offset = (page - 1) * pageSize;
  
  let where = "1=1";
  const sqlParams: any[] = [];
  
  if (params.status) {
    where += " AND status = ?";
    sqlParams.push(params.status);
  }
  
  if (params.riskLevel) {
    where += " AND risk_level >= ?";
    sqlParams.push(params.riskLevel);
  }
  
  const total = (db.prepare(`SELECT COUNT(*) as c FROM issuer_blacklist WHERE ${where}`) as SqliteStatement)
    .get(...sqlParams) as any;
  
  const list = (db.prepare(`
    SELECT * FROM issuer_blacklist 
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `) as SqliteStatement).all(...sqlParams, pageSize, offset) as any[];
  
  return { list, total: total?.c || 0 };
}

// 获取发行方详情
export function getIssuerDetail(issuerAddress: string): any {
  const profile = (db.prepare('SELECT * FROM issuer_profiles WHERE issuer_address = ?') as SqliteStatement)
    .get(issuerAddress) as any;
  
  const blacklist = (db.prepare(
    "SELECT * FROM issuer_blacklist WHERE issuer_address = ? AND status = 'active'"
  ) as SqliteStatement).get(issuerAddress) as any;
  
  const tokens = (db.prepare(`
    SELECT chain_id, contract_address, symbol, created_at, holders, liquidity
    FROM tokens 
    WHERE meta_info LIKE ?
    ORDER BY created_at DESC
    LIMIT 20
  `) as SqliteStatement).all(`%"creatorAddress":"${issuerAddress}"%`) as any[];
  
  return {
    profile,
    blacklist,
    tokens
  };
}
