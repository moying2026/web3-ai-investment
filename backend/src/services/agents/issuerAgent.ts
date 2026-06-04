// 发行方分析 Agent — 历史、迁移率、频率
import { assessIssuerRisk } from '../tokenAnalyzer';
import { AgentEvaluateRequest, AgentEvaluateResult } from './types';

export function evaluateIssuer(req: AgentEvaluateRequest): AgentEvaluateResult {
  const { chainId, contractAddress } = req;
  const details: Record<string, any> = {};
  const riskFlags: string[] = [];
  const highlights: string[] = [];

  // 获取发行方地址
  const issuerAddress = req.issuerAddress;
  if (!issuerAddress) {
    return {
      agentType: 'issuer', score: 7, confidence: 0.2,
      details: { reason: '无发行方地址' }, riskFlags: ['无发行方历史数据'], highlights: [],
      evaluatedAt: new Date().toISOString(),
    };
  }

  const issuerRisk = assessIssuerRisk(issuerAddress);
  details.issuer = issuerRisk;

  let score = 7;
  const migrationRate = issuerRisk.migrationRate;

  if (migrationRate > 0.5) { score = 13; highlights.push(`发行方迁移率高: ${(migrationRate * 100).toFixed(0)}%`); }
  else if (migrationRate > 0.2) { score = 10; highlights.push(`发行方迁移率中等: ${(migrationRate * 100).toFixed(0)}%`); }
  else if (issuerRisk.totalTokens > 5) { score = 4; riskFlags.push(`发行方迁移率低: ${(migrationRate * 100).toFixed(0)}%`); }

  if (issuerRisk.totalTokens > 100) { score -= 2; riskFlags.push(`⚠️ 发行方代币数量多: ${issuerRisk.totalTokens}个`); }

  // 批量发币标记
  if (issuerRisk.riskLevel === 'high') {
    riskFlags.push(...issuerRisk.riskReasons);
    score -= 3;
  }

  if (issuerRisk.riskLevel === 'low' && issuerRisk.totalTokens > 0) {
    highlights.push('发行方信誉良好');
  }

  score = Math.max(0, Math.min(15, score));

  return {
    agentType: 'issuer', score, confidence: issuerRisk.confidence, details, riskFlags, highlights,
    evaluatedAt: new Date().toISOString(),
  };
}
