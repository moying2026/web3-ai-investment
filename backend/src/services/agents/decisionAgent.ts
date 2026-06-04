// 最终决策 Agent — 综合各 Agent 评分，给出最终建议
import { db } from '../../db/database';
import { THRESHOLDS } from '../../config/thresholds';
import { AgentEvaluateRequest, AgentEvaluateResult, DecisionResult } from './types';
import { evaluateRisk } from './riskAgent';
import { evaluateMarket } from './marketAgent';
import { evaluateIssuer } from './issuerAgent';
import { evaluateOnchain } from './onchainAgent';

interface SqliteStatement { get(...params: any[]): any; }

export function evaluateDecision(req: AgentEvaluateRequest): DecisionResult {
  const T = THRESHOLDS.decision;

  // 并行运行四个 Agent
  const risk = evaluateRisk(req);
  const market = evaluateMarket(req);
  const issuer = evaluateIssuer(req);
  const onchain = evaluateOnchain(req);

  // 计算流动性评分（直接从 token 数据）
  let liquidityScore = 10;
  const token = req.tokenData || null;
  if (token) {
    const holders = token.holders || 0;
    const liquidity = parseFloat(token.liquidity || '0');
    const volume24h = parseFloat(token.volume_24h || '0');
    const mc = parseFloat(token.market_cap || '0');

    if (holders >= 500) liquidityScore += 4;
    else if (holders >= 100) liquidityScore += 2;
    else liquidityScore -= 2;

    if (liquidity >= 100000) liquidityScore += 4;
    else if (liquidity >= 20000) liquidityScore += 2;
    else liquidityScore -= 3;

    if (volume24h >= 50000) liquidityScore += 3;
    else if (volume24h >= 10000) liquidityScore += 1;

    if (mc > 0 && mc < 50000) liquidityScore += 2;
    else if (mc > 1000000) liquidityScore -= 1;
  }
  liquidityScore = Math.max(0, Math.min(25, liquidityScore));

  // 加权计算综合评分
  const scores = { risk: risk.score, market: market.score, issuer: issuer.score, onchain: onchain.score, liquidity: liquidityScore };
  const weights = T.weights;
  const weightedScore =
    (scores.risk / 20) * weights.risk * 100 +
    (scores.market / 15) * weights.market * 100 +
    (scores.issuer / 15) * weights.issuer * 100 +
    (scores.onchain / 25) * weights.onchain * 100 +
    (scores.liquidity / 25) * weights.liquidity * 100;

  // 置信度：取各 Agent 最低置信度
  const confidences = [risk.confidence, market.confidence, issuer.confidence, onchain.confidence];
  const minConfidence = Math.min(...confidences);
  const overallConfidence = minConfidence < T.lowConfidenceThreshold ? minConfidence * 0.8 : minConfidence;

  // 推荐
  let recommendation: 'BUY' | 'HOLD' | 'WATCH' | 'AVOID' = 'AVOID';
  if (weightedScore >= T.buyThreshold) recommendation = 'BUY';
  else if (weightedScore >= T.holdThreshold) recommendation = 'HOLD';
  else if (weightedScore >= T.watchThreshold) recommendation = 'WATCH';

  // 风险降级：高风险标记多时降低推荐
  const highRiskCount = [...risk.riskFlags, ...onchain.riskFlags].filter(f => f.includes('⚠️')).length;
  if (highRiskCount >= 3 && recommendation !== 'AVOID') {
    recommendation = recommendation === 'BUY' ? 'HOLD' : 'WATCH';
  }

  const allRiskFlags = [...risk.riskFlags, ...market.riskFlags, ...issuer.riskFlags, ...onchain.riskFlags];
  const allHighlights = [...risk.highlights, ...market.highlights, ...issuer.highlights, ...onchain.highlights];

  const result: DecisionResult = {
    agentType: 'decision',
    score: Math.round(weightedScore),
    confidence: overallConfidence,
    details: { scores, weights, weightedScore: weightedScore.toFixed(1), highRiskCount },
    riskFlags: allRiskFlags,
    highlights: allHighlights,
    recommendation,
    subScores: { risk, market, issuer, onchain },
    scenario: 'new_coin',
    evaluatedAt: new Date().toISOString(),
  };

  return result;
}

// 存储所有 Agent 评分到数据库
export function storeAgentScores(chainId: string, contractAddress: string, decision: DecisionResult): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agent_scores (chain_id, contract_address, agent_type, score, confidence, details_json, evaluated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const agents: AgentEvaluateResult[] = [decision.subScores.risk, decision.subScores.market, decision.subScores.issuer, decision.subScores.onchain, decision];
  for (const agent of agents) {
    (stmt as any).run(chainId, contractAddress, agent.agentType, agent.score, agent.confidence, JSON.stringify(agent.details), agent.evaluatedAt);
  }
}
