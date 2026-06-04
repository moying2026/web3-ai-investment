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
  getRecommendations: () => Promise.resolve([]),
  getAnalysis: (_chain: string, _address: string) => Promise.resolve(null),
};

export const portfolioApi = {
  getStats: () => Promise.resolve(null),
  getCurve: (_days: number) => Promise.resolve([]),
};

export const simApi = {
  getStats: () => api.get<any, any>('/sim/stats'),
  getTrades: (params?: { page?: number; pageSize?: number; status?: string }) =>
    api.get<any, any>('/sim/trades', { params }),
};

export const ruleApi = {
  getList: () => Promise.resolve([]),
  create: (_rule: any) => Promise.resolve({ success: true }),
  update: (_id: string, _rule: any) => Promise.resolve({ success: true }),
  delete: (_id: string) => Promise.resolve({ success: true }),
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

export const smartMoneyApi = {
  getSignals: (params?: { page?: number; pageSize?: number }) =>
    api.get<any, PaginatedResponse<any>>('/smart-money/signals', { params }).catch(() => ({ data: [], total: 0, page: 1, pageSize: 20 })),
};

export default api;
