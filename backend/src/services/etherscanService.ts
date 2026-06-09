// Etherscan API V2 链上数据查询服务
// 统一 Key 覆盖 BSC + 60+ EVM 链
// API 文档: https://docs.etherscan.io/

import { db } from '../db/database';

const { fetch: undiciFetch, ProxyAgent } = require('undici');
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
let dispatcher: any = undefined;
if (PROXY_URL) {
  dispatcher = new ProxyAgent(PROXY_URL);
}

const API_KEY = process.env.ETHERSCAN_V2_KEY || '';
const BASE_URL = process.env.ETHERSCAN_V2_BASE_URL || 'https://api.etherscan.io/v2/api';

// 链 ID 映射
const CHAIN_ID_MAP: Record<string, string> = {
  'eth': '1',
  '1': '1',
  'bsc': '56',
  '56': '56',
  'base': '8453',
  '8453': '8453',
  'polygon': '137',
  '137': '137',
  'arbitrum': '42161',
  '42161': '42161',
  'optimism': '10',
  '10': '10',
  'avalanche': '43114',
  '43114': '43114',
};

interface EtherscanResponse {
  status: string;
  message: string;
  result: any;
}

// 通用 API 调用
async function etherscanGet(params: Record<string, string>): Promise<EtherscanResponse> {
  if (!API_KEY) {
    return { status: '0', message: 'ERROR', result: 'ETHERSCAN_V2_KEY not configured' };
  }
  const url = new URL(BASE_URL);
  url.searchParams.set('apikey', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  try {
    const resp = await undiciFetch(url.toString(), {
      dispatcher,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) {
      return { status: '0', message: 'ERROR', result: `HTTP ${resp.status}` };
    }
    return await resp.json();
  } catch (err: any) {
    return { status: '0', message: 'ERROR', result: err.message };
  }
}

// ============ 查询接口 ============

// 合约验证状态
export async function getContractVerificationStatus(chain: string, address: string): Promise<any> {
  const chainId = CHAIN_ID_MAP[chain] || chain;
  const resp = await etherscanGet({
    chainid: chainId,
    module: 'contract',
    action: 'getabi',
    address,
  });
  const verified = resp.status === '1' && resp.message === 'OK';
  // 同时获取合约源码信息
  const sourceResp = await etherscanGet({
    chainid: chainId,
    module: 'contract',
    action: 'getsourcecode',
    address,
  });
  let sourceInfo: any = null;
  if (sourceResp.status === '1' && Array.isArray(sourceResp.result) && sourceResp.result[0]) {
    const src = sourceResp.result[0];
    sourceInfo = {
      contractName: src.ContractName || '',
      compiler: src.CompilerVersion || '',
      verified: src.SourceCode !== '',
      proxy: src.Proxy === '1',
      implementation: src.Implementation || '',
      license: src.LicenseType || '',
    };
  }
  return {
    chain: chainId,
    address,
    abi_verified: verified,
    source_info: sourceInfo,
  };
}

// 交易详情
export async function getTransactionDetail(chain: string, txHash: string): Promise<any> {
  const chainId = CHAIN_ID_MAP[chain] || chain;
  const resp = await etherscanGet({
    chainid: chainId,
    module: 'proxy',
    action: 'eth_getTransactionByHash',
    txhash: txHash,
  });
  if (!resp.result || resp.result === '0x') {
    return null;
  }
  const tx = resp.result;
  return {
    chain: chainId,
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value_wei: tx.value,
    value_eth: tx.value ? (parseInt(tx.value, 16) / 1e18).toFixed(6) : '0',
    gas: parseInt(tx.gas || '0x0', 16),
    gas_price_wei: tx.gasPrice ? parseInt(tx.gasPrice, 16) : null,
    nonce: parseInt(tx.nonce || '0x0', 16),
    input: tx.input,
    block_number: tx.blockNumber ? parseInt(tx.blockNumber, 16) : null,
    transaction_index: tx.transactionIndex ? parseInt(tx.transactionIndex, 16) : null,
  };
}

// 代币持仓（BEP20/ERC20 余额）
export async function getTokenBalance(chain: string, address: string, contractAddress: string): Promise<any> {
  const chainId = CHAIN_ID_MAP[chain] || chain;
  const resp = await etherscanGet({
    chainid: chainId,
    module: 'account',
    action: 'tokenbalance',
    address,
    contractaddress: contractAddress,
    tag: 'latest',
  });
  return {
    chain: chainId,
    wallet: address,
    contract: contractAddress,
    balance_raw: resp.result,
    balance: resp.status === '1' ? resp.result : null,
  };
}

// 原生代币余额（BNB/ETH）
export async function getNativeBalance(chain: string, address: string): Promise<any> {
  const chainId = CHAIN_ID_MAP[chain] || chain;
  const resp = await etherscanGet({
    chainid: chainId,
    module: 'account',
    action: 'balance',
    address,
    tag: 'latest',
  });
  const balanceWei = resp.result;
  const balanceEth = resp.status === '1' ? (parseInt(balanceWei) / 1e18).toFixed(6) : null;
  return {
    chain: chainId,
    address,
    balance_wei: balanceWei,
    balance: balanceEth,
  };
}

// Gas 价格
export async function getGasPrice(chain: string): Promise<any> {
  const chainId = CHAIN_ID_MAP[chain] || chain;
  const resp = await etherscanGet({
    chainid: chainId,
    module: 'gastracker',
    action: 'gasoracle',
  });
  if (resp.status === '1' && resp.result) {
    return {
      chain: chainId,
      safe_gas_price: resp.result.SafeGasPrice,
      propose_gas_price: resp.result.ProposeGasPrice,
      fast_gas_price: resp.result.FastGasPrice,
      suggest_base_fee: resp.result.suggestBaseFee,
      gas_used_ratio: resp.result.gasUsedRatio,
    };
  }
  return { chain: chainId, error: resp.result };
}

// 账户交易列表
export async function getAccountTransactions(chain: string, address: string, page: number = 1, offset: number = 10): Promise<any> {
  const chainId = CHAIN_ID_MAP[chain] || chain;
  const resp = await etherscanGet({
    chainid: chainId,
    module: 'account',
    action: 'txlist',
    address,
    startblock: '0',
    endblock: '99999999',
    page: page.toString(),
    offset: offset.toString(),
    sort: 'desc',
  });
  return {
    chain: chainId,
    address,
    transactions: resp.status === '1' ? (resp.result || []).map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      gas: tx.gas,
      gas_used: tx.gasUsed,
      gas_price: tx.gasPrice,
      status: tx.txreceipt_status === '1' ? 'success' : (tx.txreceipt_status === '0' ? 'failed' : 'pending'),
      block_number: parseInt(tx.blockNumber),
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      method: tx.functionName || '',
      input: tx.input?.substring(0, 10) || '',
    })) : [],
    count: resp.result?.length || 0,
  };
}

// 代币转账记录
export async function getTokenTransfers(chain: string, address: string, contractAddress?: string, page: number = 1, offset: number = 10): Promise<any> {
  const chainId = CHAIN_ID_MAP[chain] || chain;
  const params: Record<string, string> = {
    chainid: chainId,
    module: 'account',
    action: 'tokentx',
    address,
    page: page.toString(),
    offset: offset.toString(),
    sort: 'desc',
  };
  if (contractAddress) params.contractaddress = contractAddress;
  const resp = await etherscanGet(params);
  return {
    chain: chainId,
    address,
    transfers: resp.status === '1' ? (resp.result || []).map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      token_name: tx.tokenName,
      token_symbol: tx.tokenSymbol,
      token_decimal: parseInt(tx.tokenDecimal),
      contract_address: tx.contractAddress,
      block_number: parseInt(tx.blockNumber),
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
    })) : [],
    count: resp.result?.length || 0,
  };
}

// 合约内部交易
export async function getInternalTransactions(chain: string, address: string, page: number = 1, offset: number = 10): Promise<any> {
  const chainId = CHAIN_ID_MAP[chain] || chain;
  const resp = await etherscanGet({
    chainid: chainId,
    module: 'account',
    action: 'txlistinternal',
    address,
    startblock: '0',
    endblock: '99999999',
    page: page.toString(),
    offset: offset.toString(),
    sort: 'desc',
  });
  return {
    chain: chainId,
    address,
    internal_txs: resp.status === '1' ? (resp.result || []).map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      gas: tx.gas,
      gas_used: tx.gasUsed,
      is_error: tx.isError === '1',
      block_number: parseInt(tx.blockNumber),
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
    })) : [],
    count: resp.result?.length || 0,
  };
}

// 代理请求 - ETH 区块号
export async function getLatestBlockNumber(chain: string): Promise<any> {
  const chainId = CHAIN_ID_MAP[chain] || chain;
  const resp = await etherscanGet({
    chainid: chainId,
    module: 'proxy',
    action: 'eth_blockNumber',
  });
  return {
    chain: chainId,
    block_number_hex: resp.result,
    block_number: resp.result ? parseInt(resp.result, 16) : null,
  };
}

// API Key 状态检查
export function getApiKeyStatus(): any {
  return {
    configured: !!API_KEY,
    key_prefix: API_KEY ? API_KEY.substring(0, 6) + '...' : '',
    base_url: BASE_URL,
    supported_chains: Object.keys(CHAIN_ID_MAP).filter(k => !k.match(/^\d+$/)),
    proxy: PROXY_URL || 'none',
  };
}
