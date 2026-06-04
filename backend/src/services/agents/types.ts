// Agent 评分类型定义
export interface AgentEvaluateRequest {
  chainId: string;
  contractAddress: string;
  symbol?: string;
  tokenData?: any;
  auditData?: any;
  dynamicData?: any;
  issuerAddress?: string;
}

export interface AgentEvaluateResult {
  agentType: 'risk' | 'market' | 'issuer' | 'onchain' | 'decision';
  score: number;
  confidence: number;
  details: Record<string, any>;
  riskFlags: string[];
  highlights: string[];
  evaluatedAt: string;
}

export interface DecisionResult extends AgentEvaluateResult {
  agentType: 'decision';
  recommendation: 'BUY' | 'HOLD' | 'WATCH' | 'AVOID';
  subScores: {
    risk: AgentEvaluateResult;
    market: AgentEvaluateResult;
    issuer: AgentEvaluateResult;
    onchain: AgentEvaluateResult;
  };
  triggerRule?: string;
  scenario: 'new_coin' | 'trending' | 'anomaly';
}
