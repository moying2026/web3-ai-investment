// ===== 后端 API 返回的真实类型 =====

// 代币信息（后端 /api/tokens 返回）
export interface Token {
  id: number;
  chain_id: string;
  contract_address: string;
  symbol: string;
  icon?: string;
  links?: string; // JSON string
  preview_link?: string; // JSON string
  decimals: number;
  price_first: string;
  price_latest: string;
  percent_change_1m: string;
  percent_change_5m: string;
  percent_change_1h: string;
  percent_change_4h: string;
  percent_change_24h: string;
  volume_1m: string;
  volume_5m: string;
  volume_1h: string;
  volume_4h: string;
  volume_24h: string;
  volume_24h_buy: string;
  volume_24h_sell: string;
  count_1m: number;
  count_5m: number;
  count_1h: number;
  count_4h: number;
  count_24h: number;
  unique_trader_24h: number;
  unique_trader_1h: number;
  liquidity: string;
  holders: number;
  market_cap: string;
  launch_time: number;
  token_tag?: string; // JSON string
  audit_info?: string; // JSON string
  meta_info?: string; // JSON string
  kyc_holders?: number;
  holders_top10_percent?: string;
  smart_money_holding_percent?: number;
  kol_holding_percent?: number;
  dev_holding_percent?: number | null;
  pro_holders_percent?: number;
  new_address_holders_percent?: number;
  bundles_holding_percent?: number;
  search_count_24h?: number;
  creator_address?: string;
  origin_name?: string;
  blacklist?: number;
  whitelist?: number;
  ai_narrative_flag?: number;
  first_seen_at?: string;
  created_at: string;
  updated_at: string;
}

// 统计数据（后端 /api/stats 返回）
export interface Stats {
  totalTokens: number;
  todayNewTokens: number;
  totalSnapshots: number;
  totalSocialTopics: number;
  trackingActive: number;
  lastPollTime: string;
}

// 社交话题
export interface SocialTopic {
  id: number;
  topic_id: string;
  chain_id: string;
  topic_name_en: string;
  topic_name_cn: string;
  topic_type: string;
  topic_link: string;
  topic_tags: string[];
  create_time: number;
  rising_time: number | null;
  viral_time: number | null;
  ai_summary_en: string;
  ai_summary_cn: string;
  topic_net_inflow: string;
  topic_net_inflow_1h: string;
  topic_net_inflow_ath: string;
  token_size: number;
  token_list: any[];
  contract_addresses: string[];
}

// 快照数据
export interface Snapshot {
  id: number;
  token_id: number;
  price: string;
  volume: string;
  holders: number;
  liquidity: string;
  market_cap: string;
  created_at: string;
}

// 健康检查
export interface HealthStatus {
  status: string;
  uptime: number;
  lastPollTime: string;
  sseClients: number;
  timestamp: string;
}

// API 通用响应
export interface ApiResponse<T> {
  code: number;
  data: T;
  message?: string;
}

// 分页响应
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ===== 前端 Mock 保留类型 =====

// K线数据
export interface KLineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 持仓信息（模拟盘）
export interface Position {
  id: string;
  chain: string;
  address: string;
  symbol: string;
  side: 'long' | 'short';
  amount: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: string;
}

// 交易记录（模拟盘）
export interface Trade {
  id: string;
  chain: string;
  address: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  total: number;
  pnl?: number;
  mode: 'ai' | 'manual';
  status: 'pending' | 'filled' | 'cancelled';
  createdAt: string;
}

// AI推荐
export interface AIRecommendation {
  id: string;
  chain: string;
  address: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell' | 'hold' | 'watch';
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: string;
}

// 组合统计（模拟盘）
export interface PortfolioStats {
  totalValue: number;
  availableBalance: number;
  todayPnl: number;
  todayPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  totalTrades: number;
}

// 规则引擎
export interface Rule {
  id: string;
  name: string;
  description: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  enabled: boolean;
  hitCount: number;
  accuracy: number;
}

export interface RuleCondition {
  field: string;
  operator: '>' | '<' | '=' | 'contains' | 'between';
  value: any;
}

export interface RuleAction {
  type: 'alert' | 'buy' | 'sell' | 'monitor';
  params: Record<string, any>;
}

// SSE事件
export interface SSEEvent {
  type: 'new_token' | 'price_update' | 'alert' | 'trade_signal';
  data: any;
  timestamp: string;
}

// 收益曲线
export interface PortfolioCurve {
  date: string;
  value: number;
}

// 模拟盘统计
export interface SimStats {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  avgHoldTime: string;
  bestTrade: Trade;
  worstTrade: Trade;
  dailyPnl: { date: string; pnl: number }[];
}
