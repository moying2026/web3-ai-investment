import { fetchAllChainTokens, fetchSocialTopics, fetchPriceInfo } from './binanceApi';
import { fetchOnchainSupplyData } from './onchainService';
import { fetchIssuerData } from './issuerService';
import {
  isNewToken, insertToken, updateTokenLatestPrice,
  createTrackingPlans, getPendingSnapshotPlans, executeSnapshot,
  upsertSocialTopics
} from './tokenService';
import { BinanceToken } from '../types/token';

// SSE 事件队列
const sseClients: Set<(data: string) => void> = new Set();
let newTokenBuffer: BinanceToken[] = [];

// 注册/注销 SSE 客户端
export function addSSEClient(send: (data: string) => void): () => void {
  sseClients.add(send);
  return () => sseClients.delete(send);
}

// 广播 SSE 事件
function broadcast(event: string, data: any): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const send of sseClients) {
    try { send(msg); } catch { sseClients.delete(send); }
  }
}

// 主轮询：采集代币数据
let lastPollTime: string | null = null;
let pollCount = 0;

export async function pollTokenData(): Promise<void> {
  try {
    const results = await fetchAllChainTokens(50);
    let newCount = 0;
    let updatedCount = 0;

    for (const chainData of results) {
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

  // 代币数据：每 3 秒
  setInterval(pollTokenData, 3000);

  // 社交话题：每 60 秒
  setInterval(pollSocialTopics, 60000);

  // 快照检查：每 10 秒
  setInterval(checkAndExecuteSnapshots, 10000);

  // 链上数据：每 3 天自动同步一次（变动不大，节省流量）
  setInterval(fetchOnchainSupplyData, 3 * 24 * 60 * 60 * 1000);

  // 发行方数据：每 24 小时自动同步一次
  setInterval(fetchIssuerData, 24 * 60 * 60 * 1000);

  // 立即执行一次
  pollTokenData();
  pollSocialTopics();
}

export function getNewTokenBuffer(): BinanceToken[] {
  return [...newTokenBuffer];
}

export function getLastPollTime(): string | null {
  return lastPollTime;
}
