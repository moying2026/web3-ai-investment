/**
 * 系统日志服务 — 内存环形缓冲区 + SSE 实时推送
 *
 * 日志级别: info, warn, error, debug
 * 日志来源: 数据采集轮询、AI评估、模拟交易、代理检测等所有后端运行模块
 * 日志格式: {timestamp, level, module, message}
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: string;   // ISO 8601
  level: LogLevel;
  module: string;
  message: string;
}

// ============ 内存环形缓冲区 ============

const MAX_LOGS = 500;          // 缓冲区容量
const logBuffer: LogEntry[] = [];  // 环形缓冲区

function pushLog(entry: LogEntry): void {
  if (logBuffer.length >= MAX_LOGS) {
    logBuffer.shift(); // 移除最旧的
  }
  logBuffer.push(entry);
  broadcastLog(entry);
}

// ============ SSE 客户端管理 ============

const sseClients: Set<(data: string) => void> = new Set();

function broadcastLog(entry: LogEntry): void {
  const msg = `data: ${JSON.stringify(entry)}\n\n`;
  for (const send of sseClients) {
    try { send(msg); } catch { sseClients.delete(send); }
  }
}

/**
 * 注册一个 SSE 客户端，返回注销函数
 */
export function addLogSSEClient(send: (data: string) => void): () => void {
  sseClients.add(send);
  return () => sseClients.delete(send);
}

/**
 * 获取当前 SSE 客户端数量
 */
export function getLogSSEClientCount(): number {
  return sseClients.size;
}

// ============ 公共日志写入 API ============

/**
 * 写入一条日志（供各模块调用）
 */
export function log(level: LogLevel, module: string, message: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
  };
  // 同时输出到控制台
  const prefix = `[${level.toUpperCase()}][${module}]`;
  switch (level) {
    case 'error': console.error(prefix, message); break;
    case 'warn':  console.warn(prefix, message);  break;
    case 'debug': console.debug(prefix, message); break;
    default:      console.log(prefix, message);   break;
  }
  pushLog(entry);
}

/** 便捷方法 */
export function logInfo(module: string, message: string): void  { log('info',  module, message); }
export function logWarn(module: string, message: string): void  { log('warn',  module, message); }
export function logError(module: string, message: string): void { log('error', module, message); }
export function logDebug(module: string, message: string): void { log('debug', module, message); }

/**
 * 获取最近 N 条日志（用于页面加载时回显）
 */
export function getRecentLogs(count: number = 100): LogEntry[] {
  return logBuffer.slice(-count);
}

/**
 * 获取当前缓冲区大小
 */
export function getLogBufferSize(): number {
  return logBuffer.length;
}
