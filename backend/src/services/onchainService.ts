// 链上数据采集服务 — 供应量 / 销毁量 / 是否可增发
// 数据源：CoinGecko API + EVM RPC
// 采集策略：首次入库立即采集，之后每 3 天自动同步，支持手动刷新单个代币

import { db } from '../db/database';
import { logInfo, logError } from './logService';
import { BinanceToken } from '../types/token';

const { fetch: undiciFetch, ProxyAgent } = require('undici');
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
let dispatcher: any = undefined;
if (PROXY_URL) {
  dispatcher = new ProxyAgent(PROXY_URL);
}

// 各链 RPC 端点
const RPC_ENDPOINTS: Record<string, string[]> = {
  '56': ['https://bsc-dataseed2.defibit.io/', 'https://bsc-dataseed2.ninicoin.io/'],
  '8453': ['https://base.publicnode.com', 'https://base.llamarpc.com'],
  '1': ['https://ethereum.publicnode.com', 'https://eth.llamarpc.com'],
  'CT_501': [], // Solana 不支持 EVM RPC
};

// CoinGecko 平台映射
const CG_PLATFORM_MAP: Record<string, string> = {
  '56': 'binance-smart-chain',
  'bsc': 'binance-smart-chain',
  'CT_501': 'solana',
  'solana': 'solana',
  '1': 'ethereum',
  'eth': 'ethereum',
  '8453': 'base',
  'base': 'base',
};

// 同步间隔（3天 = 259200000 毫秒）
const SYNC_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

// ============ CoinGecko API ============

interface CoinGeckoSupplyData {
  total_supply: number | null;
  max_supply: number | null;
  circulating_supply: number | null;
  burned: number | null;
  market_cap_usd: number | null;
}

async function getSupplyFromCoinGecko(contractAddress: string, chain: string): Promise<CoinGeckoSupplyData | null> {
  const platform = CG_PLATFORM_MAP[chain] || 'binance-smart-chain';
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${contractAddress}`;
    const resp = await undiciFetch(url, { dispatcher, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) return null;
    const j = await resp.json();
    const md = j.market_data || {};
    const total = md.total_supply || null;
    const max = md.max_supply || null;
    const circ = md.circulating_supply || null;
    const burned = total && circ ? total - circ : (total && max && max < total ? total - max : null);
    return { total_supply: total, max_supply: max, circulating_supply: circ, burned, market_cap_usd: md.market_cap?.usd || null };
  } catch (e) { return null; }
}

// ============ EVM RPC ============

async function getTotalSupplyFromRPC(contractAddress: string, chainId: string): Promise<bigint | null> {
  const rpcs = RPC_ENDPOINTS[chainId] || [];
  for (const rpc of rpcs) {
    try {
      const resp = await undiciFetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: contractAddress, data: '0x18160ddd' }, 'latest'], id: 1 }),
        dispatcher,
      }).then((r: any) => r.json());
      if (resp.result && resp.result !== '0x' && !resp.error) return BigInt(resp.result);
    } catch (e) { /* try next */ }
  }
  return null;
}

async function isMintableEVM(contractAddress: string, chainId: string): Promise<{ mintable: boolean; upgradeable: boolean; details: string }> {
  const rpcs = RPC_ENDPOINTS[chainId] || [];
  if (rpcs.length === 0) return { mintable: false, upgradeable: false, details: '非EVM链' };
  for (const rpc of rpcs) {
    try {
      const resp = await undiciFetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getCode', params: [contractAddress, 'latest'], id: 1 }),
        dispatcher,
      }).then((r: any) => r.json());
      const code = resp.result;
      if (!code || code === '0x') return { mintable: false, upgradeable: false, details: '无合约代码' };
      const hasMint = code.includes('40c10f19');
      const hasOwner = code.includes('8da5cb5b');
      const hasProxy = code.includes('363d3d373d3d363d73');
      const hasUpgradeSlot = code.includes('360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc');
      const details = [hasMint ? 'mintable' : '', hasOwner ? 'hasOwner' : '', hasProxy ? 'proxy' : '', hasUpgradeSlot ? 'upgradeable' : ''].filter(Boolean).join(', ') || '标准合约';
      return { mintable: hasMint, upgradeable: hasProxy || hasUpgradeSlot, details };
    } catch (e) { /* try next */ }
  }
  return { mintable: false, upgradeable: false, details: '无法获取' };
}

// ============ 核心采集函数 ============

// 采集单个代币的链上数据
export async function fetchSingleTokenOnchain(chainId: string, contractAddress: string, symbol?: string, decimals?: number): Promise<boolean> {
  try {
    const cgData = await getSupplyFromCoinGecko(contractAddress, chainId);
    let rpcTotalSupply: bigint | null = null;
    let mintInfo: any = null;
    if (RPC_ENDPOINTS[chainId]?.length > 0) {
      rpcTotalSupply = await getTotalSupplyFromRPC(contractAddress, chainId);
      mintInfo = await isMintableEVM(contractAddress, chainId);
    }
    const updates: string[] = [];
    const params: any[] = [];
    if (cgData) {
      if (cgData.total_supply) { updates.push('total_supply = ?'); params.push(cgData.total_supply.toString()); }
      if (cgData.max_supply) { updates.push('max_supply = ?'); params.push(cgData.max_supply.toString()); }
      if (cgData.circulating_supply) { updates.push('circulating_supply = ?'); params.push(cgData.circulating_supply.toString()); }
      if (cgData.burned !== null && cgData.burned > 0) { updates.push('burned_amount = ?'); params.push(cgData.burned.toString()); }
      if (cgData.market_cap_usd) { updates.push('market_cap = ?'); params.push(cgData.market_cap_usd.toString()); }
    }
    if (rpcTotalSupply) {
      const dec = decimals || 18;
      const totalSupplyHuman = Number(rpcTotalSupply) / Math.pow(10, dec);
      if (!cgData?.total_supply || Math.abs(totalSupplyHuman - cgData.total_supply) / cgData.total_supply > 0.01) {
        updates.push('total_supply = ?'); params.push(totalSupplyHuman.toString());
      }
    }
    if (mintInfo) {
      updates.push('is_mintable = ?'); params.push(mintInfo.mintable ? 1 : 0);
      updates.push('is_upgradeable = ?'); params.push(mintInfo.upgradeable ? 1 : 0);
      updates.push('contract_analysis = ?'); params.push(mintInfo.details);
    }
    updates.push("onchain_last_sync = datetime('now')");
    if (updates.length > 0) {
      params.push(chainId, contractAddress);
      (db.prepare(`UPDATE tokens SET ${updates.join(', ')}, updated_at = datetime('now') WHERE chain_id = ? AND contract_address = ?`) as SqliteStatement).run(...params);
    }
    logInfo('链上数据', `${symbol || contractAddress}: 已更新`);
    return true;
  } catch (err) {
    logError('链上数据', `${symbol || contractAddress} 失败: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// 批量采集（仅处理需要同步的代币：首次或超过 3 天未同步）
export async function fetchOnchainSupplyData(): Promise<void> {
  const threshold = new Date(Date.now() - SYNC_INTERVAL_MS).toISOString();
  const tokens = (db.prepare(`
    SELECT chain_id, contract_address, symbol, decimals
    FROM tokens
    WHERE onchain_last_sync IS NULL OR onchain_last_sync < ?
    ORDER BY first_seen_at DESC
    LIMIT 10
  `) as SqliteStatement).all(threshold) as any[];

  if (tokens.length === 0) return;
  logInfo('链上数据', `需要同步 ${tokens.length} 个代币`);

  let successCount = 0;
  for (const token of tokens) {
    const ok = await fetchSingleTokenOnchain(token.chain_id, token.contract_address, token.symbol, token.decimals);
    if (ok) successCount++;
    await new Promise(resolve => setTimeout(resolve, 4000)); // CoinGecko 限流
  }
  logInfo('链上数据', `完成: ${successCount}/${tokens.length}`);
}
