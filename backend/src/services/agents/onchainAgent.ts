// 链上分析 Agent — 地址分布、内幕检测
import { db } from '../../db/database';
import { scoreAddressRisk } from '../tokenAnalyzer';
import { AgentEvaluateRequest, AgentEvaluateResult } from './types';

interface SqliteStatement { get(...params: any[]): any; all(...params: any[]): any[]; }

export function evaluateOnchain(req: AgentEvaluateRequest): AgentEvaluateResult {
  const { chainId, contractAddress } = req;
  const details: Record<string, any> = {};
  const riskFlags: string[] = [];
  const highlights: string[] = [];

  const token = req.tokenData || (db.prepare(
    'SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?'
  ) as SqliteStatement).get(chainId, contractAddress) as any;

  if (!token) {
    return {
      agentType: 'onchain', score: 10, confidence: 0.2,
      details: { reason: '无代币数据' }, riskFlags: ['无链上数据'], highlights: [],
      evaluatedAt: new Date().toISOString(),
    };
  }

  // 地址风险评分
  const addrResult = scoreAddressRisk(token);
  let score = addrResult.score;
  riskFlags.push(...addrResult.riskFlags);
  highlights.push(...addrResult.highlights);

  // Smart Money 信号
  const smSignal = (db.prepare(`
    SELECT * FROM smart_money_signals
    WHERE chain_id = ? AND contract_address = ? AND direction = 'buy'
    ORDER BY signal_trigger_time DESC LIMIT 1
  `) as SqliteStatement).get(chainId, contractAddress) as any;

  if (smSignal) {
    score += 5;
    highlights.push(`Smart Money 买入信号: ${smSignal.smart_money_count}个地址`);
    details.smart_money_signal = {
      count: smSignal.smart_money_count,
      price: smSignal.alert_price,
      time: new Date(smSignal.signal_trigger_time * 1000).toISOString(),
    };
  }

  // 链上动态数据
  const dynamic = req.dynamicData || (db.prepare(
    'SELECT * FROM token_dynamic WHERE chain_id = ? AND contract_address = ?'
  ) as SqliteStatement).get(chainId, contractAddress) as any;

  if (dynamic) {
    details.dynamic = {
      smart_money_holders: dynamic.smart_money_holders,
      smart_money_holding_percent: dynamic.smart_money_holding_percent,
      dev_holding_percent: dynamic.dev_holding_percent,
      top10_holders_percent: dynamic.top10_holders_percent,
    };
  }

  score = Math.max(0, Math.min(25, score));

  return {
    agentType: 'onchain', score, confidence: addrResult.confidence, details, riskFlags, highlights,
    evaluatedAt: new Date().toISOString(),
  };
}
