import { fetchAllChainTokens, fetchMemeRushList, fetchLatestTokens, fetchSocialTopics, fetchPriceInfo } from './binanceApi';
import { fetchOnchainSupplyData } from './onchainService';
import { fetchIssuerData } from './issuerService';
import { initExtendedTables, fetchExtendedData } from './binanceExtendedApi';
import { initAnalysisTable, analyzeNewTokens } from './aiAnalysisService';
import { executeAutoBuyAll, checkAndClosePositions } from './simTradeService';
import { db } from '../db/database';
import { registerModule, isModuleRunning, recordRun, initSystemControl } from './systemControl';
import {
  isNewToken, insertToken, updateTokenLatestPrice,
  createTrackingPlans, getPendingSnapshotPlans, executeSnapshot,
  upsertSocialTopics
} from './tokenService';
import { BinanceToken, TokenListData } from '../types/token';

// SSE 事件队列
const sseClients: Set<(data: string) => void> = new Set();
let newTokenBuffer: BinanceToken[] = [];

// 注册/注销 SSE 客户端
export function addSSEClient(send: (data: string) => void): () => void {
  sseClients.add(send);
  return () => sseClients.delete(send);
}

// 获取当前 SSE 客户端数量
export function getSSEClientCount(): number {
  return sseClients.size;
}

// 广播 SSE 事件
function broadcast(event: string, data: any): void {
  // 只用 data 字段，不加 event: 命名，确保前端 onmessage 能接收
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const send of sseClients) {
    try { send(msg); } catch { sseClients.delete(send); }
  }
}

// 主轮询：采集代币数据
let lastPollTime: string | null = null;
let pollCount = 0;

export async function pollTokenData(): Promise<void> {
  try {
    // 使用 Meme Rush API 获取新币（rankType: 10）
    const memeRushResults: TokenListData[] = [];
    const chains = [
      { chainId: '56', name: 'bsc' },
      { chainId: 'CT_501', name: 'solana' },
      { chainId: '8453', name: 'base' },
      { chainId: '1', name: 'eth' },
    ];

    for (const chain of chains) {
      try {
        // 每条链取 3 页，每页 200，覆盖 600 个代币
        for (let page = 1; page <= 3; page++) {
          const data = await fetchMemeRushList(chain.chainId, 200, page);
          memeRushResults.push(data);
          console.log(`[API] ${chain.name} (Meme Rush p${page}): 获取 ${data.tokens.length} 个代币, total=${data.total}`);
        }
      } catch (err) {
        console.error(`[API] ${chain.name} (Meme Rush) 获取失败:`, err instanceof Error ? err.message : err);
      }
    }

    let newCount = 0;
    let updatedCount = 0;

    for (const chainData of memeRushResults) {
      for (const token of chainData.tokens) {
        if (isNewToken(token.chainId, token.contractAddress)) {
          const inserted = insertToken(token);
          if (inserted) {
            newCount++;
            createTrackingPlans(token.chainId, token.contractAddress);
            newTokenBuffer.push(token);
            broadcast('new_token', {
              type: 'new_token',
              token: {
                chainId: token.chainId,
                contractAddress: token.contractAddress,
                symbol: token.symbol,
                price: token.price,
                marketCap: token.marketCap,
                liquidity: token.liquidity,
                holders: token.holders,
                launchTime: token.launchTime,
              },
              detectedAt: new Date().toISOString(),
            });
          }
        } else {
          updateTokenLatestPrice(token);
          updatedCount++;
        }
      }
    }

    // 清空缓冲区（保留最近 100 条）
    if (newTokenBuffer.length > 100) {
      newTokenBuffer = newTokenBuffer.slice(-100);
    }

    lastPollTime = new Date().toISOString();
    pollCount++;

    if (newCount > 0 || pollCount % 10 === 0) {
      console.log(`[Poll] #${pollCount} | 新币: ${newCount} | 更新: ${updatedCount} | 时间: ${lastPollTime}`);
    }
  } catch (err) {
    console.error('[Poll] 代币采集失败:', err);
  }
}

// 新币发现流：获取最新上线代币（每 90 秒一次）
let discoveryPollCount = 0;
export async function pollLatestTokens(): Promise<void> {
  try {
    const chains = [
      { chainId: '56', name: 'bsc' },
      { chainId: 'CT_501', name: 'solana' },
      { chainId: '8453', name: 'base' },
      { chainId: '1', name: 'eth' },
    ];

    let totalNew = 0;
    let totalUpdated = 0;

    for (const chain of chains) {
      try {
        // 获取最近24小时内的新币
        const data = await fetchLatestTokens(chain.chainId, 50, 1440);
        let chainNew = 0;

        for (const token of data.tokens) {
          if (isNewToken(token.chainId, token.contractAddress)) {
            const inserted = insertToken(token);
            if (inserted) {
              chainNew++;
              totalNew++;
              createTrackingPlans(token.chainId, token.contractAddress);
              newTokenBuffer.push(token);
              broadcast('new_token', {
                type: 'new_token',
                token: {
                  chainId: token.chainId,
                  contractAddress: token.contractAddress,
                  symbol: token.symbol,
                  price: token.price,
                  marketCap: token.marketCap,
                  liquidity: token.liquidity,
                  holders: token.holders,
                  launchTime: token.launchTime,
                },
                detectedAt: new Date().toISOString(),
              });
            }
          } else {
            updateTokenLatestPrice(token);
            totalUpdated++;
          }
        }

        if (chainNew > 0 || discoveryPollCount % 5 === 0) {
          console.log(`[Discovery] ${chain.name}: 发现 ${chainNew} 个新币, total=${data.total}`);
        }
      } catch (err) {
        console.error(`[Discovery] ${chain.name} 获取失败:`, err instanceof Error ? err.message : err);
      }
    }

    discoveryPollCount++;

    if (totalNew > 0 || discoveryPollCount % 10 === 0) {
      console.log(`[Discovery] #${discoveryPollCount} | 新币: ${totalNew} | 更新: ${totalUpdated}`);
    }
  } catch (err) {
    console.error('[Discovery] 新币发现失败:', err);
  }
}

// 社交话题轮询（频率较低，每 60 秒一次）
export async function pollSocialTopics(): Promise<void> {
  try {
    const topics = await fetchSocialTopics('56');
    const count = upsertSocialTopics(topics);
    if (count > 0) {
      console.log(`[Social] 更新 ${count} 个社交话题`);
    }
  } catch (err) {
    console.error('[Social] 社交话题采集失败:', err);
  }
}

// 快照执行检查（每 10 秒检查一次）
export async function checkAndExecuteSnapshots(): Promise<void> {
  try {
    const plans = getPendingSnapshotPlans();
    if (plans.length === 0) return;

    console.log(`[Snapshot] 发现 ${plans.length} 个待执行快照`);

    for (const plan of plans) {
      try {
        // 先从缓存的 trending 数据中查找
        const results = await fetchAllChainTokens(50);
        let tokenData: BinanceToken | null = null;

        for (const chainData of results) {
          const found = chainData.tokens.find(
            t => t.chainId === plan.chain_id && t.contractAddress === plan.contract_address
          );
          if (found) {
            tokenData = found;
            break;
          }
        }

        // 如果 trending 中找不到，使用价格 API 获取当前价格
        if (!tokenData) {
          try {
            const chainIdMap: Record<string, string> = { '56': '56', 'CT_501': 'CT_501', '8453': '8453', '1': '1' };
            const chainId = chainIdMap[plan.chain_id] || plan.chain_id;
            const priceInfo = await fetchPriceInfo(chainId, plan.contract_address);
            if (priceInfo && priceInfo.price) {
              // 构造最小 token 数据用于快照
              tokenData = {
                chainId: plan.chain_id,
                contractAddress: plan.contract_address,
                symbol: '',
                price: priceInfo.price,
                volume24h: '0',
                volume1h: '0',
                liquidity: '0',
                holders: '0',
                holdersTop10Percent: '0',
                smartMoneyHoldingPercent: 0,
                devHoldingPercent: 0,
                bundlesHoldingPercent: 0,
                uniqueTrader24h: '0',
                count24h: '0',
              } as any;
              console.log(`[Snapshot] ${plan.snapshot_type} 使用价格 API: ${priceInfo.price}`);
            }
          } catch (e) {
            // 价格 API 也失败
          }
        }

        executeSnapshot(plan, tokenData);
        console.log(`[Snapshot] ${plan.snapshot_type} 快照完成: ${plan.chain_id}:${plan.contract_address}`);
      } catch (err) {
        console.error(`[Snapshot] 快照执行失败 ${plan.snapshot_type}:`, err);
        executeSnapshot(plan, null);
      }
    }
  } catch (err) {
    console.error('[Snapshot] 快照检查失败:', err);
  }
}

// 启动所有轮询
export function startPolling(): void {
  console.log('[Polling] 启动轮询服务...');

  // 初始化系统控制
  initSystemControl();

  // 注册模块
  registerModule('polling', '热门轮询', 30000); // 从 10 秒放宽到 30 秒，配合 1500ms 串行间隔
  registerModule('discovery', '新币发现流', 180000); // 从 90 秒放宽到 180 秒
  registerModule('ai', 'AI 评估引擎', 30000);
  registerModule('trading', '模拟交易', 10000);
  registerModule('trench', '战壕拦截', 30000);

  // 代币数据：每 30 秒（从 10 秒进一步放宽，配合 1500ms 串行间隔）
  setInterval(() => {
    if (!isModuleRunning('polling')) return;
    pollTokenData();
    recordRun('polling', true);
  }, 30000);

  // 社交话题：每 120 秒（错开 20 秒启动，避免与 polling 并发）
  setTimeout(() => {
    setInterval(pollSocialTopics, 120000);
    pollSocialTopics();
  }, 20000);

  // 快照检查：每 30 秒（错开 10 秒启动）
  setTimeout(() => {
    setInterval(checkAndExecuteSnapshots, 30000);
  }, 10000);

  // 链上数据：每 3 天自动同步一次
  setInterval(fetchOnchainSupplyData, 3 * 24 * 60 * 60 * 1000);

  // 发行方数据：每 24 小时自动同步一次
  setInterval(fetchIssuerData, 24 * 60 * 60 * 1000);

  // 扩展数据（审计/动态/Smart Money）：每 60 秒（错开 10 秒启动）
  initExtendedTables();
  setTimeout(() => {
    setInterval(fetchExtendedData, 60000);
    fetchExtendedData();
  }, 10000);

  // AI 分析 + 全量自动模拟买入：每 30 秒
  initAnalysisTable();
  setInterval(() => {
    if (!isModuleRunning('ai')) return;
    try {
      const results = analyzeNewTokens();
      // 全量买入：所有新币都买，不依赖 AI 评分
      const buyCount = executeAutoBuyAll();
      if (buyCount > 0) console.log(`[Sim] 全量买入 ${buyCount} 笔`);
      recordRun('ai', true, undefined, { analyzed: results.length, bought: buyCount });
    } catch (err) {
      recordRun('ai', false, String(err));
    }
  }, 30000);

  // 多 Agent 评分：每 30 秒
  const { evaluateDecision, storeAgentScores } = require('./agents/decisionAgent');
  setInterval(() => {
    if (!isModuleRunning('trench')) return;
    try {
      const newTokens = db.prepare(`
        SELECT t.chain_id, t.contract_address, t.symbol
        FROM tokens t
        LEFT JOIN agent_scores ag ON t.chain_id = ag.chain_id AND t.contract_address = ag.contract_address AND ag.agent_type = 'decision'
        WHERE ag.id IS NULL AND t.first_seen_at > datetime('now', '-24 hours')
        ORDER BY t.first_seen_at DESC LIMIT 5
      `).all() as any[];
      let scored = 0;
      for (const token of newTokens) {
        try {
          const decision = evaluateDecision({ chainId: token.chain_id, contractAddress: token.contract_address, symbol: token.symbol });
          storeAgentScores(token.chain_id, token.contract_address, decision);
          scored++;
          console.log(`[Agent] ${token.symbol}: score=${decision.score} rec=${decision.recommendation} confidence=${decision.confidence.toFixed(2)}`);
        } catch (e) {
          console.error(`[Agent] 评分失败 ${token.symbol}:`, e);
        }
      }
      recordRun('trench', true, undefined, { scored });
    } catch (e) {
      recordRun('trench', false, String(e));
    }
  }, 30000);

  // 持仓检查（止盈止损）：每 10 秒
  setInterval(() => {
    if (!isModuleRunning('trading')) return;
    try {
      const closed = checkAndClosePositions();
      recordRun('trading', true, undefined, { closed });
    } catch (err) {
      recordRun('trading', false, String(err));
    }
  }, 10000);

  // 新币发现流：每 180 秒（从 90 秒放宽，错开 45 秒启动避免与 polling 并发）
  setTimeout(() => {
    setInterval(async () => {
      if (!isModuleRunning('discovery')) return;
      try {
        await pollLatestTokens();
        recordRun('discovery', true, undefined, { pollCount: discoveryPollCount });
      } catch (err) {
        recordRun('discovery', false, String(err));
      }
    }, 180000);
    // 立即执行一次
    pollLatestTokens().then(() => {
      recordRun('discovery', true, undefined, { pollCount: discoveryPollCount });
    }).catch(err => {
      recordRun('discovery', false, String(err));
    });
  }, 45000); // 延迟 45 秒启动，错开其他模块
}

export function getNewTokenBuffer(): BinanceToken[] {
  return [...newTokenBuffer];
}

export function getLastPollTime(): string | null {
  return lastPollTime;
}
