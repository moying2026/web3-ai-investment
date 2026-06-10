// 代理管理服务 — 运行时动态切换代理，无需重启进程
import { db } from '../db/database';

const { fetch: undiciFetch, ProxyAgent } = require('undici');

// 当前代理状态
let currentProxyUrl: string = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
let currentDispatcher: any = currentProxyUrl ? new ProxyAgent(currentProxyUrl) : undefined;
let proxyEnabled: boolean = !!currentProxyUrl;
let lastCheckTime: string | null = null;
let lastCheckResult: boolean | null = null;

// 初始化数据库表
function initProxyTable(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS proxy_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // 从数据库恢复配置
  const row = db.prepare('SELECT value FROM proxy_config WHERE key = ?').get('proxy_url') as any;
  if (row) {
    currentProxyUrl = row.value;
    const enabledRow = db.prepare('SELECT value FROM proxy_config WHERE key = ?').get('proxy_enabled') as any;
    proxyEnabled = enabledRow ? enabledRow.value === 'true' : true;
    if (proxyEnabled && currentProxyUrl) {
      currentDispatcher = new ProxyAgent(currentProxyUrl);
    }
  }
}

// 获取当前代理 dispatcher（供 binanceApi / binanceExtendedApi 使用）
export function getDispatcher(): any {
  return proxyEnabled ? currentDispatcher : undefined;
}

// 获取代理状态
export function getProxyStatus(): {
  enabled: boolean;
  address: string;
  lastCheckTime: string | null;
  lastCheckResult: boolean | null;
} {
  return {
    enabled: proxyEnabled,
    address: currentProxyUrl,
    lastCheckTime,
    lastCheckResult,
  };
}

// 设置代理
export function setProxy(address: string, enabled: boolean): {
  success: boolean;
  message: string;
} {
  try {
    // 保存到数据库
    db.prepare(`INSERT OR REPLACE INTO proxy_config (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run('proxy_url', address);
    db.prepare(`INSERT OR REPLACE INTO proxy_config (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run('proxy_enabled', String(enabled));

    currentProxyUrl = address;
    proxyEnabled = enabled;

    // 动态切换 dispatcher
    if (enabled && address) {
      currentDispatcher = new ProxyAgent(address);
      console.log(`[Proxy] 已启用代理: ${address}`);
    } else {
      currentDispatcher = undefined;
      console.log(`[Proxy] 已禁用代理`);
    }

    return { success: true, message: `代理已${enabled ? '启用' : '禁用'}: ${address}` };
  } catch (err: any) {
    return { success: false, message: `设置失败: ${err.message}` };
  }
}

// 测试代理连通性
export async function testProxy(): Promise<{
  success: boolean;
  latencyMs: number;
  message: string;
}> {
  const start = Date.now();
  try {
    const fetchOptions: any = {
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    };
    if (proxyEnabled && currentDispatcher) {
      fetchOptions.dispatcher = currentDispatcher;
    }

    const resp = await undiciFetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1', fetchOptions);
    const latencyMs = Date.now() - start;

    if (resp.ok) {
      lastCheckTime = new Date().toISOString();
      lastCheckResult = true;
      return { success: true, latencyMs, message: `连通正常 (${latencyMs}ms)` };
    } else {
      lastCheckTime = new Date().toISOString();
      lastCheckResult = false;
      return { success: false, latencyMs, message: `HTTP ${resp.status}` };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    lastCheckTime = new Date().toISOString();
    lastCheckResult = false;
    return { success: false, latencyMs, message: err.message || '连接失败' };
  }
}

// 初始化
initProxyTable();
console.log(`[Proxy] 初始化: ${proxyEnabled ? '启用' : '禁用'} ${currentProxyUrl || '(无)'}`);
