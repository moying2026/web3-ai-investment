// 钱包智能服务 - KOL/Smart Money/鲸鱼钱包跟踪监控
import { db } from '../db/database';
import { logInfo, logError } from './logService';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

interface WalletProfile {
  chain_id: string;
  address: string;
  wallet_type: string;
  label: string;
  label_source: string;
  total_trades: number;
  win_rate: number;
  avg_profit: number;
  avg_hold_hours: number;
  trust_score: number;
}

interface SmartMoneyScore {
  score: number;
  win_rate: number;
  avg_profit: number;
  avg_loss: number;
  profit_loss_ratio: number;
  trade_count: number;
}

interface AlertConfig {
  wallet_address: string;
  chain_id: string;
  alert_on_buy: boolean;
  alert_on_sell: boolean;
  alert_threshold_usd: number;
  priority: string;
}

// Smart Money识别算法
export function identifySmartMoney(address: string, chainId: string): SmartMoneyScore {
  // 获取该地址的所有交易
  const trades = (db.prepare(`
    SELECT * FROM wallet_trades 
    WHERE wallet_address = ? AND chain_id = ?
    ORDER BY trade_time DESC
  `) as SqliteStatement).all(address, chainId) as any[];
  
  if (trades.length < 10) {
    return {
      score: 0,
      win_rate: 0,
      avg_profit: 0,
      avg_loss: 0,
      profit_loss_ratio: 0,
      trade_count: trades.length
    };
  }
  
  // 计算胜率
  const wins = trades.filter((t: any) => t.pnl > 0).length;
  const winRate = wins / trades.length;
  
  // 计算平均盈利
  const profits = trades.filter((t: any) => t.pnl > 0).map((t: any) => t.pnl_percent);
  const avgProfit = profits.length > 0 ? profits.reduce((a: number, b: number) => a + b, 0) / profits.length : 0;
  
  // 计算平均亏损
  const losses = trades.filter((t: any) => t.pnl < 0).map((t: any) => Math.abs(t.pnl_percent));
  const avgLoss = losses.length > 0 ? losses.reduce((a: number, b: number) => a + b, 0) / losses.length : 0;
  
  // 计算盈亏比
  const profitLossRatio = avgLoss > 0 ? avgProfit / avgLoss : 0;
  
  // 综合评分
  let score = 0;
  if (winRate > 0.6) score += 30;
  if (avgProfit > 50) score += 30;
  if (profitLossRatio > 2) score += 20;
  if (trades.length > 100) score += 20;
  
  return {
    score,
    win_rate: winRate,
    avg_profit: avgProfit,
    avg_loss: avgLoss,
    profit_loss_ratio: profitLossRatio,
    trade_count: trades.length
  };
}

// 获取或创建钱包画像
export function getOrCreateWalletProfile(chainId: string, address: string): WalletProfile {
  const existing = (db.prepare(
    'SELECT * FROM wallet_profiles WHERE chain_id = ? AND address = ?'
  ) as SqliteStatement).get(chainId, address) as WalletProfile | undefined;
  
  if (existing) return existing;
  
  // 创建新画像
  (db.prepare(`
    INSERT INTO wallet_profiles (chain_id, address, wallet_type, created_at, updated_at)
    VALUES (?, ?, 'unknown', datetime('now'), datetime('now'))
  `) as SqliteStatement).run(chainId, address);
  
  return (db.prepare(
    'SELECT * FROM wallet_profiles WHERE chain_id = ? AND address = ?'
  ) as SqliteStatement).get(chainId, address) as WalletProfile;
}

// 更新钱包统计数据
export function updateWalletStats(chainId: string, address: string): void {
  const trades = (db.prepare(`
    SELECT * FROM wallet_trades 
    WHERE wallet_address = ? AND chain_id = ?
  `) as SqliteStatement).all(address, chainId) as any[];
  
  if (trades.length === 0) return;
  
  // 计算统计数据
  const wins = trades.filter((t: any) => t.pnl > 0).length;
  const winRate = trades.length > 0 ? wins / trades.length : 0;
  
  const profits = trades.filter((t: any) => t.pnl > 0).map((t: any) => t.pnl_percent);
  const avgProfit = profits.length > 0 ? profits.reduce((a: number, b: number) => a + b, 0) / profits.length : 0;
  
  const holdHours = trades.map((t: any) => t.hold_hours || 0);
  const avgHoldHours = holdHours.length > 0 ? holdHours.reduce((a: number, b: number) => a + b, 0) / holdHours.length : 0;
  
  // 计算信任评分
  let trustScore = 0;
  if (winRate > 0.6) trustScore += 30;
  if (avgProfit > 30) trustScore += 30;
  if (trades.length > 50) trustScore += 20;
  if (avgHoldHours > 24) trustScore += 20; // 长线持有
  
  // 更新数据库
  (db.prepare(`
    UPDATE wallet_profiles SET
      total_trades = ?,
      win_rate = ?,
      avg_profit = ?,
      avg_hold_hours = ?,
      trust_score = ?,
      last_active_at = (SELECT MAX(trade_time) FROM wallet_trades WHERE wallet_address = ? AND chain_id = ?),
      updated_at = datetime('now')
    WHERE chain_id = ? AND address = ?
  `) as SqliteStatement).run(
    trades.length,
    winRate,
    avgProfit,
    avgHoldHours,
    Math.min(trustScore, 100),
    address,
    chainId,
    chainId,
    address
  );
  
  logInfo('钱包智能', `更新 ${address.slice(0, 10)}... 统计: ${trades.length}笔交易, 胜率${(winRate * 100).toFixed(1)}%`);
}

// 添加监控
export function addToWatchlist(config: AlertConfig): { success: boolean; message: string } {
  try {
    // 检查是否已在监控列表
    const existing = (db.prepare(
      'SELECT id FROM wallet_watchlist WHERE chain_id = ? AND address = ? AND status = ?'
    ) as SqliteStatement).get(config.chain_id, config.wallet_address, 'active') as any;
    
    if (existing) {
      return { success: false, message: '该地址已在监控列表中' };
    }
    
    (db.prepare(`
      INSERT INTO wallet_watchlist (
        chain_id, address, watch_reason, priority,
        alert_on_buy, alert_on_sell, alert_threshold_usd,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    `) as SqliteStatement).run(
      config.chain_id,
      config.wallet_address,
      `手动添加 - ${config.priority}优先级`,
      config.priority,
      config.alert_on_buy ? 1 : 0,
      config.alert_on_sell ? 1 : 0,
      config.alert_threshold_usd
    );
    
    logInfo('钱包监控', `添加监控: ${config.wallet_address.slice(0, 10)}...`);
    return { success: true, message: '成功添加到监控列表' };
  } catch (err: any) {
    return { success: false, message: `添加失败: ${err.message}` };
  }
}

// 移除监控
export function removeFromWatchlist(chainId: string, address: string): { success: boolean; message: string } {
  try {
    const result = (db.prepare(
      "UPDATE wallet_watchlist SET status = 'removed' WHERE chain_id = ? AND address = ? AND status = 'active'"
    ) as SqliteStatement).run(chainId, address);
    
    if (result.changes === 0) {
      return { success: false, message: '该地址不在监控列表中' };
    }
    
    logInfo('钱包监控', `移除监控: ${address.slice(0, 10)}...`);
    return { success: true, message: '成功移除监控' };
  } catch (err: any) {
    return { success: false, message: `移除失败: ${err.message}` };
  }
}

// 获取监控列表
export function getWatchlist(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  priority?: string;
} = {}): { list: any[]; total: number } {
  const page = params.page || 1;
  const pageSize = Math.min(params.pageSize || 20, 100);
  const offset = (page - 1) * pageSize;
  
  let where = "1=1";
  const sqlParams: any[] = [];
  
  if (params.status) {
    where += " AND status = ?";
    sqlParams.push(params.status);
  }
  
  if (params.priority) {
    where += " AND priority = ?";
    sqlParams.push(params.priority);
  }
  
  const total = (db.prepare(
    `SELECT COUNT(*) as c FROM wallet_watchlist WHERE ${where}`
  ) as SqliteStatement).get(...sqlParams) as any;
  
  const list = (db.prepare(`
    SELECT w.*, p.wallet_type, p.win_rate, p.trust_score
    FROM wallet_watchlist w
    LEFT JOIN wallet_profiles p ON w.chain_id = p.chain_id AND w.address = p.address
    WHERE ${where}
    ORDER BY 
      CASE w.priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
      w.created_at DESC
    LIMIT ? OFFSET ?
  `) as SqliteStatement).all(...sqlParams, pageSize, offset) as any[];
  
  return { list, total: total?.c || 0 };
}

// 获取钱包详情
export function getWalletDetail(chainId: string, address: string): any {
  const profile = (db.prepare(
    'SELECT * FROM wallet_profiles WHERE chain_id = ? AND address = ?'
  ) as SqliteStatement).get(chainId, address) as any;
  
  const recentTrades = (db.prepare(`
    SELECT * FROM wallet_trades 
    WHERE wallet_address = ? AND chain_id = ?
    ORDER BY trade_time DESC
    LIMIT 20
  `) as SqliteStatement).all(address, chainId) as any[];
  
  const watchlist = (db.prepare(
    "SELECT * FROM wallet_watchlist WHERE chain_id = ? AND address = ? AND status = 'active'"
  ) as SqliteStatement).get(chainId, address) as any;
  
  return {
    profile,
    recent_trades: recentTrades,
    watchlist
  };
}

// 获取监控统计
export function getWatchlistStats(): Record<string, number> {
  const stats = (db.prepare(`
    SELECT priority, COUNT(*) as count
    FROM wallet_watchlist
    WHERE status = 'active'
    GROUP BY priority
  `) as SqliteStatement).all() as any[];
  
  const result: Record<string, number> = {
    high: 0,
    normal: 0,
    low: 0,
    total: 0
  };
  
  for (const stat of stats) {
    result[stat.priority] = stat.count;
    result.total += stat.count;
  }
  
  return result;
}

// 获取钱包类型统计
export function getWalletTypeStats(): Record<string, number> {
  const stats = (db.prepare(`
    SELECT wallet_type, COUNT(*) as count
    FROM wallet_profiles
    GROUP BY wallet_type
  `) as SqliteStatement).all() as any[];
  
  const result: Record<string, number> = {
    kol: 0,
    smart_money: 0,
    whale: 0,
    project: 0,
    unknown: 0
  };
  
  for (const stat of stats) {
    result[stat.wallet_type] = stat.count;
  }
  
  return result;
}
