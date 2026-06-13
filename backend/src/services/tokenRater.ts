// 代币分级服务 - 根据代币特征进行分级，实施差异化交易策略
import { db } from '../db/database';
import { logInfo, logError } from './logService';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

interface TokenRating {
  chain_id: string;
  contract_address: string;
  token_level: string;
  level_reason: string;
  level_score: number;
  platform_source: string;
  issuer_risk_level: number;
  lp_locked: boolean;
  lp_lock_duration_days: number | null;
  token_age_hours: number;
  current_price: number;
  market_cap: number;
  liquidity: number;
  holders: number;
  risk_flags: string[];
}

interface RatingResult {
  level: string;
  score: number;
  reason: string;
  risk_flags: string[];
  details: {
    issuer_risk: number;
    token_age: number;
    lp_locked: boolean;
    platform: string;
  };
}

// 差异化策略配置
export const LEVEL_STRATEGIES: Record<string, {
  min_invest: number;
  max_invest: number;
  stop_loss: number;
  take_profit: number;
  can_add_position: boolean;
  add_position_threshold: number;
  description: string;
}> = {
  'L1': {
    min_invest: 100,
    max_invest: 500,
    stop_loss: -0.10,
    take_profit: 0.30,
    can_add_position: true,
    add_position_threshold: -0.15,
    description: '主流币：有共识、有应用、有基础'
  },
  'L2': {
    min_invest: 50,
    max_invest: 200,
    stop_loss: -0.15,
    take_profit: 0.50,
    can_add_position: true,
    add_position_threshold: -0.10,
    description: '老币：上线>6个月，有一定共识'
  },
  'L3': {
    min_invest: 20,
    max_invest: 100,
    stop_loss: -0.20,
    take_profit: 1.00,
    can_add_position: true,
    add_position_threshold: -0.15,
    description: '新币-可靠：发行方不在黑名单，有历史'
  },
  'L4': {
    min_invest: 5,
    max_invest: 20,
    stop_loss: -0.30,
    take_profit: 2.00,
    can_add_position: false,
    add_position_threshold: 0,
    description: '新币-未知：发行方信息不足'
  },
  'L5': {
    min_invest: 0,
    max_invest: 5,
    stop_loss: -0.50,
    take_profit: 5.00,
    can_add_position: false,
    add_position_threshold: 0,
    description: '高风险：发行方可疑/LP未锁定'
  }
};

// 已知主流币列表
const MAINNET_COINS = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'MATIC',
  'LINK', 'UNI', 'ATOM', 'LTC', 'FIL', 'APT', 'ARB', 'OP', 'NEAR', 'FTM'
];

// 已知平台部署者地址（示例）
const PLATFORM_DEPLOYERS: Record<string, string[]> = {
  'pump.fun': ['0x6611e750D1e0Bf5C235c6C5C7C5C7C5C7C5C7C5C'],
  'four.meme': ['0x4444e750D1e0Bf5C235c6C5C7C5C7C5C7C5C7C5C'],
};

// 获取或创建代币分级
export function getOrCreateTokenRating(chainId: string, contractAddress: string): TokenRating | null {
  const existing = (db.prepare('SELECT * FROM token_rating WHERE chain_id = ? AND contract_address = ?') as SqliteStatement)
    .get(chainId, contractAddress) as TokenRating | undefined;
  
  return existing || null;
}

// 识别代币发行平台
export function identifyPlatform(chainId: string, contractAddress: string, metaInfo: any): string {
  // 方法1: 通过meta_info中的平台信息
  if (metaInfo?.platform) {
    return metaInfo.platform;
  }
  
  // 方法2: 通过部署者地址识别
  if (metaInfo?.creatorAddress) {
    for (const [platform, deployers] of Object.entries(PLATFORM_DEPLOYERS)) {
      if (deployers.includes(metaInfo.creatorAddress.toLowerCase())) {
        return platform;
      }
    }
  }
  
  // 方法3: 通过合约特征识别（简化版）
  // Pump.fun合约通常有特定的字节码特征
  // 这里简化为检查代币名称特征
  const symbol = metaInfo?.symbol || '';
  if (symbol.includes('PUMP') || symbol.includes('FUN')) {
    return 'pump.fun';
  }
  
  return 'unknown';
}

// 计算代币年龄（小时）
export function calculateTokenAgeHours(createdAt: string | null): number {
  if (!createdAt) return 0;
  
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  
  return Math.max(0, diffMs / (1000 * 60 * 60));
}

// 检查LP是否锁定（简化版）
export function checkLPLocked(chainId: string, contractAddress: string): { locked: boolean; duration: number | null } {
  // 简化实现：检查token_audit表中的LP锁定信息
  const audit = (db.prepare(
    'SELECT * FROM token_audit WHERE chain_id = ? AND contract_address = ?'
  ) as SqliteStatement).get(chainId, contractAddress) as any;
  
  if (audit) {
    // 从审计数据中提取LP锁定信息
    try {
      const auditInfo = JSON.parse(audit.audit_info || '{}');
      return {
        locked: auditInfo.lpLocked || false,
        duration: auditInfo.lpLockDuration || null
      };
    } catch {}
  }
  
  return { locked: false, duration: null };
}

// 计算代币分级
export function calculateTokenRating(
  chainId: string,
  contractAddress: string,
  tokenData: any
): RatingResult {
  const riskFlags: string[] = [];
  let score = 50; // 基础分数
  
  // 1. 检查是否是主流币
  const symbol = tokenData.symbol?.toUpperCase() || '';
  if (MAINNET_COINS.includes(symbol)) {
    return {
      level: 'L1',
      score: 95,
      reason: '主流币',
      risk_flags: [],
      details: {
        issuer_risk: 0,
        token_age: 0,
        lp_locked: true,
        platform: 'official'
      }
    };
  }
  
  // 2. 获取发行方风险
  const metaInfo = tokenData.meta_info ? JSON.parse(tokenData.meta_info || '{}') : {};
  const issuerAddress = metaInfo.creatorAddress || '';
  let issuerRisk = 0;
  
  if (issuerAddress) {
    const issuerProfile = (db.prepare(
      'SELECT risk_level FROM issuer_profiles WHERE issuer_address = ?'
    ) as SqliteStatement).get(issuerAddress) as any;
    
    issuerRisk = issuerProfile?.risk_level || 0;
    
    if (issuerRisk >= 4) {
      riskFlags.push('发行方高风险');
      score -= 30;
    } else if (issuerRisk >= 3) {
      riskFlags.push('发行方中风险');
      score -= 15;
    }
  }
  
  // 3. 检查代币年龄
  const tokenAgeHours = calculateTokenAgeHours(tokenData.created_at || tokenData.first_seen_at);
  const tokenAgeDays = tokenAgeHours / 24;
  
  if (tokenAgeDays > 180) {
    // 老币（>6个月）
    score += 15;
  } else if (tokenAgeDays > 30) {
    // 中等年龄
    score += 5;
  } else {
    // 新币
    riskFlags.push('新币');
    score -= 5;
  }
  
  // 4. 检查LP状态
  const lpStatus = checkLPLocked(chainId, contractAddress);
  if (lpStatus.locked) {
    score += 10;
  } else {
    riskFlags.push('LP未锁定');
    score -= 15;
  }
  
  // 5. 检查流动性
  const liquidity = parseFloat(tokenData.liquidity || '0');
  if (liquidity >= 100000) {
    score += 10;
  } else if (liquidity >= 20000) {
    score += 5;
  } else if (liquidity < 5000) {
    riskFlags.push('流动性差');
    score -= 10;
  }
  
  // 6. 检查持有人数量
  const holders = tokenData.holders || 0;
  if (holders >= 500) {
    score += 5;
  } else if (holders < 50) {
    riskFlags.push('持有人少');
    score -= 5;
  }
  
  // 7. 识别平台
  const platform = identifyPlatform(chainId, contractAddress, metaInfo);
  if (platform === 'pump.fun' || platform === 'four.meme') {
    riskFlags.push(`来自${platform}`);
    score -= 5;
  }
  
  // 限制分数范围
  score = Math.max(0, Math.min(100, score));
  
  // 确定等级
  let level: string;
  let reason: string;
  
  if (score >= 80) {
    level = 'L1';
    reason = '优质代币';
  } else if (score >= 60) {
    level = 'L2';
    reason = '良好代币';
  } else if (score >= 40) {
    level = 'L3';
    reason = '一般代币';
  } else if (score >= 20) {
    level = 'L4';
    reason = '风险代币';
  } else {
    level = 'L5';
    reason = '高风险代币';
  }
  
  // 特殊情况：高风险发行方直接降级
  if (issuerRisk >= 4) {
    level = 'L5';
    reason = '发行方高风险';
  }
  
  return {
    level,
    score,
    reason,
    risk_flags: riskFlags,
    details: {
      issuer_risk: issuerRisk,
      token_age: tokenAgeHours,
      lp_locked: lpStatus.locked,
      platform
    }
  };
}

// 保存代币分级
export function saveTokenRating(
  chainId: string,
  contractAddress: string,
  rating: RatingResult,
  tokenData: any
): void {
  const metaInfo = tokenData.meta_info ? JSON.parse(tokenData.meta_info || '{}') : {};
  const tokenAgeHours = calculateTokenAgeHours(tokenData.created_at || tokenData.first_seen_at);
  const lpStatus = checkLPLocked(chainId, contractAddress);
  
  (db.prepare(`
    INSERT OR REPLACE INTO token_rating (
      chain_id, contract_address,
      token_level, level_reason, level_score,
      platform_source,
      issuer_risk_level,
      lp_locked, lp_lock_duration_days,
      token_age_hours,
      current_price, market_cap, liquidity, holders,
      risk_flags,
      rated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `) as SqliteStatement).run(
    chainId,
    contractAddress,
    rating.level,
    rating.reason,
    rating.score,
    rating.details.platform,
    rating.details.issuer_risk,
    lpStatus.locked ? 1 : 0,
    lpStatus.duration,
    tokenAgeHours,
    parseFloat(tokenData.price_latest || tokenData.price || '0'),
    parseFloat(tokenData.market_cap || '0'),
    parseFloat(tokenData.liquidity || '0'),
    tokenData.holders || 0,
    JSON.stringify(rating.risk_flags)
  );
  
  logInfo('代币分级', `${chainId}/${contractAddress.slice(0, 10)}... → ${rating.level} (${rating.score}分)`);
}

// 批量分级
export function batchRateTokens(limit: number = 100): { rated: number; skipped: number } {
  // 获取未分级或需要更新的代币
  const tokens = (db.prepare(`
    SELECT t.chain_id, t.contract_address, t.symbol, t.price_latest, t.market_cap,
           t.liquidity, t.holders, t.created_at, t.first_seen_at, t.meta_info
    FROM tokens t
    LEFT JOIN token_rating r ON t.chain_id = r.chain_id AND t.contract_address = r.contract_address
    WHERE r.contract_address IS NULL 
       OR r.rated_at < datetime('now', '-1 day')
    ORDER BY t.first_seen_at DESC
    LIMIT ?
  `) as SqliteStatement).all(limit) as any[];
  
  let rated = 0;
  let skipped = 0;
  
  for (const token of tokens) {
    try {
      const rating = calculateTokenRating(token.chain_id, token.contract_address, token);
      saveTokenRating(token.chain_id, token.contract_address, rating, token);
      rated++;
    } catch (err: any) {
      logError('代币分级', `分级失败: ${token.symbol} - ${err.message}`);
      skipped++;
    }
  }
  
  logInfo('代币分级', `批量分级完成: ${rated}个成功, ${skipped}个跳过`);
  return { rated, skipped };
}

// 获取代币分级
export function getTokenRating(chainId: string, contractAddress: string): TokenRating | null {
  return (db.prepare(
    'SELECT * FROM token_rating WHERE chain_id = ? AND contract_address = ?'
  ) as SqliteStatement).get(chainId, contractAddress) as TokenRating | null;
}

// 获取代币策略
export function getTokenStrategy(level: string): typeof LEVEL_STRATEGIES[string] | null {
  return LEVEL_STRATEGIES[level] || null;
}

// 按等级统计
export function getRatingStats(): Record<string, number> {
  const stats = (db.prepare(`
    SELECT token_level, COUNT(*) as count
    FROM token_rating
    GROUP BY token_level
  `) as SqliteStatement).all() as any[];
  
  const result: Record<string, number> = {
    'L1': 0, 'L2': 0, 'L3': 0, 'L4': 0, 'L5': 0
  };
  
  for (const stat of stats) {
    result[stat.token_level] = stat.count;
  }
  
  return result;
}

// 获取指定等级的代币列表
export function getTokensByLevel(
  level: string,
  params: { page?: number; pageSize?: number } = {}
): { list: any[]; total: number } {
  const page = params.page || 1;
  const pageSize = Math.min(params.pageSize || 20, 100);
  const offset = (page - 1) * pageSize;
  
  const total = (db.prepare(
    'SELECT COUNT(*) as c FROM token_rating WHERE token_level = ?'
  ) as SqliteStatement).get(level) as any;
  
  const list = (db.prepare(`
    SELECT r.*, t.symbol, t.chain_id
    FROM token_rating r
    LEFT JOIN tokens t ON r.chain_id = t.chain_id AND r.contract_address = t.contract_address
    WHERE r.token_level = ?
    ORDER BY r.level_score DESC
    LIMIT ? OFFSET ?
  `) as SqliteStatement).all(level, pageSize, offset) as any[];
  
  return { list, total: total?.c || 0 };
}
