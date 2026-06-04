// 风险评估 Agent — 审计数据、合约风险
import { db } from '../../db/database';
import { THRESHOLDS } from '../../config/thresholds';
import { AgentEvaluateRequest, AgentEvaluateResult } from './types';

interface SqliteStatement { get(...params: any[]): any; }

export function evaluateRisk(req: AgentEvaluateRequest): AgentEvaluateResult {
  const { chainId, contractAddress } = req;
  const details: Record<string, any> = {};
  const riskFlags: string[] = [];
  const highlights: string[] = [];
  let score = 10;
  let dataPoints = 0;

  // 审计数据
  const audit = req.auditData || (db.prepare(
    'SELECT * FROM token_audit WHERE chain_id = ? AND contract_address = ?'
  ) as SqliteStatement).get(chainId, contractAddress) as any;

  if (audit) {
    dataPoints += 3;
    details.risk_level = audit.risk_level;
    details.buy_tax = audit.buy_tax;
    details.sell_tax = audit.sell_tax;
    details.is_verified = audit.is_verified;

    if (audit.risk_level === 1) { score = 18; highlights.push('合约审计风险低'); }
    else if (audit.risk_level === 2) { score = 10; }
    else if (audit.risk_level >= 3) { score = 3; riskFlags.push('⚠️ 合约审计风险高'); }

    if (audit.unusual_buy_tax || audit.unusual_sell_tax) {
      score -= 5; riskFlags.push('⚠️ 异常税率');
    }
    if (audit.buy_tax && parseFloat(audit.buy_tax) > 0.05) {
      score -= 3; riskFlags.push(`⚠️ 买入税率偏高: ${(parseFloat(audit.buy_tax) * 100).toFixed(1)}%`);
    }
    if (audit.is_verified) { score += 2; highlights.push('合约已验证'); }
  } else {
    riskFlags.push('未获取审计数据');
  }

  // 合约分析（从 tokens 表）
  const token = req.tokenData || (db.prepare(
    'SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?'
  ) as SqliteStatement).get(chainId, contractAddress) as any;

  if (token) {
    if (token.is_mintable) { score -= 2; riskFlags.push('可增发'); }
    if (token.is_upgradeable) { score -= 2; riskFlags.push('可升级'); }
    if (!token.is_mintable && !token.is_upgradeable) { score += 2; highlights.push('不可增发/升级'); }
    dataPoints += 2;
  }

  const confidence = Math.min(1, dataPoints / 4);
  score = Math.max(0, Math.min(20, score));

  return {
    agentType: 'risk', score, confidence, details, riskFlags, highlights,
    evaluatedAt: new Date().toISOString(),
  };
}
