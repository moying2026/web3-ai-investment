// AI 分析引擎 — 综合多维度评分，给出 BUY/HOLD/AVOID 建议

import { db } from '../db/database';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface AnalysisResult {
  chainId: string;
  contractAddress: string;
  symbol: string;
  score: number;        // 0-100
  recommendation: 'BUY' | 'HOLD' | 'AVOID';
  reasons: string[];
  dimensionScores: {
    security: number;    // 合约安全 0-20
    smartMoney: number;  // Smart Money 0-25
    social: number;      // 社交热度 0-15
    issuer: number;      // 发行方 0-15
    liquidity: number;   // 流动性/持有人 0-25
  };
}

// 初始化 ai_analysis 表
export function initAnalysisTable(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    symbol TEXT,
    score INTEGER NOT NULL,
    recommendation TEXT NOT NULL,
    reasons_json TEXT,
    dimension_scores_json TEXT,
    analyzed_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analysis_token ON ai_analysis(chain_id, contract_address)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analysis_score ON ai_analysis(score)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analysis_time ON ai_analysis(analyzed_at)`);
  console.log('[AI] ai_analysis 表初始化完成');
}

// 分析单个代币
export function analyzeToken(chainId: string, contractAddress: string): AnalysisResult | null {
  // 获取代币基础信息
  const token = (db.prepare('SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?') as SqliteStatement)
    .get(chainId, contractAddress) as any;
  if (!token) return null;

  const reasons: string[] = [];
  let totalScore = 0;

  // 1. 合约安全审计（0-20分）
  let securityScore = 10; // 默认中等
  const audit = (db.prepare('SELECT * FROM token_audit WHERE chain_id = ? AND contract_address = ?') as SqliteStatement)
    .get(chainId, contractAddress) as any;
  if (audit) {
    if (audit.risk_level === 1) { securityScore = 18; reasons.push('合约审计风险低'); }
    else if (audit.risk_level === 2) { securityScore = 10; reasons.push('合约审计风险中等'); }
    else if (audit.risk_level >= 3) { securityScore = 3; reasons.push('⚠️ 合约审计风险高'); }
    if (audit.unusual_buy_tax || audit.unusual_sell_tax) {
      securityScore -= 5;
      reasons.push('⚠️ 异常税率');
    }
    if (audit.buy_tax && parseFloat(audit.buy_tax) > 0.05) {
      securityScore -= 3;
      reasons.push(`⚠️ 买入税率偏高: ${(parseFloat(audit.buy_tax) * 100).toFixed(1)}%`);
    }
  } else {
    reasons.push('未获取审计数据');
  }
  securityScore = Math.max(0, Math.min(20, securityScore));
  totalScore += securityScore;

  // 2. Smart Money 信号（0-25分）
  let smartMoneyScore = 10;
  const dynamic = (db.prepare('SELECT * FROM token_dynamic WHERE chain_id = ? AND contract_address = ?') as SqliteStatement)
    .get(chainId, contractAddress) as any;
  if (dynamic) {
    const smHolders = dynamic.smart_money_holders || 0;
    const smPercent = dynamic.smart_money_holding_percent || 0;
    if (smHolders >= 10) { smartMoneyScore = 22; reasons.push(`Smart Money 持仓活跃: ${smHolders}个地址`); }
    else if (smHolders >= 5) { smartMoneyScore = 18; reasons.push(`Smart Money 持仓: ${smHolders}个地址`); }
    else if (smHolders >= 2) { smartMoneyScore = 14; reasons.push(`少量 Smart Money 关注`); }
    else { smartMoneyScore = 6; reasons.push('Smart Money 关注度低'); }
    if (smPercent > 5) { smartMoneyScore += 3; reasons.push(`Smart Money 持仓占比高: ${smPercent.toFixed(2)}%`); }
  }
  // 检查是否有 Smart Money 买入信号
  const smSignal = (db.prepare(`
    SELECT * FROM smart_money_signals 
    WHERE chain_id = ? AND contract_address = ? AND direction = 'buy'
    ORDER BY signal_trigger_time DESC LIMIT 1
  `) as SqliteStatement).get(chainId, contractAddress) as any;
  if (smSignal) {
    smartMoneyScore += 5;
    reasons.push(`Smart Money 买入信号: ${smSignal.smart_money_count}个地址`);
  }
  smartMoneyScore = Math.max(0, Math.min(25, smartMoneyScore));
  totalScore += smartMoneyScore;

  // 3. 社交热度（0-15分）
  let socialScore = 7;
  const searchCount = token.search_count_24h || 0;
  if (searchCount >= 100) { socialScore = 13; reasons.push(`搜索热度高: ${searchCount}次/24h`); }
  else if (searchCount >= 30) { socialScore = 10; reasons.push(`搜索热度中等: ${searchCount}次/24h`); }
  else { socialScore = 5; reasons.push('搜索热度低'); }
  // 检查社交话题
  const topic = (db.prepare(`
    SELECT * FROM social_topics 
    WHERE contract_addresses LIKE ? OR token_list LIKE ?
    ORDER BY create_time DESC LIMIT 1
  `) as SqliteStatement).get(`%${contractAddress}%`, `%${contractAddress}%`) as any;
  if (topic) {
    socialScore += 2;
    reasons.push(`社交话题关联: ${topic.topic_name_cn || topic.topic_name_en}`);
  }
  socialScore = Math.max(0, Math.min(15, socialScore));
  totalScore += socialScore;

  // 4. 发行方历史（0-15分）
  let issuerScore = 7;
  const creatorAddress = token.creator_address;
  if (creatorAddress) {
    const issuer = (db.prepare('SELECT * FROM issuer_profiles WHERE issuer_address = ?') as SqliteStatement)
      .get(creatorAddress) as any;
    if (issuer) {
      const totalTokens = issuer.total_tokens || 0;
      const migrationRate = issuer.survival_rate || 0;
      if (totalTokens > 0) {
        if (migrationRate > 0.5) { issuerScore = 13; reasons.push(`发行方历史迁移率高: ${(migrationRate * 100).toFixed(0)}%`); }
        else if (migrationRate > 0.2) { issuerScore = 10; reasons.push(`发行方迁移率中等: ${(migrationRate * 100).toFixed(0)}%`); }
        else { issuerScore = 4; reasons.push(`发行方迁移率低: ${(migrationRate * 100).toFixed(0)}%`); }
        if (totalTokens > 100) { issuerScore -= 2; reasons.push(`⚠️ 发行方代币数量多: ${totalTokens}个`); }
      }
    } else {
      reasons.push('无发行方历史数据');
    }
  }
  issuerScore = Math.max(0, Math.min(15, issuerScore));
  totalScore += issuerScore;

  // 5. 流动性/持有人/交易量（0-25分）
  let liquidityScore = 10;
  const holders = token.holders || 0;
  const liquidity = parseFloat(token.liquidity || '0');
  const volume24h = parseFloat(token.volume_24h || '0');
  const mc = parseFloat(token.market_cap || '0');

  if (holders >= 500) { liquidityScore += 4; reasons.push(`持有人多: ${holders}`); }
  else if (holders >= 100) { liquidityScore += 2; reasons.push(`持有人中等: ${holders}`); }
  else { liquidityScore -= 2; reasons.push(`持有人少: ${holders}`); }

  if (liquidity >= 100000) { liquidityScore += 4; reasons.push(`流动性好: $${(liquidity/1000).toFixed(0)}K`); }
  else if (liquidity >= 20000) { liquidityScore += 2; reasons.push(`流动性中等: $${(liquidity/1000).toFixed(0)}K`); }
  else { liquidityScore -= 3; reasons.push(`⚠️ 流动性差: $${(liquidity/1000).toFixed(1)}K`); }

  if (volume24h >= 50000) { liquidityScore += 3; reasons.push(`24H交易量高: $${(volume24h/1000).toFixed(0)}K`); }
  else if (volume24h >= 10000) { liquidityScore += 1; }

  if (mc > 0 && mc < 50000) { liquidityScore += 2; reasons.push('低市值，上涨空间大'); }
  else if (mc > 1000000) { liquidityScore -= 1; }

  liquidityScore = Math.max(0, Math.min(25, liquidityScore));
  totalScore += liquidityScore;

  // 综合评分
  totalScore = Math.max(0, Math.min(100, totalScore));

  // 推荐
  let recommendation: 'BUY' | 'HOLD' | 'AVOID' = 'AVOID';
  if (totalScore >= 70) recommendation = 'BUY';
  else if (totalScore >= 50) recommendation = 'HOLD';

  return {
    chainId,
    contractAddress,
    symbol: token.symbol,
    score: totalScore,
    recommendation,
    reasons,
    dimensionScores: {
      security: securityScore,
      smartMoney: smartMoneyScore,
      social: socialScore,
      issuer: issuerScore,
      liquidity: liquidityScore,
    },
  };
}

// 存储分析结果
export function storeAnalysis(result: AnalysisResult): void {
  (db.prepare(`INSERT INTO ai_analysis (
    chain_id, contract_address, symbol, score, recommendation,
    reasons_json, dimension_scores_json, analyzed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`) as SqliteStatement).run(
    result.chainId, result.contractAddress, result.symbol,
    result.score, result.recommendation,
    JSON.stringify(result.reasons),
    JSON.stringify(result.dimensionScores)
  );
}

// 批量分析新币
export function analyzeNewTokens(): AnalysisResult[] {
  // 获取最近未分析的新币（最近 24 小时入库、未分析过）
  const tokens = (db.prepare(`
    SELECT t.chain_id, t.contract_address, t.symbol
    FROM tokens t
    LEFT JOIN ai_analysis aa ON t.chain_id = aa.chain_id AND t.contract_address = aa.contract_address
    WHERE aa.chain_id IS NULL AND t.first_seen_at > datetime('now', '-24 hours')
    ORDER BY t.first_seen_at DESC LIMIT 10
  `) as SqliteStatement).all() as any[];

  if (tokens.length === 0) return [];

  console.log(`[AI] 分析 ${tokens.length} 个新币`);
  const results: AnalysisResult[] = [];

  for (const token of tokens) {
    const result = analyzeToken(token.chain_id, token.contract_address);
    if (result) {
      storeAnalysis(result);
      results.push(result);
      console.log(`[AI] ${result.symbol}: score=${result.score} rec=${result.recommendation} reasons=[${result.reasons.slice(0, 2).join(', ')}]`);
    }
  }

  return results;
}
