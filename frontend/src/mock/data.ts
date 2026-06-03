// Mock 数据 — 仅用于模拟盘、AI推荐、持仓、历史交易等暂无真实 API 的功能
// Dashboard 和 TokenDetail 已对接真实后端，不再使用 mock 代币数据

import type { Position, Trade, AIRecommendation, PortfolioStats, PortfolioCurve, SimStats, Rule } from '../types';

// Mock持仓（模拟盘）
export const mockPositions: Position[] = [
  {
    id: '1',
    chain: 'solana',
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    side: 'long',
    amount: 1000000,
    entryPrice: 0.00001100,
    currentPrice: 0.00001234,
    pnl: 1340,
    pnlPercent: 12.18,
    stopLoss: 0.00000990,
    takeProfit: 0.00001500,
    openedAt: '2026-06-02T14:30:00Z',
  },
  {
    id: '2',
    chain: 'solana',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'WIF',
    side: 'long',
    amount: 500,
    entryPrice: 1.35,
    currentPrice: 1.23,
    pnl: -60,
    pnlPercent: -8.89,
    stopLoss: 1.10,
    openedAt: '2026-06-01T10:00:00Z',
  },
];

// Mock交易记录（模拟盘）
export const mockTrades: Trade[] = [
  {
    id: '1',
    chain: 'solana',
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    symbol: 'SMONK',
    side: 'buy',
    amount: 50000,
    price: 0.00200,
    total: 100,
    mode: 'ai',
    status: 'filled',
    createdAt: '2026-06-03T09:35:00Z',
  },
  {
    id: '2',
    chain: 'solana',
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    side: 'buy',
    amount: 1000000,
    price: 0.00001100,
    total: 1100,
    pnl: 1340,
    mode: 'manual',
    status: 'filled',
    createdAt: '2026-06-02T14:30:00Z',
  },
  {
    id: '3',
    chain: 'solana',
    address: 'SCAM1234567890abcdef1234567890abcdef12345678',
    symbol: 'SELM',
    side: 'buy',
    amount: 1000000,
    price: 0.00000005,
    total: 50,
    pnl: -49,
    mode: 'ai',
    status: 'filled',
    createdAt: '2026-06-03T08:05:00Z',
  },
];

// Mock AI推荐
export const mockRecommendations: AIRecommendation[] = [
  {
    id: '1',
    chain: '56',
    address: '0x4d41a5d412f4ef44a35b9f53b06db65ede249493',
    symbol: 'QAIT',
    name: 'Sealcoin',
    action: 'buy',
    confidence: 78,
    targetPrice: 0.05,
    stopLoss: 0.015,
    reasoning: 'AI分析板块代币，持有者增速快，社交媒体热度高',
    riskLevel: 'medium',
    createdAt: '2026-06-03T09:35:00Z',
  },
  {
    id: '2',
    chain: '56',
    address: '0x82ec31d69b3c289e541b50e30681fd1acad24444',
    symbol: '哈基米',
    name: '哈基米',
    action: 'hold',
    confidence: 65,
    targetPrice: 0.02,
    stopLoss: 0.01,
    reasoning: '短期回调，长期趋势看好，建议持有等待反弹',
    riskLevel: 'low',
    createdAt: '2026-06-03T08:00:00Z',
  },
  {
    id: '3',
    chain: '56',
    address: '0x000008d2175f9aeaddb2430c26f8a6f73c5a0000',
    symbol: 'UP',
    name: 'Unitas',
    action: 'buy',
    confidence: 82,
    targetPrice: 0.50,
    stopLoss: 0.30,
    reasoning: '白名单代币，流动性充足，市值较大，风险可控',
    riskLevel: 'low',
    createdAt: '2026-06-03T08:10:00Z',
  },
];

// Mock组合统计
export const mockPortfolioStats: PortfolioStats = {
  totalValue: 52340.56,
  availableBalance: 38000.00,
  todayPnl: 1280.34,
  todayPnlPercent: 2.51,
  totalPnl: 2340.56,
  totalPnlPercent: 4.68,
  winRate: 68.5,
  totalTrades: 47,
};

// Mock组合收益曲线
export const mockPortfolioCurve: PortfolioCurve[] = [
  { date: '05-20', value: 50000 },
  { date: '05-21', value: 50230 },
  { date: '05-22', value: 49870 },
  { date: '05-23', value: 51200 },
  { date: '05-24', value: 50890 },
  { date: '05-25', value: 51560 },
  { date: '05-26', value: 52100 },
  { date: '05-27', value: 51800 },
  { date: '05-28', value: 52450 },
  { date: '05-29', value: 52100 },
  { date: '05-30', value: 52890 },
  { date: '05-31', value: 52340 },
  { date: '06-01', value: 52670 },
  { date: '06-02', value: 52100 },
  { date: '06-03', value: 52340 },
];

// Mock模拟盘统计
export const mockSimStats: SimStats = {
  totalTrades: 156,
  winRate: 72.3,
  totalPnl: 8934.56,
  avgHoldTime: '4h 32m',
  bestTrade: mockTrades[1],
  worstTrade: mockTrades[2],
  dailyPnl: [
    { date: '05-28', pnl: 450 },
    { date: '05-29', pnl: -120 },
    { date: '05-30', pnl: 890 },
    { date: '05-31', pnl: 230 },
    { date: '06-01', pnl: 560 },
    { date: '06-02', pnl: -340 },
    { date: '06-03', pnl: 1280 },
  ],
};

// Mock规则
export const mockRules: Rule[] = [
  {
    id: '1',
    name: '骗局初筛',
    description: '识别潜在骗局代币',
    conditions: [
      { field: 'liquidity', operator: '<', value: 1000 },
      { field: 'holders', operator: '<', value: 50 },
    ],
    actions: [
      { type: 'alert', params: { level: 'high', message: '疑似骗局代币' } },
    ],
    enabled: true,
    hitCount: 23,
    accuracy: 95.6,
  },
  {
    id: '2',
    name: '短期热点捕捉',
    description: '捕捉短期高涨幅代币',
    conditions: [
      { field: 'priceChange1h', operator: '>', value: 50 },
      { field: 'volume1h', operator: '>', value: 100000 },
    ],
    actions: [
      { type: 'alert', params: { level: 'medium', message: '发现短期热点' } },
      { type: 'monitor', params: {} },
    ],
    enabled: true,
    hitCount: 45,
    accuracy: 78.2,
  },
  {
    id: '3',
    name: '聪明钱跟单',
    description: '跟踪聪明钱钱包动向',
    conditions: [
      { field: 'smartMoneyBuy', operator: '>', value: 3 },
    ],
    actions: [
      { type: 'alert', params: { level: 'medium', message: '聪明钱集体买入' } },
    ],
    enabled: true,
    hitCount: 12,
    accuracy: 83.3,
  },
];

// Mock发行方（模拟盘）
export const mockIssuers = [
  {
    address: '0xabc123...',
    name: 'Solana Labs',
    totalTokens: 15,
    successRate: 86.7,
    avgReturn: 234.5,
    scamCount: 0,
    tags: ['verified', 'bluechip'],
  },
  {
    address: '0xdef456...',
    name: 'Unknown Deployer',
    totalTokens: 8,
    successRate: 25.0,
    avgReturn: -45.2,
    scamCount: 5,
    tags: ['suspicious', 'scammer'],
  },
];
