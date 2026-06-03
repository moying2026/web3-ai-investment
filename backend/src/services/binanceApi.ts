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

// 请求间隔控制（避免限流）
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 200;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
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

  const resp = await proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`fetchTokenList HTTP ${resp.status}: ${resp.statusText}`);
  }

  const json = (await resp.json()) as BinanceApiResponse<TokenListData>;

  if (json.code !== '000000' || !json.success) {
    throw new Error(`fetchTokenList API error: ${json.code} - ${json.message}`);
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

  const url = `${BASE_URL}/bapi/defi/v2/public/wallet-direct/buw/wallet/market/token/social-rush/rank/list?${params}`;

  const resp = await proxyFetch(url);

  if (!resp.ok) {
    throw new Error(`fetchSocialTopics HTTP ${resp.status}: ${resp.statusText}`);
  }

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
  const url = `${BASE_URL}/bapi/defi/v1/public/wallet-direct/buw/wallet/token/price/info?${params}`;

  const resp = await proxyFetch(url);

  if (!resp.ok) {
    throw new Error(`fetchPriceInfo HTTP ${resp.status}: ${resp.statusText}`);
  }

  const json = (await resp.json()) as BinanceApiResponse<PriceInfo>;

  if (json.code !== '000000' || !json.success) {
    throw new Error(`fetchPriceInfo API error: ${json.code} - ${json.message}`);
  }

  return json.data;
}
