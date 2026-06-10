import { BinanceApiResponse, TokenListData, SocialTopic, PriceInfo } from '../types/token';

const BASE_URL = process.env.BINANCE_BASE_URL || 'https://www.binance.com';
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

// 使用 undici 的 fetch + ProxyAgent 支持代理
const { fetch: undiciFetch, ProxyAgent } = require('undici');
let dispatcher: any = undefined;

if (PROXY_URL) {
  dispatcher = new ProxyAgent(PROXY_URL);
  console.log(`[API] 使用代理: ${PROXY_URL}`);
} else {
  console.log('[API] 直连模式（无代理）');
}

// ===== 请求队列 + Mutex（修复竞态条件） =====
const MIN_REQUEST_INTERVAL_MS = 1500; // 从 500ms 提升到 1500ms
let requestQueue: Array<() => void> = [];
let isProcessing = false;

async function processQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  while (requestQueue.length > 0) {
    const resolve = requestQueue.shift()!;
    resolve(); // 释放下一个请求
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS));
  }

  isProcessing = false;
}

// 串行化 throttle：所有请求排队，确保间隔
async function throttle(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestQueue.push(resolve);
    processQueue();
  });
}

// 429 指数退避重试
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 2000; // 2s → 4s → 8s → 16s

async function fetchWithRetry(url: string, options: any, retries = MAX_RETRIES): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await proxyFetch(url, options);

      if (resp.status === 429) {
        if (attempt < retries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[API] 429 限流，${delay}ms 后重试 (${attempt + 1}/${retries})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`HTTP 429: 重试 ${retries} 次后仍被限流`);
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      return resp;
    } catch (err: any) {
      if (err.message?.includes('429') && attempt < retries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[API] 429 异常，${delay}ms 后重试 (${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('fetchWithRetry: 不可达');
}

// 通用 fetch 包装（支持代理）
async function proxyFetch(url: string, options: any = {}): Promise<any> {
  const fetchOptions: any = {
    method: options.method || 'GET',
    headers: options.headers || { 'Content-Type': 'application/json' },
  };

  if (options.body) {
    fetchOptions.body = options.body;
  }

  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher;
  }

  return undiciFetch(url, fetchOptions);
}

// 获取热门代币列表
export async function fetchTokenList(
  chain: string = 'bsc',
  sort: string = 'trending',
  page: number = 1,
  size: number = 50
): Promise<TokenListData> {
  await throttle();

  const url = `${BASE_URL}/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list`;
  const body = { chain, sort, page, size };

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = (await resp.json()) as BinanceApiResponse<TokenListData>;

  if (json.code !== '000000' || !json.success) {
    throw new Error(`fetchTokenList API error: ${json.code} - ${json.message}`);
  }

  return json.data;
}

// Meme Rush 新币列表（rankType: 10）
export async function fetchMemeRushList(
  chainId: string = '56',
  size: number = 200,
  pageNo: number = 1,
  options: {
    launchTimeMin?: number;
    liquidityMin?: number;
    volumeMin?: number;
    countMin?: number;
    uniqueTraderMin?: number;
    tagFilter?: number[];
    sortBy?: number;
    period?: number;
  } = {}
): Promise<TokenListData> {
  await throttle();

  const url = `${BASE_URL}/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list`;
  const body = {
    rankType: 10,
    period: options.period || 30,
    chainId,
    launchTimeMin: options.launchTimeMin ?? 0,
    liquidityMin: options.liquidityMin ?? 0,
    volumeMin: options.volumeMin ?? 0,
    countMin: options.countMin ?? 0,
    tagFilter: options.tagFilter || [1, 2, 3],
    sortBy: options.sortBy || 4,  // 按上线时间排序（最新在前）
    size,
    pageNo,
    uniqueTraderMin: options.uniqueTraderMin ?? 0,
  };

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = (await resp.json()) as BinanceApiResponse<TokenListData>;

  if (json.code !== '000000' || !json.success) {
    throw new Error(`fetchMemeRushList API error: ${json.code} - ${json.message}`);
  }

  return json.data;
}

// 获取最新上线代币（新币发现流）
// launchTimeMax: 最大上线时间（分钟），用于获取近期新币
export async function fetchLatestTokens(
  chainId: string = '56',
  size: number = 50,
  launchTimeMaxMinutes: number = 1440  // 默认24小时
): Promise<TokenListData> {
  await throttle();

  const url = `${BASE_URL}/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list`;
  const body = {
    rankType: 10,
    period: 30,
    chainId,
    launchTimeMin: 0,       // 不限制上线时间，完整采集
    launchTimeMax: launchTimeMaxMinutes,  // 最大上线时间
    liquidityMin: 0,         // 不过滤流动性
    volumeMin: 0,            // 不过滤交易量
    countMin: 0,             // 不过滤交易次数
    tagFilter: [1, 2, 3],
    sortBy: 4,               // 按上线时间排序（最新在前）
    size,
    uniqueTraderMin: 0,      // 不过滤交易者数
  };

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = (await resp.json()) as BinanceApiResponse<TokenListData>;

  if (json.code !== '000000' || !json.success) {
    throw new Error(`fetchLatestTokens API error: ${json.code} - ${json.message}`);
  }

  return json.data;
}

// 获取多链代币列表
export async function fetchAllChainTokens(size: number = 50): Promise<TokenListData[]> {
  const chains = ['bsc', 'solana', 'base', 'eth'];
  const results: TokenListData[] = [];

  for (const chain of chains) {
    try {
      const data = await fetchTokenList(chain, 'trending', 1, size);
      results.push(data);
      console.log(`[API] ${chain}: 获取 ${data.tokens.length} 个代币, total=${data.total}`);
    } catch (err) {
      console.error(`[API] ${chain} 获取失败:`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}

// 获取社交热度话题
export async function fetchSocialTopics(
  chainId: string = '56',
  rankType: number = 10,
  sort: number = 10,
  topicType: string = 'Culture,Giants,Themes'
): Promise<SocialTopic[]> {
  await throttle();

  const params = new URLSearchParams({
    asc: 'false',
    chainId,
    favorites: '0',
    keywords: '',
    rankType: String(rankType),
    sort: String(sort),
    tokenSizeMin: '1',
    topicType,
  });

  const url = `${BASE_URL}/bapi/defi/v2/public/wallet-direct/buw/wallet/market/token/social-rush/rank/list/ai?${params}`;

  const resp = await fetchWithRetry(url, {});

  const json = (await resp.json()) as BinanceApiResponse<SocialTopic[]>;

  if (json.code !== '000000' || !json.success) {
    throw new Error(`fetchSocialTopics API error: ${json.code} - ${json.message}`);
  }

  return json.data;
}

// 获取价格信息
export async function fetchPriceInfo(chainId: string, contractAddress: string): Promise<PriceInfo> {
  await throttle();

  const params = new URLSearchParams({ chainId, contractAddress });
  const url = `${BASE_URL}/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/dynamic/info/ai?${params}`;

  const resp = await fetchWithRetry(url, {});

  const json = (await resp.json()) as BinanceApiResponse<PriceInfo>;

  if (json.code !== '000000' || !json.success) {
    throw new Error(`fetchPriceInfo API error: ${json.code} - ${json.message}`);
  }

  return json.data;
}

// ============ K线数据（OHLCV） ============
// 数据源：Binance Web3 K线 API（dquery.sintral.io）
// 返回格式：[[open, high, low, close, volume, timestamp_ms, trade_count], ...]

const KLINE_API_BASE = 'https://dquery.sintral.io/u-kline/v1/k-line/candles';

const CHAIN_TO_PLATFORM: Record<string, string> = {
  '56': 'bsc', 'bsc': 'bsc',
  '1': 'ethereum', 'eth': 'ethereum', 'ethereum': 'ethereum',
  '8453': 'base', 'base': 'base',
  'CT_501': 'solana', 'solana': 'solana',
};

// interval 映射：前端传值 → API 参数
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1min', '1min': '1min',
  '5m': '5min', '5min': '5min',
  '15m': '15min', '15min': '15min',
  '30m': '30min', '30min': '30min',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '8h': '8h',
  '12h': '12h',
  '1d': '1d', '24h': '1d',
  '3d': '3d',
  '1w': '1w', '7d': '1w',
  '1M': '1m', '30d': '1m',
};

export interface KLineCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  trades: number;
}

export async function fetchKlines(
  chainId: string,
  contractAddress: string,
  interval: string = '1h',
  limit: number = 100
): Promise<KLineCandle[]> {
  const platform = CHAIN_TO_PLATFORM[chainId.toLowerCase()];
  if (!platform) {
    throw new Error(`不支持的链: ${chainId}，支持: ${Object.keys(CHAIN_TO_PLATFORM).join(', ')}`);
  }

  const apiInterval = INTERVAL_MAP[interval] || '1h';
  const params = new URLSearchParams({
    platform,
    address: contractAddress,
    interval: apiInterval,
    limit: String(Math.min(Math.max(limit, 1), 1000)),
  });

  await throttle();

  const url = `${KLINE_API_BASE}?${params}`;
  const fetchOptions: any = {
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  };
  if (dispatcher) fetchOptions.dispatcher = dispatcher;

  const resp = await undiciFetch(url, fetchOptions);
  const json = await resp.json();

  if (!json.data || !Array.isArray(json.data)) {
    throw new Error('K线API返回格式异常');
  }

  // 转换为标准 OHLCV 格式
  return json.data.map((candle: number[]) => ({
    open: candle[0],
    high: candle[1],
    low: candle[2],
    close: candle[3],
    volume: candle[4],
    timestamp: candle[5],
    trades: candle[6] || 0,
  }));
}
