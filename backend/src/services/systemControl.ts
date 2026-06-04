// 系统控制模块 — 管理各模块的启停状态
import { db } from '../db/database';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

// 模块定义
export interface ModuleStatus {
  id: string;
  name: string;
  running: boolean;
  intervalMs: number;
  lastRun: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  successCount: number;
  failCount: number;
  metrics: Record<string, any>;
}

// 内存中的模块状态
const moduleStates: Map<string, {
  running: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  lastRun: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  successCount: number;
  failCount: number;
  metrics: Record<string, any>;
}> = new Map();

// 初始化模块状态表
export function initSystemControl(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS system_modules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    running INTEGER DEFAULT 1,
    interval_ms INTEGER NOT NULL,
    last_run TEXT,
    last_success TEXT,
    last_error TEXT,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    metrics_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  console.log('[System] 系统控制模块初始化完成');
}

// 注册模块
export function registerModule(id: string, name: string, intervalMs: number): void {
  // 初始化内存状态
  moduleStates.set(id, {
    running: true,
    intervalId: null,
    lastRun: null,
    lastSuccess: null,
    lastError: null,
    successCount: 0,
    failCount: 0,
    metrics: {},
  });

  // 更新数据库（使用 INSERT OR REPLACE 确保更新间隔）
  db.prepare(`
    INSERT OR REPLACE INTO system_modules (id, name, running, interval_ms, success_count, fail_count)
    VALUES (?, ?, 1, ?, 0, 0)
  `).run(id, name, intervalMs);

  console.log(`[System] 注册模块: ${id} (${name}) interval=${intervalMs}ms`);
}

// 记录运行结果
export function recordRun(id: string, success: boolean, error?: string, metrics?: Record<string, any>): void {
  const state = moduleStates.get(id);
  if (!state) return;

  const now = new Date().toISOString();
  state.lastRun = now;

  if (success) {
    state.lastSuccess = now;
    state.successCount++;
  } else {
    state.lastError = error || 'Unknown error';
    state.failCount++;
  }

  if (metrics) {
    state.metrics = { ...state.metrics, ...metrics };
  }

  // 更新数据库
  db.prepare(`
    UPDATE system_modules SET
      last_run = ?, last_success = ?, last_error = ?,
      success_count = ?, fail_count = ?, metrics_json = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    state.lastRun,
    state.lastSuccess,
    state.lastError,
    state.successCount,
    state.failCount,
    JSON.stringify(state.metrics),
    id
  );
}

// 获取模块状态
export function getModuleStatus(id: string): ModuleStatus | null {
  const state = moduleStates.get(id);
  if (!state) return null;

  const dbRecord = db.prepare('SELECT * FROM system_modules WHERE id = ?').get(id) as any;

  return {
    id,
    name: dbRecord?.name || id,
    running: state.running,
    intervalMs: dbRecord?.interval_ms || 0,
    lastRun: state.lastRun,
    lastSuccess: state.lastSuccess,
    lastError: state.lastError,
    successCount: state.successCount,
    failCount: state.failCount,
    metrics: state.metrics,
  };
}

// 获取所有模块状态
export function getAllModuleStatuses(): ModuleStatus[] {
  const statuses: ModuleStatus[] = [];
  for (const [id] of moduleStates) {
    const status = getModuleStatus(id);
    if (status) statuses.push(status);
  }
  return statuses;
}

// 切换模块状态
export function toggleModule(id: string, running: boolean): boolean {
  const state = moduleStates.get(id);
  if (!state) return false;

  state.running = running;

  // 更新数据库
  db.prepare('UPDATE system_modules SET running = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(running ? 1 : 0, id);

  console.log(`[System] 模块 ${id} ${running ? '启动' : '暂停'}`);
  return true;
}

// 检查模块是否运行中
export function isModuleRunning(id: string): boolean {
  const state = moduleStates.get(id);
  return state?.running ?? false;
}

// 设置模块的 intervalId（用于暂停时清除）
export function setModuleIntervalId(id: string, intervalId: ReturnType<typeof setInterval>): void {
  const state = moduleStates.get(id);
  if (state) {
    state.intervalId = intervalId;
  }
}

// 获取模块的 intervalId
export function getModuleIntervalId(id: string): ReturnType<typeof setInterval> | null {
  const state = moduleStates.get(id);
  return state?.intervalId ?? null;
}
