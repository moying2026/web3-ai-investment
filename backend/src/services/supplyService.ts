// 获取代币供应量数据（totalSupply / burned / circulating）
// 通过 BSC RPC 调用合约的 totalSupply() 和 balanceOf(dead) 函数

import { db } from '../db/database';

const { fetch: undiciFetch, ProxyAgent } = require('undici');
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
let dispatcher: any = undefined;
if (PROXY_URL) {
  dispatcher = new ProxyAgent(PROXY_URL);
}

// BSC RPC 端点（轮询使用）
const RPC_ENDPOINTS = [
  'https://bsc-dataseed2.defibit.io/',
  'https://bsc-dataseed2.ninicoin.io/',
];

// 死亡地址（用于计算销毁量）
const DEAD_ADDRESS = '000000000000000000000000000000000000000000000000000000000000dead';

let rpcIndex = 0;

function getNextRpc(): string {
  const url = RPC_ENDPOINTS[rpcIndex % RPC_ENDPOINTS.length];
  rpcIndex++;
  return url;
}

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

// 通过 RPC 调用合约函数
async function callContract(to: string, data: string): Promise<string | null> {
  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const rpcUrl = getNextRpc();
    try {
      const resp = await undiciFetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{ to, data }, 'latest'],
          id: 1,
        }),
        dispatcher,
      }).then((r: any) => r.json());

      if (resp.result && resp.result !== '0x' && !resp.error) {
        return resp.result;
      }
    } catch (e) {
      // 继续尝试下一个 RPC
    }
  }
  return null;
}

// 获取代币的 totalSupply
async function getTotalSupply(contractAddress: string): Promise<bigint | null> {
  // totalSupply() 函数签名: 0x18160ddd
  const result = await callContract(contractAddress, '0x18160ddd');
  if (!result) return null;
  try {
    return BigInt(result);
  } catch {
    return null;
  }
}

// 获取代币的 burned amount（dead 地址余额）
async function getBurnedAmount(contractAddress: string): Promise<bigint | null> {
  // balanceOf(address) 函数签名: 0x70a08231 + 地址(32字节)
  const data = '0x70a08231' + DEAD_ADDRESS;
  const result = await callContract(contractAddress, data);
  if (!result) return null;
  try {
    return BigInt(result);
  } catch {
    return null;
  }
}

// 批量获取供应量数据
export async function fetchSupplyData(): Promise<void> {
  console.log('[Supply] 开始获取供应量数据...');

  const tokens = (db.prepare(
    'SELECT chain_id, contract_address, symbol, decimals FROM tokens WHERE chain_id = ? AND (total_supply IS NULL OR total_supply = \'\') LIMIT 20'
  ) as SqliteStatement).all('56') as any[];

  if (tokens.length === 0) {
    console.log('[Supply] 所有 BSC 代币的供应量数据已获取');
    return;
  }

  console.log(`[Supply] 需要获取 ${tokens.length} 个代币的供应量数据`);

  const updateStmt = db.prepare(`
    UPDATE tokens SET total_supply = ?, burned_amount = ?, circulating_supply = ?, updated_at = datetime('now')
    WHERE chain_id = ? AND contract_address = ?
  `) as SqliteStatement;

  let successCount = 0;

  for (const token of tokens) {
    try {
      const totalSupply = await getTotalSupply(token.contract_address);
      if (!totalSupply) {
        console.log(`[Supply] ${token.symbol}: 无法获取 totalSupply`);
        continue;
      }

      const burned = await getBurnedAmount(token.contract_address);
      const burnedAmount = burned || BigInt(0);
      const circulating = totalSupply - burnedAmount;

      const decimals = token.decimals || 18;
      const totalSupplyHuman = Number(totalSupply) / Math.pow(10, decimals);
      const burnedHuman = Number(burnedAmount) / Math.pow(10, decimals);
      const circulatingHuman = Number(circulating) / Math.pow(10, decimals);

      updateStmt.run(
        totalSupplyHuman.toString(),
        burnedHuman.toString(),
        circulatingHuman.toString(),
        token.chain_id,
        token.contract_address
      );

      console.log(`[Supply] ${token.symbol}: total=${totalSupplyHuman.toLocaleString()} burned=${burnedHuman.toLocaleString()} circulating=${circulatingHuman.toLocaleString()}`);
      successCount++;

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`[Supply] ${token.symbol} 失败:`, err);
    }
  }

  console.log(`[Supply] 完成: ${successCount}/${tokens.length} 个代币的供应量数据已更新`);
}

// 如果直接运行此脚本
if (require.main === module) {
  const { initDatabase } = require('../db/database');
  initDatabase();
  fetchSupplyData().then(() => {
    console.log('[Supply] 脚本执行完毕');
    process.exit(0);
  }).catch(err => {
    console.error('[Supply] 脚本执行失败:', err);
    process.exit(1);
  });
}
