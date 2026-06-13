// 相关面分析服务 - 同名检测、蹭大V、蹭叙事
import { db } from '../db/database';
import { logInfo, logError } from './logService';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

interface NameMatch {
  hot_token: string;
  similarity: number;
  risk_level: string;
  reason: string;
}

interface NarrativeMatch {
  narrative: string;
  keyword: string;
  risk_level: string;
  reason: string;
}

interface ContextAnalysisResult {
  context_risk_score: number;
  context_risk_level: string;
  hot_token_matches: NameMatch[];
  kol_mentions: any[];
  narrative_matches: NarrativeMatch[];
  risks: string[];
}

// 热门叙事关键词
const NARRATIVE_KEYWORDS: Record<string, string[]> = {
  'ai': ['AI', 'GPT', 'Neural', 'Brain', 'Machine', 'Learning', 'Chat', 'Bot'],
  'meme': ['Doge', 'Pepe', 'Wojak', 'Shib', 'Inu', 'Cat', 'Dog', 'Frog'],
  'defi': ['Swap', 'Yield', 'Farm', 'Stake', 'Pool', 'Flash', 'Loan'],
  'nft': ['Art', 'Pixel', 'Punk', 'Monkey', 'Ape', 'PFP', 'Collection'],
  'gaming': ['Game', 'Play', 'Metaverse', 'World', 'Land', 'Avatar'],
  'layer2': ['L2', 'Rollup', 'ZK', 'Optimistic', 'Sidechain'],
};

// 计算字符串相似度（简化版）
function calculateSimilarity(s1: string, s2: string): number {
  const a = s1.toLowerCase();
  const b = s2.toLowerCase();
  
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.8;
  
  // 简化的编辑距离
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  if (longer.length === 0) return 1.0;
  
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  
  return matches / longer.length;
}

// 同名检测
export function detectNameSimilarity(
  tokenSymbol: string,
  hotTokens: Array<{ symbol: string; chain_id?: string }>
): NameMatch[] {
  const matches: NameMatch[] = [];
  
  for (const hot of hotTokens) {
    const similarity = calculateSimilarity(tokenSymbol, hot.symbol);
    
    if (similarity >= 0.9) {
      matches.push({
        hot_token: hot.symbol,
        similarity,
        risk_level: 'critical',
        reason: `与热门代币"${hot.symbol}"名称高度相似`
      });
    } else if (similarity >= 0.7) {
      matches.push({
        hot_token: hot.symbol,
        similarity,
        risk_level: 'high',
        reason: `与热门代币"${hot.symbol}"名称相似`
      });
    } else if (tokenSymbol.toLowerCase().includes(hot.symbol.toLowerCase()) || 
               hot.symbol.toLowerCase().includes(tokenSymbol.toLowerCase())) {
      matches.push({
        hot_token: hot.symbol,
        similarity: 0.6,
        risk_level: 'medium',
        reason: `包含热门代币"${hot.symbol}"名称`
      });
    }
  }
  
  return matches;
}

// 蹭叙事检测
export function detectNarrative蹭热度(tokenSymbol: string, tokenName?: string): NarrativeMatch[] {
  const matches: NarrativeMatch[] = [];
  const symbolUpper = tokenSymbol.toUpperCase();
  const nameUpper = (tokenName || '').toUpperCase();
  
  for (const [narrative, keywords] of Object.entries(NARRATIVE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (symbolUpper.includes(keyword.toUpperCase()) || 
          nameUpper.includes(keyword.toUpperCase())) {
        matches.push({
          narrative,
          keyword,
          risk_level: 'medium',
          reason: `代币名称包含"${keyword}"，蹭${narrative}叙事`
        });
      }
    }
  }
  
  return matches;
}

// 获取热门代币列表
export function getHotTokens(): Array<{ symbol: string; chain_id: string }> {
  return (db.prepare(`
    SELECT symbol, chain_id 
    FROM hot_tokens 
    WHERE expires_at IS NULL OR expires_at > datetime('now')
    ORDER BY heat_score DESC
    LIMIT 100
  `) as SqliteStatement).all() as Array<{ symbol: string; chain_id: string }>;
}

// 添加热门代币
export function addHotToken(
  symbol: string,
  chainId: string,
  contractAddress: string,
  heatScore: number = 50
): void {
  (db.prepare(`
    INSERT OR REPLACE INTO hot_tokens (
      symbol, chain_id, contract_address, heat_score,
      first_hot_at, last_mentioned_at, created_at
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
  `) as SqliteStatement).run(symbol, chainId, contractAddress, heatScore);
}

// 计算相关面风险评分
export function calculateContextRisk(
  tokenSymbol: string,
  tokenName?: string
): ContextAnalysisResult {
  const risks: string[] = [];
  let score = 0;
  
  // 1. 同名检测
  const hotTokens = getHotTokens();
  const nameMatches = detectNameSimilarity(tokenSymbol, hotTokens);
  
  for (const match of nameMatches) {
    if (match.risk_level === 'critical') {
      score += 40;
      risks.push(match.reason);
    } else if (match.risk_level === 'high') {
      score += 25;
      risks.push(match.reason);
    } else if (match.risk_level === 'medium') {
      score += 10;
      risks.push(match.reason);
    }
  }
  
  // 2. 蹭叙事检测
  const narrativeMatches = detectNarrative蹭热度(tokenSymbol, tokenName);
  
  for (const match of narrativeMatches) {
    score += 5;
    if (risks.length < 5) { // 限制风险点数量
      risks.push(match.reason);
    }
  }
  
  // 限制分数范围
  score = Math.min(score, 100);
  
  // 确定风险等级
  let level: string;
  if (score >= 50) level = 'high';
  else if (score >= 25) level = 'medium';
  else level = 'low';
  
  return {
    context_risk_score: score,
    context_risk_level: level,
    hot_token_matches: nameMatches,
    kol_mentions: [], // 待实现：KOL提及检测
    narrative_matches: narrativeMatches,
    risks
  };
}

// 保存相关面分析结果
export function saveContextAnalysis(
  chainId: string,
  contractAddress: string,
  result: ContextAnalysisResult
): void {
  (db.prepare(`
    INSERT OR REPLACE INTO token_context_analysis (
      chain_id, contract_address,
      context_risk_score, context_risk_level,
      hot_token_matches, kol_mentions, narrative_matches, risks,
      analyzed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `) as SqliteStatement).run(
    chainId,
    contractAddress,
    result.context_risk_score,
    result.context_risk_level,
    JSON.stringify(result.hot_token_matches),
    JSON.stringify(result.kol_mentions),
    JSON.stringify(result.narrative_matches),
    JSON.stringify(result.risks)
  );
  
  logInfo('相关面分析', `${chainId}/${contractAddress.slice(0, 10)}... 风险: ${result.context_risk_level} (${result.context_risk_score}分)`);
}

// 获取相关面分析结果
export function getContextAnalysis(chainId: string, contractAddress: string): any {
  return (db.prepare(
    'SELECT * FROM token_context_analysis WHERE chain_id = ? AND contract_address = ?'
  ) as SqliteStatement).get(chainId, contractAddress);
}

// 批量分析
export function batchAnalyze(limit: number = 100): { analyzed: number; skipped: number } {
  const tokens = (db.prepare(`
    SELECT t.chain_id, t.contract_address, t.symbol, t.name
    FROM tokens t
    LEFT JOIN token_context_analysis a ON t.chain_id = a.chain_id AND t.contract_address = a.contract_address
    WHERE a.contract_address IS NULL 
       OR a.analyzed_at < datetime('now', '-1 day')
    ORDER BY t.first_seen_at DESC
    LIMIT ?
  `) as SqliteStatement).all(limit) as any[];
  
  let analyzed = 0;
  let skipped = 0;
  
  for (const token of tokens) {
    try {
      const result = calculateContextRisk(token.symbol, token.name);
      saveContextAnalysis(token.chain_id, token.contract_address, result);
      analyzed++;
    } catch (err: any) {
      logError('相关面分析', `分析失败: ${token.symbol} - ${err.message}`);
      skipped++;
    }
  }
  
  logInfo('相关面分析', `批量分析完成: ${analyzed}个成功, ${skipped}个跳过`);
  return { analyzed, skipped };
}
