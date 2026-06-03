// Binance Web3 API 响应类型定义

export interface BinanceToken {
  chainId: string;
  contractAddress: string;
  symbol: string;
  icon: string;
  links: Array<{ label: string; link: string }>;
  previewLink: Record<string, any>;
  price: string;
  percentChange1m: string;
  percentChange5m: string;
  percentChange1h: string;
  percentChange4h: string;
  percentChange24h: string;
  volume1m: string;
  volume5m: string;
  volume1h: string;
  volume4h: string;
  volume24h: string;
  volume24hBuy: string;
  volume24hSell: string;
  count1m: string;
  count5m: string;
  count1h: string;
  count4h: string;
  count24h: string;
  count24hBuy: string;
  count24hSell: string;
  uniqueTrader24h: string;
  uniqueTrader4h: string;
  uniqueTrader1h: string;
  uniqueTrader5m: string;
  uniqueTrader1m: string;
  liquidity: string;
  holders: string;
  marketCap: string;
  launchTime: string;
  tokenTag: Record<string, Array<{ tagName: string }>>;
  auditInfo: {
    riskLevel: number;
    riskCodes: string[];
    riskNum: number;
    cautionNum: number;
  };
  alphaInfo?: any;
  metaInfo: {
    originSymbol: string;
    originName: string;
    name: string;
    decimals: number;
    lsdFlag: number;
    aiNarrativeFlag: number;
    createTime: number;
    blacklist: boolean;
    whitelist: boolean;
    creatorAddress: string;
  };
  kycHolders: string;
  holdersTop10Percent: string;
  smartMoneyHoldingPercent: number;
  kolHoldingPercent: number;
  devHoldingPercent: number;
  proHoldersPercent: number;
  newAddressHoldersPercent: number;
  bundlesHoldingPercent: number;
  searchCount24h: string;
  chart24h?: string;
  asterPair: string;
  decimals: number;
  devTokens?: number | null;
  devMigrated?: number | null;
  devMigratedPercent?: number | null;
  chart1m?: string | null;
  chart5m?: string | null;
  chart1h?: string | null;
  chart4h?: string | null;
}

export interface BinanceApiResponse<T> {
  code: string;
  message: string | null;
  messageDetail: string | null;
  success: boolean;
  data: T;
}

export interface TokenListData {
  total: number;
  page: number;
  size: number;
  tokens: BinanceToken[];
}

export interface SocialTopic {
  topicId: string;
  chainId: string;
  name: {
    topicNameEn: string;
    topicNameCn: string;
  };
  type: string;
  close: number;
  topicLink: string;
  createTime: number;
  risingTime: number | null;
  viralTime: number | null;
  tokenSize: number;
  progress: string;
  aiSummary: {
    aiSummaryEn: string;
    aiSummaryCn: string;
  };
  topicNetInflow: string;
  topicNetInflow1h: string;
  topicNetInflowAth: string;
  deepAnalysisFlag: number;
  topicTags: string[];
  tokenList: Array<{
    chainId: string;
    contractAddress: string;
    symbol: string;
    icon: string;
    createTime: number;
    decimals: number;
    previewLink: Record<string, any>;
    netInflow: string;
    volumeBuy: string;
    volumeSell: string;
    netInflow1h: string;
    marketCap: string;
    priceChange24h: string;
    liquidity: string;
    protocol: number;
    internal: number;
    migrateStatus: number;
    uniqueTrader24h: number;
    count24h: number;
    holders: number;
    kolHolders: number | null;
    smartMoneyHolders: number | null;
    smartMoneyHoldingPercent: number | null;
    devHoldingPercent: number | null;
    sniperHoldersPercent: number | null;
    insiderHoldingPercent: number | null;
  }>;
}

export interface PriceInfo {
  price: string;
  percentChange24h: string;
  timestamp: number | null;
}

// 快照类型
export type SnapshotType = '5m' | '1h' | '2h' | '4h' | '24h' | '3d' | '7d';

// 追踪计划
export interface TrackingPlan {
  chainId: string;
  contractAddress: string;
  snapshotType: SnapshotType;
  targetTime: number; // 计划采集时间的时间戳
}

// SSE 新币事件
export interface NewTokenEvent {
  type: 'new_token';
  token: BinanceToken;
  detectedAt: string;
}

// 统计数据
export interface Stats {
  totalTokens: number;
  todayNewTokens: number;
  totalSnapshots: number;
  totalSocialTopics: number;
  trackingActive: number;
  lastPollTime: string | null;
}
