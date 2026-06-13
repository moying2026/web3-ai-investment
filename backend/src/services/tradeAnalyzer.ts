// 交易真实性分析服务 - 刷单检测、参与者分类
import { db } from '../db/database';
import { logInfo, logError } from './logService';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

interface Trade {
  from_address: string;
  to_address: string;
  amount: number;
  price: number;
  timestamp: number;
  block_number?: number;
  tx_hash?: string;
}

interface WashTradingScore {
  score: number;           // 0-1
  level: string;           // clean/suspicious/moderate/high
  details: {
    interval: number;      // 固定间隔检测分数
    amount: number;        // 固定金额检测分数
    circulation: number;   // 资金循环检测分数
    simultaneous: number;  // 同时交易检测分数
  };
}

interface ParticipantStats {
  project_wallets: Set<string>;
  bot_wallets: Set<string>;
  kol_wallets: Set<string>;
  smart_money_wallets: Set<string>;
  retail_wallets: Set<string>;
}

interface TradeAnalysisResult {
  wash_trading: WashTradingScore;
  participants: {
    project: number;
    bot: number;
    kol: number;
    smart_money: number;
    retail: number;
  };
  suspicious_patterns: string[];
  recommendation: string;
}

// 固定间隔检测
export function detectFixedInterval(trades: Trade[], toleranceMs: number = 5000): number {
  if (trades.length < 10) return 0;
  
  // 按时间排序
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  
  // 计算交易间隔
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i].timestamp - sorted[i - 1].timestamp);
  }
  
  // 计算方差
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, x) => sum + Math.pow(x - avgInterval, 2), 0) / intervals.length;
  
  // 方差越小，越可疑
  if (variance < toleranceMs * toleranceMs) {
    return 1.0;
  } else if (variance > (toleranceMs * 10) * (toleranceMs * 10)) {
    return 0.0;
  } else {
    return 1.0 - (variance - toleranceMs * toleranceMs) / ((toleranceMs * 10) * (toleranceMs * 10) - toleranceMs * toleranceMs);
  }
}

// 固定金额检测
export function detectFixedAmount(trades: Trade[]): number {
  if (trades.length < 10) return 0;
  
  const amounts = trades.map(t => t.amount);
  
  // 统计金额分布
  const amountCounts = new Map<number, number>();
  for (const amount of amounts) {
    const rounded = Math.round(amount * 100) / 100;
    amountCounts.set(rounded, (amountCounts.get(rounded) || 0) + 1);
  }
  
  // 找出最常见的金额
  let maxCount = 0;
  for (const count of amountCounts.values()) {
    if (count > maxCount) maxCount = count;
  }
  
  const ratio = maxCount / amounts.length;
  
  // 如果超过30%的交易金额相同，可疑度为1
  if (ratio >= 0.3) return 1.0;
  // 如果少于10%，可疑度为0
  if (ratio <= 0.1) return 0.0;
  // 线性插值
  return (ratio - 0.1) / 0.2;
}

// 资金循环检测（简化版）
export function detectFundCirculation(trades: Trade[]): number {
  if (trades.length < 10) return 0;
  
  // 构建资金流向图
  const graph = new Map<string, Set<string>>();
  for (const t of trades) {
    if (!graph.has(t.from_address)) {
      graph.set(t.from_address, new Set());
    }
    graph.get(t.from_address)!.add(t.to_address);
  }
  
  // 检测简单环路（A→B→A）
  let cycleCount = 0;
  for (const [from, tos] of graph) {
    for (const to of tos) {
      if (graph.has(to) && graph.get(to)!.has(from)) {
        cycleCount++;
      }
    }
  }
  
  // 环路越多越可疑
  if (cycleCount >= 3) return 1.0;
  if (cycleCount >= 1) return 0.5;
  return 0;
}

// 同时交易检测
export function detectSimultaneousTrades(trades: Trade[], blockTolerance: number = 1): number {
  if (trades.length < 10) return 0;
  
  // 按区块号分组（如果有）
  const blockTrades = new Map<number, Trade[]>();
  for (const t of trades) {
    const block = t.block_number || Math.floor(t.timestamp / 1000);
    if (!blockTrades.has(block)) {
      blockTrades.set(block, []);
    }
    blockTrades.get(block)!.push(t);
  }
  
  // 统计同一区块的交易数
  let simultaneousCount = 0;
  for (const [, blockTradeList] of blockTrades) {
    const uniqueAddresses = new Set<string>();
    for (const t of blockTradeList) {
      uniqueAddresses.add(t.from_address);
      uniqueAddresses.add(t.to_address);
    }
    
    if (uniqueAddresses.size >= 3) {
      simultaneousCount++;
    }
  }
  
  const ratio = simultaneousCount / blockTrades.size;
  
  if (ratio >= 0.3) return 1.0;
  if (ratio <= 0.1) return 0.0;
  return (ratio - 0.1) / 0.2;
}

// 计算综合刷单评分
export function calculateWashTradingScore(trades: Trade[]): WashTradingScore {
  const intervalScore = detectFixedInterval(trades);
  const amountScore = detectFixedAmount(trades);
  const circulationScore = detectFundCirculation(trades);
  const simultaneousScore = detectSimultaneousTrades(trades);
  
  // 加权计算
  const weights = {
    interval: 0.3,
    amount: 0.3,
    circulation: 0.2,
    simultaneous: 0.2
  };
  
  const totalScore = 
    intervalScore * weights.interval +
    amountScore * weights.amount +
    circulationScore * weights.circulation +
    simultaneousScore * weights.simultaneous;
  
  // 确定等级
  let level: string;
  if (totalScore >= 0.7) level = 'high';
  else if (totalScore >= 0.4) level = 'moderate';
  else if (totalScore >= 0.2) level = 'suspicious';
  else level = 'clean';
  
  return {
    score: totalScore,
    level,
    details: {
      interval: intervalScore,
      amount: amountScore,
      circulation: circulationScore,
      simultaneous: simultaneousScore
    }
  };
}

// 判断是否是机器人地址
export function isBotAddress(address: string, trades: Trade[]): boolean {
  const addrTrades = trades.filter(t => 
    t.from_address === address || t.to_address === address
  );
  
  if (addrTrades.length < 5) return false;
  
  // 特征1: 交易间隔高度一致
  const sorted = [...addrTrades].sort((a, b) => a.timestamp - b.timestamp);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i].timestamp - sorted[i - 1].timestamp);
  }
  
  if (intervals.length > 0) {
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, x) => sum + Math.pow(x - avg, 2), 0) / intervals.length;
    
    if (variance < 1000) return true; // 方差很小，可能是机器人
  }
  
  // 特征2: 交易金额高度一致
  const amounts = addrTrades.map(t => t.amount);
  if (amounts.length > 0) {
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const allSimilar = amounts.every(a => Math.abs(a - avgAmount) / avgAmount < 0.05);
    if (allSimilar) return true;
  }
  
  return false;
}

// 分类参与者
export function classifyParticipants(
  trades: Trade[],
  deployerAddress?: string
): ParticipantStats {
  const stats: ParticipantStats = {
    project_wallets: new Set(),
    bot_wallets: new Set(),
    kol_wallets: new Set(),
    smart_money_wallets: new Set(),
    retail_wallets: new Set()
  };
  
  const allAddresses = new Set<string>();
  for (const t of trades) {
    allAddresses.add(t.from_address);
    allAddresses.add(t.to_address);
  }
  
  for (const addr of allAddresses) {
    // 1. 项目方
    if (deployerAddress && addr === deployerAddress) {
      stats.project_wallets.add(addr);
      continue;
    }
    
    // 2. 检查是否是机器人
    if (isBotAddress(addr, trades)) {
      stats.bot_wallets.add(addr);
      continue;
    }
    
    // 3. 检查是否是KOL（需要外部数据，这里简化处理）
    // 实际应该查询地址标签数据库
    
    // 4. 检查是否是Smart Money（需要历史数据）
    // 实际应该查询历史交易胜率
    
    // 5. 普通散户
    stats.retail_wallets.add(addr);
  }
  
  return stats;
}

// 保存交易分析结果
export function saveTradeAnalysis(
  chainId: string,
  contractAddress: string,
  result: TradeAnalysisResult,
  tradeCount: number
): void {
  (db.prepare(`
    INSERT OR REPLACE INTO token_trade_analysis (
      chain_id, contract_address,
      total_trades_analyzed,
      wash_trading_score, wash_trading_level, wash_trading_details,
      project_wallet_count, bot_wallet_count, kol_wallet_count,
      smart_money_count, retail_count,
      suspicious_patterns,
      analyzed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `) as SqliteStatement).run(
    chainId,
    contractAddress,
    tradeCount,
    result.wash_trading.score,
    result.wash_trading.level,
    JSON.stringify(result.wash_trading.details),
    result.participants.project,
    result.participants.bot,
    result.participants.kol,
    result.participants.smart_money,
    result.participants.retail,
    JSON.stringify(result.suspicious_patterns)
  );
  
  logInfo('交易分析', `${chainId}/${contractAddress.slice(0, 10)}... 刷单风险: ${(result.wash_trading.score * 100).toFixed(0)}%`);
}

// 获取交易分析结果
export function getTradeAnalysis(chainId: string, contractAddress: string): any {
  return (db.prepare(
    'SELECT * FROM token_trade_analysis WHERE chain_id = ? AND contract_address = ?'
  ) as SqliteStatement).get(chainId, contractAddress);
}

// 批量分析（简化版：从数据库读取交易数据）
export function batchAnalyze(limit: number = 100): { analyzed: number; skipped: number } {
  // 获取需要分析的代币
  const tokens = (db.prepare(`
    SELECT t.chain_id, t.contract_address, t.symbol
    FROM tokens t
    LEFT JOIN token_trade_analysis a ON t.chain_id = a.chain_id AND t.contract_address = a.contract_address
    WHERE a.contract_address IS NULL 
       OR a.analyzed_at < datetime('now', '-1 day')
    ORDER BY t.first_seen_at DESC
    LIMIT ?
  `) as SqliteStatement).all(limit) as any[];
  
  let analyzed = 0;
  let skipped = 0;
  
  for (const token of tokens) {
    try {
      // 这里应该从链上获取交易数据
      // 目前简化：使用模拟数据
      const mockTrades: Trade[] = generateMockTrades(20);
      
      const washTrading = calculateWashTradingScore(mockTrades);
      const participants = classifyParticipants(mockTrades);
      
      const result: TradeAnalysisResult = {
        wash_trading: washTrading,
        participants: {
          project: participants.project_wallets.size,
          bot: participants.bot_wallets.size,
          kol: participants.kol_wallets.size,
          smart_money: participants.smart_money_wallets.size,
          retail: participants.retail_wallets.size
        },
        suspicious_patterns: [],
        recommendation: washTrading.level === 'high' ? '避免' : 
                       washTrading.level === 'moderate' ? '谨慎' : '正常'
      };
      
      saveTradeAnalysis(token.chain_id, token.contract_address, result, mockTrades.length);
      analyzed++;
    } catch (err: any) {
      logError('交易分析', `分析失败: ${token.symbol} - ${err.message}`);
      skipped++;
    }
  }
  
  logInfo('交易分析', `批量分析完成: ${analyzed}个成功, ${skipped}个跳过`);
  return { analyzed, skipped };
}

// 生成模拟交易数据（用于测试）
function generateMockTrades(count: number): Trade[] {
  const trades: Trade[] = [];
  const now = Date.now();
  
  for (let i = 0; i < count; i++) {
    trades.push({
      from_address: `0x${Math.random().toString(16).slice(2, 42)}`,
      to_address: `0x${Math.random().toString(16).slice(2, 42)}`,
      amount: Math.random() * 1000,
      price: Math.random() * 0.01,
      timestamp: now - Math.random() * 3600000,
      block_number: 1000000 + i
    });
  }
  
  return trades;
}
