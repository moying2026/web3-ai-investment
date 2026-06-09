// 多 Agent 讨论服务
// 收集代币完整数据 → 5 个 Agent 依次分析 → decisionAgent 汇总
// 每个 Agent 给出文字分析 + 评分 + 风险标记 + 亮点

import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';

interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

interface AgentDiscussionEntry {
  agent_type: string;
  content: string;
  score: number;
  risk_flags: string[];
  highlights: string[];
}

interface DiscussionResult {
  session_id: string;
  chain: string;
  contract_address: string;
  token_symbol: string;
  entries: AgentDiscussionEntry[];
  final_recommendation: string;
  final_score: number;
  final_reasoning: string;
}

// ============ 数据库 ============

export function initDiscussionTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_discussions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      chain TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      content TEXT NOT NULL,
      score REAL,
      risk_flags TEXT,
      highlights TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_discussions_session ON agent_discussions(session_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_discussions_contract ON agent_discussions(chain, contract_address)`);
}

function storeDiscussionEntry(sessionId: string, chain: string, contract: string, entry: AgentDiscussionEntry): void {
  (db.prepare(`INSERT INTO agent_discussions (session_id, chain, contract_address, agent_type, content, score, risk_flags, highlights) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`) as SqliteStatement)
    .run(sessionId, chain, contract, entry.agent_type, entry.content, entry.score, JSON.stringify(entry.risk_flags), JSON.stringify(entry.highlights));
}

// ============ 数据收集 ============

function collectTokenData(chain: string, contract: string): any {
  const token = (db.prepare(`SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?`) as SqliteStatement).get(chain, contract);
  const onchainTxs = (db.prepare(`SELECT COUNT(*) as cnt, MIN(block_number) as min_block, MAX(block_number) as max_block FROM onchain_transactions WHERE chain = ? AND contract_address = ?`) as SqliteStatement).get(chain, contract);
  const recentTxs = (db.prepare(`SELECT * FROM onchain_transactions WHERE chain = ? AND contract_address = ? ORDER BY block_number DESC LIMIT 50`) as SqliteStatement).all(chain, contract);
  return { token, onchainTxs, recentTxs };
}

// ============ Agent 分析函数 ============

function riskAgentAnalysis(data: any): AgentDiscussionEntry {
  const { token, onchainTxs } = data;
  const flags: string[] = [];
  const highlights: string[] = [];
  let score = 50;
  const lines: string[] = [];

  lines.push('【风险评估 Agent 分析】');

  if (token) {
    // 合约验证状态
    if (token.contract_analysis) {
      lines.push(`合约分析: ${token.contract_analysis}`);
      if (token.contract_analysis.includes('mintable')) { flags.push('可增发'); score -= 15; }
      if (token.contract_analysis.includes('upgradeable') || token.contract_analysis.includes('proxy')) { flags.push('可升级/代理合约'); score -= 10; }
      if (token.contract_analysis.includes('标准合约')) { highlights.push('标准合约，无特殊权限'); score += 10; }
    }

    // 持有人数
    const holders = token.holders || 0;
    if (holders < 50) { flags.push(`持有人过少: ${holders}`); score -= 15; }
    else if (holders >= 500) { highlights.push(`持有人充足: ${holders}`); score += 10; }
    else { lines.push(`持有人: ${holders}（中等水平）`); }

    // 流动性
    const liq = parseFloat(token.liquidity || '0');
    if (liq < 5000) { flags.push(`流动性极低: $${liq.toFixed(0)}`); score -= 20; }
    else if (liq < 20000) { flags.push(`流动性偏低: $${liq.toFixed(0)}`); score -= 10; }
    else if (liq >= 100000) { highlights.push(`流动性充足: $${liq.toFixed(0)}`); score += 10; }

    // 市值
    const mc = parseFloat(token.market_cap || '0');
    if (mc > 0 && mc < 10000) { flags.push(`市值极低: $${mc.toFixed(0)}`); score -= 10; }

    // 发行时间
    if (token.launch_time) {
      const ageHours = (Date.now() / 1000 - token.launch_time) / 3600;
      if (ageHours < 1) { flags.push('上线不到 1 小时'); score -= 10; }
      else if (ageHours > 24 * 30) { highlights.push(`已上线 ${Math.floor(ageHours / 24)} 天`); score += 5; }
    }
  } else {
    lines.push('⚠️ 未找到代币基础数据');
    score = 20;
  }

  lines.push(`综合风险评分: ${Math.max(0, Math.min(100, score))}/100`);
  if (flags.length > 0) lines.push(`风险标记: ${flags.join(', ')}`);
  if (highlights.length > 0) lines.push(`亮点: ${highlights.join(', ')}`);

  return { agent_type: 'risk', content: lines.join('\n'), score: Math.max(0, Math.min(100, score)), risk_flags: flags, highlights };
}

function marketAgentAnalysis(data: any): AgentDiscussionEntry {
  const { token, onchainTxs, recentTxs } = data;
  const flags: string[] = [];
  const highlights: string[] = [];
  let score = 50;
  const lines: string[] = [];

  lines.push('【市场分析 Agent 分析】');

  if (token) {
    // 交易量
    const vol24h = parseFloat(token.volume_24h || '0');
    const vol1h = parseFloat(token.volume_1h || '0');
    lines.push(`24h 交易量: $${vol24h.toFixed(2)}, 1h 交易量: $${vol1h.toFixed(2)}`);
    if (vol24h < 1000) { flags.push('24h 交易量极低'); score -= 15; }
    else if (vol24h >= 50000) { highlights.push('24h 交易量活跃'); score += 10; }

    // 买卖比例
    const buyVol = parseFloat(token.volume_24h_buy || '0');
    const sellVol = parseFloat(token.volume_24h_sell || '0');
    if (buyVol > 0 && sellVol > 0) {
      const ratio = buyVol / sellVol;
      lines.push(`买卖比例: ${ratio.toFixed(2)} (买:$${buyVol.toFixed(0)} / 卖:$${sellVol.toFixed(0)})`);
      if (ratio > 2) { highlights.push('买入力量强劲'); score += 10; }
      else if (ratio < 0.5) { flags.push('卖压较大'); score -= 10; }
    }

    // 价格变化
    const pct1h = token.percent_change_1h ? parseFloat(token.percent_change_1h) : null;
    const pct24h = token.percent_change_24h ? parseFloat(token.percent_change_24h) : null;
    if (pct1h !== null) lines.push(`1h 涨跌: ${pct1h.toFixed(2)}%`);
    if (pct24h !== null) lines.push(`24h 涨跌: ${pct24h.toFixed(2)}%`);
    if (pct1h !== null && pct1h > 50) { flags.push('1h 涨幅过大，可能拉盘'); score -= 5; }
    if (pct24h !== null && pct24h < -50) { flags.push('24h 跌幅过大'); score -= 10; }

    // 独立交易者
    const traders24h = token.unique_trader_24h || 0;
    lines.push(`24h 独立交易者: ${traders24h}`);
    if (traders24h >= 100) { highlights.push('交易者活跃'); score += 5; }
    else if (traders24h < 10) { flags.push('交易者极少'); score -= 10; }
  }

  // 链上交易活跃度
  if (onchainTxs) {
    lines.push(`数据库交易记录: ${onchainTxs.cnt} 条 (block ${onchainTxs.min_block} ~ ${onchainTxs.max_block})`);
  }

  // 交易趋势（最近 50 条）
  if (recentTxs && recentTxs.length > 0) {
    const amounts = recentTxs.map((t: any) => parseFloat(t.amount?.replace(/,/g, '') || '0')).filter((a: number) => a > 0);
    if (amounts.length > 0) {
      const avgAmount = amounts.reduce((a: number, b: number) => a + b, 0) / amounts.length;
      const maxAmount = Math.max(...amounts);
      lines.push(`近期交易: 平均 ${avgAmount.toFixed(2)}, 最大 ${maxAmount.toFixed(2)}`);
      if (maxAmount > avgAmount * 10) { flags.push('存在异常大额交易'); score -= 5; }
    }
  }

  lines.push(`市场评分: ${Math.max(0, Math.min(100, score))}/100`);

  return { agent_type: 'market', content: lines.join('\n'), score: Math.max(0, Math.min(100, score)), risk_flags: flags, highlights };
}

function issuerAgentAnalysis(data: any): AgentDiscussionEntry {
  const { token } = data;
  const flags: string[] = [];
  const highlights: string[] = [];
  let score = 50;
  const lines: string[] = [];

  lines.push('【发行方分析 Agent 分析】');

  if (token) {
    const creator = token.creator_address;
    if (creator) {
      lines.push(`发行方地址: ${creator}`);
      // 检查发行方历史代币数
      const issuerTokens = (db.prepare(`SELECT COUNT(*) as cnt FROM tokens WHERE creator_address = ? AND chain_id = ?`) as SqliteStatement).get(creator, token.chain_id);
      const count = issuerTokens?.cnt || 0;
      lines.push(`发行方历史代币数: ${count}`);
      if (count > 10) { flags.push(`发行方发行过多代币: ${count} 个`); score -= 15; }
      else if (count === 1) { highlights.push('发行方首个代币'); score += 5; }
    } else {
      lines.push('发行方地址: 未知');
    }

    // 总供应量
    if (token.total_supply) lines.push(`总供应量: ${token.total_supply}`);
    if (token.circulating_supply) lines.push(`流通供应量: ${token.circulating_supply}`);
    if (token.burned_amount && parseFloat(token.burned_amount) > 0) {
      highlights.push(`已销毁: ${token.burned_amount}`);
      score += 5;
    }

    // 增发/升级风险
    if (token.is_mintable) { flags.push('可增发'); score -= 10; }
    if (token.is_upgradeable) { flags.push('可升级'); score -= 5; }
  }

  lines.push(`发行方评分: ${Math.max(0, Math.min(100, score))}/100`);
  return { agent_type: 'issuer', content: lines.join('\n'), score: Math.max(0, Math.min(100, score)), risk_flags: flags, highlights };
}

function onchainAgentAnalysis(data: any): AgentDiscussionEntry {
  const { token, recentTxs } = data;
  const flags: string[] = [];
  const highlights: string[] = [];
  let score = 50;
  const lines: string[] = [];

  lines.push('【链上分析 Agent 分析】');

  if (recentTxs && recentTxs.length > 0) {
    lines.push(`分析样本: ${recentTxs.length} 条链上交易`);

    // 地址分布分析
    const fromAddrs = new Set(recentTxs.map((t: any) => t.from_address));
    const toAddrs = new Set(recentTxs.map((t: any) => t.to_address));
    const allAddrs = new Set([...fromAddrs, ...toAddrs]);
    lines.push(`涉及地址数: ${allAddrs.size} (from: ${fromAddrs.size}, to: ${toAddrs.size})`);

    // 大户分析（按金额排序）
    const sorted = [...recentTxs].sort((a: any, b: any) => {
      const va = parseFloat(a.amount?.replace(/,/g, '') || '0');
      const vb = parseFloat(b.amount?.replace(/,/g, '') || '0');
      return vb - va;
    });

    if (sorted.length > 0) {
      const topTx = sorted[0];
      const topAmount = parseFloat(topTx.amount?.replace(/,/g, '') || '0');
      const totalAmount = sorted.reduce((sum: number, t: any) => sum + parseFloat(t.amount?.replace(/,/g, '') || '0'), 0);
      const topPercent = totalAmount > 0 ? (topAmount / totalAmount * 100) : 0;
      lines.push(`最大单笔交易占比: ${topPercent.toFixed(1)}% (${topTx.from_address?.substring(0, 10)}... → ${topTx.to_address?.substring(0, 10)}...)`);
      if (topPercent > 50) { flags.push('单笔交易占比过大，疑似大户操控'); score -= 15; }
    }

    // 重复地址检测（机器人/刷量）
    const fromCounts: Record<string, number> = {};
    recentTxs.forEach((t: any) => {
      if (t.from_address) fromCounts[t.from_address] = (fromCounts[t.from_address] || 0) + 1;
    });
    const repeatAddrs = Object.entries(fromCounts).filter(([_, cnt]) => (cnt as number) >= 3);
    if (repeatAddrs.length > 0) {
      const top = repeatAddrs.sort((a, b) => (b[1] as number) - (a[1] as number))[0];
      lines.push(`重复发起地址: ${repeatAddrs.length} 个 (最高 ${top[0]?.substring(0, 10)}... 发起 ${top[1]} 次)`);
      if ((top[1] as number) >= 5) { flags.push('疑似机器人/刷量地址'); score -= 10; }
    } else {
      highlights.push('未发现明显重复地址');
      score += 5;
    }

    // 时间分布
    const timestamps = recentTxs.map((t: any) => t.timestamp).filter(Boolean);
    if (timestamps.length > 1) {
      lines.push(`交易时间范围: ${timestamps[timestamps.length - 1]} ~ ${timestamps[0]}`);
    }
  } else {
    lines.push('⚠️ 无链上交易数据可供分析');
    score = 30;
  }

  lines.push(`链上评分: ${Math.max(0, Math.min(100, score))}/100`);
  return { agent_type: 'onchain', content: lines.join('\n'), score: Math.max(0, Math.min(100, score)), risk_flags: flags, highlights };
}

function decisionAgentAnalysis(entries: AgentDiscussionEntry[], tokenSymbol: string): AgentDiscussionEntry {
  const riskEntry = entries.find(e => e.agent_type === 'risk')!;
  const marketEntry = entries.find(e => e.agent_type === 'market')!;
  const issuerEntry = entries.find(e => e.agent_type === 'issuer')!;
  const onchainEntry = entries.find(e => e.agent_type === 'onchain')!;

  const avgScore = (riskEntry.score + marketEntry.score + issuerEntry.score + onchainEntry.score) / 4;
  const allFlags = [...riskEntry.risk_flags, ...marketEntry.risk_flags, ...issuerEntry.risk_flags, ...onchainEntry.risk_flags];
  const allHighlights = [...riskEntry.highlights, ...marketEntry.highlights, ...issuerEntry.highlights, ...onchainEntry.highlights];

  let recommendation: string;
  let reasoning: string;

  if (avgScore >= 65 && allFlags.length <= 2) {
    recommendation = 'BUY';
    reasoning = `${tokenSymbol} 综合评分 ${avgScore.toFixed(0)}/100，风险较低（${allFlags.length} 个风险标记），具备投资价值。`;
  } else if (avgScore >= 50) {
    recommendation = 'HOLD';
    reasoning = `${tokenSymbol} 综合评分 ${avgScore.toFixed(0)}/100，存在一定风险（${allFlags.length} 个标记），建议持有观察。`;
  } else if (avgScore >= 35) {
    recommendation = 'WATCH';
    reasoning = `${tokenSymbol} 综合评分 ${avgScore.toFixed(0)}/100，风险较多（${allFlags.join('、')}），建议观望。`;
  } else {
    recommendation = 'AVOID';
    reasoning = `${tokenSymbol} 综合评分仅 ${avgScore.toFixed(0)}/100，风险显著（${allFlags.join('、')}），建议回避。`;
  }

  const lines = [
    '【决策 Agent 综合评估】',
    '',
    `代币: ${tokenSymbol}`,
    `综合评分: ${avgScore.toFixed(0)}/100`,
    `建议: ${recommendation}`,
    '',
    '--- 各 Agent 评分 ---',
    `风险评估: ${riskEntry.score}/100`,
    `市场分析: ${marketEntry.score}/100`,
    `发行方分析: ${issuerEntry.score}/100`,
    `链上分析: ${onchainEntry.score}/100`,
    '',
    '--- 风险标记 ---',
    ...allFlags.map(f => `⚠️ ${f}`),
    '',
    '--- 亮点 ---',
    ...allHighlights.map(h => `✅ ${h}`),
    '',
    '--- 结论 ---',
    reasoning,
  ];

  return {
    agent_type: 'decision',
    content: lines.join('\n'),
    score: Math.round(avgScore),
    risk_flags: allFlags,
    highlights: allHighlights,
  };
}

// ============ 主流程 ============

export async function runDiscussion(chain: string, contractAddress: string): Promise<DiscussionResult> {
  initDiscussionTable();

  // chain 映射：bsc→56, eth→1 等
  const CHAIN_MAP: Record<string, string> = {
    'bsc': '56', '56': '56', 'eth': '1', '1': '1', 'base': '8453', '8453': '8453',
    'solana': 'CT_501', 'CT_501': 'CT_501',
  };
  const dbChain = CHAIN_MAP[chain.toLowerCase()] || chain;

  // 收集数据（用 dbChain 查询 tokens 表）
  const data = collectTokenData(dbChain, contractAddress);
  const tokenSymbol = data.token?.symbol || contractAddress.substring(0, 10);
  const sessionId = uuidv4();

  // 运行 5 个 Agent
  const entries: AgentDiscussionEntry[] = [];

  const risk = riskAgentAnalysis(data);
  entries.push(risk);
  storeDiscussionEntry(sessionId, chain, contractAddress, risk);

  const market = marketAgentAnalysis(data);
  entries.push(market);
  storeDiscussionEntry(sessionId, chain, contractAddress, market);

  const issuer = issuerAgentAnalysis(data);
  entries.push(issuer);
  storeDiscussionEntry(sessionId, chain, contractAddress, issuer);

  const onchain = onchainAgentAnalysis(data);
  entries.push(onchain);
  storeDiscussionEntry(sessionId, chain, contractAddress, onchain);

  const decision = decisionAgentAnalysis(entries, tokenSymbol);
  entries.push(decision);
  storeDiscussionEntry(sessionId, chain, contractAddress, decision);

  return {
    session_id: sessionId,
    chain,
    contract_address: contractAddress,
    token_symbol: tokenSymbol,
    entries,
    final_recommendation: decision.risk_flags.length <= 2 && decision.score >= 50 ? 'BUY/HOLD' : (decision.score >= 35 ? 'WATCH' : 'AVOID'),
    final_score: decision.score,
    final_reasoning: decision.content.split('--- 结论 ---')[1]?.trim() || '',
  };
}

// 查询历史讨论记录
export function getDiscussionHistory(chain: string, contractAddress: string, limit: number = 10): any[] {
  const sessions = (db.prepare(`SELECT DISTINCT session_id, MIN(created_at) as started_at FROM agent_discussions WHERE chain = ? AND contract_address = ? GROUP BY session_id ORDER BY started_at DESC LIMIT ?`) as SqliteStatement).all(chain, contractAddress, limit);
  return sessions.map((s: any) => {
    const entries = (db.prepare(`SELECT agent_type, content, score, risk_flags, highlights, created_at FROM agent_discussions WHERE session_id = ? ORDER BY id`) as SqliteStatement).all(s.session_id);
    return {
      session_id: s.session_id,
      started_at: s.started_at,
      entries: entries.map((e: any) => ({
        ...e,
        risk_flags: JSON.parse(e.risk_flags || '[]'),
        highlights: JSON.parse(e.highlights || '[]'),
      })),
    };
  });
}
