// 市场分析 Agent — 热度、话题、KOL
import { db } from '../../db/database';
import { AgentEvaluateRequest, AgentEvaluateResult } from './types';

interface SqliteStatement { get(...params: any[]): any; all(...params: any[]): any[]; }

export function evaluateMarket(req: AgentEvaluateRequest): AgentEvaluateResult {
  const { chainId, contractAddress } = req;
  const details: Record<string, any> = {};
  const riskFlags: string[] = [];
  const highlights: string[] = [];
  let score = 7;
  let dataPoints = 0;

  const token = req.tokenData || (db.prepare(
    'SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?'
  ) as SqliteStatement).get(chainId, contractAddress) as any;

  if (token) {
    // 搜索热度
    const searchCount = token.search_count_24h || 0;
    dataPoints++;
    details.search_count_24h = searchCount;
    if (searchCount >= 100) { score = 13; highlights.push(`搜索热度高: ${searchCount}次/24h`); }
    else if (searchCount >= 30) { score = 10; highlights.push(`搜索热度中等: ${searchCount}次/24h`); }
    else { score = 5; riskFlags.push('搜索热度低'); }

    // 交易量趋势
    const vol24h = parseFloat(token.volume_24h || '0');
    const vol1h = parseFloat(token.volume_1h || '0');
    if (vol24h > 0 && vol1h > 0) {
      dataPoints++;
      const hourlyRate = vol1h * 24;
      const volAccel = hourlyRate / vol24h;
      details.volume_acceleration = volAccel.toFixed(2);
      if (volAccel > 2) { score += 3; highlights.push('交易量加速上升'); }
      else if (volAccel < 0.5) { score -= 2; riskFlags.push('交易量萎缩'); }
    }
  }

  // 社交话题
  const topic = (db.prepare(`
    SELECT * FROM social_topics
    WHERE contract_addresses LIKE ? OR token_list LIKE ?
    ORDER BY create_time DESC LIMIT 1
  `) as SqliteStatement).get(`%${contractAddress}%`, `%${contractAddress}%`) as any;

  if (topic) {
    dataPoints++;
    score += 2;
    details.social_topic = topic.topic_name_cn || topic.topic_name_en;
    highlights.push(`社交话题关联: ${details.social_topic}`);
  }

  const confidence = Math.min(1, dataPoints / 3);
  score = Math.max(0, Math.min(15, score));

  return {
    agentType: 'market', score, confidence, details, riskFlags, highlights,
    evaluatedAt: new Date().toISOString(),
  };
}
