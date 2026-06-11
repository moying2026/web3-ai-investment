import axios from 'axios';
import type { Token, Stats, SocialTopic, Snapshot, HealthStatus, PaginatedResponse } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// 响应拦截：统一处理 { code, data } 格式
api.interceptors.response.use(
  (res) => res.data?.data ?? res.data,
  (err) => Promise.reject(err)
);

// ===== 真实 API =====

// 代币列表
export const tokenApi = {
  getList: (params?: {
    page?: number; pageSize?: number; chain?: string; symbol?: string;
    launch_within?: string; creator?: string; risk_level?: string;
    holders_min?: number; holders_max?: number;
    liquidity_min?: number; liquidity_max?: number;
    sortBy?: string; sortOrder?: string;
  }) => api.get<any, PaginatedResponse<Token>>('/tokens', { params }),
  getDetail: (chain: string, address: string) =>
    api.get<any, Token>(`/tokens/${chain}/${address}`),
  getSnapshots: (chain: string, address: string) =>
    api.get<any, Snapshot[]>(`/tokens/${chain}/${address}/snapshots`),
  /** K线数据（OHLCV） */
  getKlines: (chain: string, address: string, interval?: string, limit?: number) =>
    api.get<any, Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>>(
      `/tokens/${chain}/${address}/klines`,
      { params: { interval: interval ?? 'D', limit: limit ?? 100 } }
    ),
};

// 统计数据
export const statsApi = {
  get: () => api.get<any, Stats>('/stats'),
};

// 社交话题
export const socialApi = {
  getTopics: (params?: { page?: number; pageSize?: number }) =>
    api.get<any, PaginatedResponse<SocialTopic>>('/social-topics', { params }),
};

// 健康检查
export const healthApi = {
  check: () => api.get<any, HealthStatus>('/health'),
};

// SSE 连接（新币推送）
export const createNewTokenSSE = () => new EventSource('/api/stream/new-tokens');

// ===== Mock 保留（模拟盘/AI推荐/规则引擎） =====

export const tradingApi = {
  getPositions: () => Promise.resolve([]),
  getHistory: () => Promise.resolve([]),
  placeOrder: (_order: any) => Promise.resolve({ success: true }),
  closePosition: (_id: string) => Promise.resolve({ success: true }),
};

export const aiApi = {
  getRecommendations: (params?: { page?: number; pageSize?: number }) =>
    api.get<any, any>('/analysis', { params }).catch(() => ({ data: [], total: 0, page: 1, pageSize: 20 })),
  getAnalysis: (_chain: string, _address: string) =>
    api.get(`/tokens/${_chain}/${_address}/audit`).catch(() => null),
};

export const portfolioApi = {
  getStats: () => Promise.resolve(null),
  getCurve: (_days: number) => Promise.resolve([]),
};

export const simApi = {
  getStats: () => api.get<any, any>('/sim/stats'),
  getTrades: (params?: { page?: number; pageSize?: number; status?: string }) =>
    api.get<any, any>('/sim/trades', { params }),
  getDailyPnl: (days?: number) =>
    api.get<any, any>('/sim/daily-pnl', { params: { days: days ?? 30 } }),
};

export const ruleApi = {
  getAnalysis: () => api.get<any, any>('/ai/analysis').catch(() => null),
  getAccuracy: () => api.get<any, any>('/sim/accuracy').catch(() => null),
  getSimStats: () => api.get<any, any>('/sim/stats').catch(() => null),
};

export const issuerApi = {
  getProfile: (_address: string) => Promise.resolve(null),
  getList: () => Promise.resolve([]),
};

// ===== 新增 API（合约审计 / 实时动态 / Smart Money） =====

export const auditApi = {
  get: (chain: string, address: string) =>
    api.get(`/tokens/${chain}/${address}/audit`).catch(() => null),
};

export const dynamicApi = {
  get: (chain: string, address: string) =>
    api.get(`/tokens/${chain}/${address}/dynamic`).catch(() => null),
};

// ===== P0 规则引擎 API =====

export const tokenAnalyzerApi = {
  getSimilar: (chain: string, address: string) =>
    api.get(`/tokens/${chain}/${address}/similar`).catch(() => null),
  getAddressRisk: (chain: string, address: string) =>
    api.get(`/tokens/${chain}/${address}/address-risk`).catch(() => null),
  getAgentScore: (chain: string, address: string) =>
    api.get(`/agents/score/${chain}/${address}`).catch(() => null),
};

export const issuerRiskApi = {
  getRisk: (address: string) =>
    api.get(`/issuer/${address}/risk`).catch(() => null),
};

// ===== 系统控制 API =====

export const systemApi = {
  getStatus: () => api.get<any, any>('/system/status').catch(() => []),
  toggle: (moduleId: string, running: boolean) =>
    api.post(`/system/${moduleId}/toggle`, { running }),
  toggleAll: (running: boolean) =>
    api.post('/system/toggle-all', { running }),
  getProxy: () => api.get<any, any>('/system/proxy').catch(() => ({ enabled: false, address: '', lastCheckTime: null, lastCheckResult: null })),
  setProxy: (enabled: boolean, address: string) =>
    api.post('/system/proxy', { enabled, address }),
  testProxy: () => api.post<any, any>('/system/proxy/test', {}).catch(() => ({ success: false, message: '测试失败' })),
  // 日志相关
  getLogHistory: () => api.get<any, any[]>('/system/logs/history').catch(() => []),
  // SSE 日志流通过 EventSource 直连，不走 axios
};

export const smartMoneyApi = {
  getSignals: (params?: { page?: number; pageSize?: number }) =>
    api.get<any, PaginatedResponse<any>>('/smart-money/signals', { params }).catch(() => ({ data: [], total: 0, page: 1, pageSize: 20 })),
};

// ===== AI 讨论面板 API =====

export const discussionApi = {
  /** 触发多 Agent 讨论 */
  start: (chain: string, contract: string) =>
    api.post<any, any>(`/agents/discuss/${chain}/${contract}`),
  /** 获取历史讨论记录 */
  getList: (chain: string, contract: string) =>
    api.get<any, any[]>(`/agents/discussions/${chain}/${contract}`).catch(() => []),
};

export default api;
