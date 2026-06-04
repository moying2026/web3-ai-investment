import { db } from '../db/database';
import { BinanceToken, SnapshotType, SocialTopic } from '../types/token';
import { fetchSingleTokenOnchain } from './onchainService';
import { fetchSingleIssuerData } from './issuerService';

// 快照时间点定义（相对于首次检测的时间偏移，毫秒）
const SNAPSHOT_INTERVALS: Record<SnapshotType, number> = {
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

// 已知代币缓存
const knownTokens = new Set<string>();

// 新币判定阈值（7天 = 604800000 毫秒）
const NEW_COIN_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// 判断是否为新币（上线7天内）
function isNewCoinByLaunchTime(launchTime: string | number | undefined): boolean {
  if (!launchTime) return true; // 无上线时间默认当作新币
  const launchMs = typeof launchTime === 'string' ? parseInt(launchTime) : launchTime;
  if (isNaN(launchMs)) return true;
  const ageMs = Date.now() - launchMs;
  return ageMs >= 0 && ageMs <= NEW_COIN_THRESHOLD_MS;
}

// node:sqlite prepare 返回的对象类型
interface SqliteStatement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

// 初始化已知代币缓存
export function initKnownTokensCache(): void {
  const stmt = db.prepare('SELECT chain_id, contract_address FROM tokens') as SqliteStatement;
  const rows = stmt.all() as Array<{ chain_id: string; contract_address: string }>;
  for (const row of rows) {
    knownTokens.add(`${row.chain_id}:${row.contract_address}`);
  }
  console.log(`[TokenService] 已加载 ${knownTokens.size} 个已知代币到缓存`);
}

// 判断是否为新代币
export function isNewToken(chainId: string, contractAddress: string): boolean {
  return !knownTokens.has(`${chainId}:${contractAddress}`);
}

// 存储代币（首次检测）— 仅新币（上线7天内）进入主流程
export function insertToken(token: BinanceToken): boolean {
  const key = `${token.chainId}:${token.contractAddress}`;
  if (knownTokens.has(key)) return false;

  const now = new Date().toISOString();
  const metaInfo = token.metaInfo || {};
  const isNew = isNewCoinByLaunchTime(token.launchTime);

  // 老币（上线超过7天）存入 trending_tokens 表，不进入新币追踪流程
  if (!isNew) {
    insertTrendingToken(token);
    knownTokens.add(key);
    return false;
  }

  const stmt = db.prepare(`
    INSERT INTO tokens (
      chain_id, contract_address, symbol, icon, links, preview_link,
      aster_pair, decimals, price_first, price_latest,
      percent_change_1m, percent_change_5m, percent_change_1h, percent_change_4h, percent_change_24h,
      volume_1m, volume_5m, volume_1h, volume_4h, volume_24h, volume_24h_buy, volume_24h_sell,
      count_1m, count_5m, count_1h, count_4h, count_24h, count_24h_buy, count_24h_sell,
      unique_trader_24h, unique_trader_4h, unique_trader_1h, unique_trader_5m, unique_trader_1m,
      liquidity, holders, market_cap, launch_time,
      token_tag, audit_info, alpha_info, meta_info,
      kyc_holders, holders_top10_percent, smart_money_holding_percent, kol_holding_percent,
      dev_holding_percent, pro_holders_percent, new_address_holders_percent, bundles_holding_percent,
      search_count_24h, creator_address, origin_name, blacklist, whitelist, ai_narrative_flag,
      first_seen_at, is_new_coin, dev_tokens, dev_migrated, dev_migrated_percent,
      chart_1m, chart_5m, chart_1h, chart_4h, chart_24h
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `) as SqliteStatement;

  try {
    stmt.run(
      token.chainId,
      token.contractAddress,
      token.symbol,
      token.icon,
      JSON.stringify(token.links || []),
      JSON.stringify(token.previewLink || {}),
      token.asterPair,
      token.decimals || 18,
      token.price,
      token.price,
      token.percentChange1m,
      token.percentChange5m,
      token.percentChange1h,
      token.percentChange4h,
      token.percentChange24h,
      token.volume1m,
      token.volume5m,
      token.volume1h,
      token.volume4h,
      token.volume24h,
      token.volume24hBuy,
      token.volume24hSell,
      safeInt(token.count1m),
      safeInt(token.count5m),
      safeInt(token.count1h),
      safeInt(token.count4h),
      safeInt(token.count24h),
      safeInt(token.count24hBuy),
      safeInt(token.count24hSell),
      safeInt(token.uniqueTrader24h),
      safeInt(token.uniqueTrader4h),
      safeInt(token.uniqueTrader1h),
      safeInt(token.uniqueTrader5m),
      safeInt(token.uniqueTrader1m),
      token.liquidity,
      safeInt(token.holders),
      token.marketCap,
      safeInt(token.launchTime),
      JSON.stringify(token.tokenTag || {}),
      JSON.stringify(token.auditInfo || {}),
      JSON.stringify(token.alphaInfo || null),
      JSON.stringify(metaInfo),
      safeInt(token.kycHolders),
      token.holdersTop10Percent,
      token.smartMoneyHoldingPercent,
      token.kolHoldingPercent,
      token.devHoldingPercent,
      token.proHoldersPercent,
      token.newAddressHoldersPercent,
      token.bundlesHoldingPercent,
      safeInt(token.searchCount24h),
      metaInfo.creatorAddress || null,
      metaInfo.originName || null,
      metaInfo.blacklist ? 1 : 0,
      metaInfo.whitelist ? 1 : 0,
      metaInfo.aiNarrativeFlag || 0,
      now,
      isNew ? 1 : 0,
      token.devTokens || null,
      token.devMigrated || null,
      token.devMigratedPercent || null,
      typeof token.chart1m === 'string' ? token.chart1m : (token.chart1m ? JSON.stringify(token.chart1m) : null),
      typeof token.chart5m === 'string' ? token.chart5m : (token.chart5m ? JSON.stringify(token.chart5m) : null),
      typeof token.chart1h === 'string' ? token.chart1h : (token.chart1h ? JSON.stringify(token.chart1h) : null),
      typeof token.chart4h === 'string' ? token.chart4h : (token.chart4h ? JSON.stringify(token.chart4h) : null),
      typeof token.chart24h === 'string' ? token.chart24h : (token.chart24h ? JSON.stringify(token.chart24h) : null)
    );

    knownTokens.add(key);

    // 捕获首次发现快照（用于后期热门潜质分析）
    captureFirstSeenSnapshot(token, now);

    // 异步采集链上数据（不阻塞插入流程）
    fetchSingleTokenOnchain(token.chainId, token.contractAddress, token.symbol, token.decimals)
      .catch(err => console.error(`[Onchain] ${token.symbol} 后台采集失败:`, err));

    // 异步采集发行方历史数据
    if (metaInfo.creatorAddress) {
      fetchSingleIssuerData(token.chainId, metaInfo.creatorAddress)
        .catch(err => console.error(`[Issuer] ${token.symbol} 发行方数据采集失败:`, err));
    }

    return true;
  } catch (err: any) {
    if (String(err).includes('UNIQUE constraint failed')) {
      knownTokens.add(key);
      return false;
    }
    throw err;
  }
}

// 捕获首次发现快照（用于后期热门潜质分析）
function captureFirstSeenSnapshot(token: BinanceToken, firstSeenAt: string): void {
  try {
    const launchTime = safeInt(token.launchTime);
    const launchAgeMinutes = launchTime ? (Date.now() - launchTime) / 60000 : null;
    const metaInfo = token.metaInfo || {};

    // 获取发行方信息（如果已有）
    let issuerTotalTokens = null;
    let issuerSurvivalRate = null;
    if (metaInfo.creatorAddress) {
      const issuer = db.prepare('SELECT total_tokens, survival_rate FROM issuer_profiles WHERE issuer_address = ?').get(metaInfo.creatorAddress) as any;
      if (issuer) {
        issuerTotalTokens = issuer.total_tokens;
        issuerSurvivalRate = issuer.survival_rate;
      }
    }

    // 检查同名代币数量
    const similar = db.prepare(
      'SELECT COUNT(*) as c FROM tokens WHERE UPPER(symbol) = UPPER(?) AND chain_id != ?'
    ).get(token.symbol, token.chainId) as any;
    const chainCount = (similar?.c || 0) + 1;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO token_first_seen (
        chain_id, contract_address, symbol, first_seen_at, launch_time, launch_age_minutes,
        price_first, liquidity_first, holders_first, market_cap_first,
        volume_1h_first, volume_24h_first, unique_trader_1h_first, unique_trader_24h_first,
        holders_top10_percent_first, smart_money_holding_first, dev_holding_first,
        bundles_holding_first, search_count_24h_first,
        creator_address, issuer_total_tokens, issuer_survival_rate,
        audit_risk_level, audit_is_verified, chain_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `) as SqliteStatement;

    stmt.run(
      token.chainId,
      token.contractAddress,
      token.symbol,
      firstSeenAt,
      launchTime,
      launchAgeMinutes,
      token.price,
      token.liquidity,
      safeInt(token.holders),
      token.marketCap,
      token.volume1h,
      token.volume24h,
      safeInt(token.uniqueTrader1h),
      safeInt(token.uniqueTrader24h),
      token.holdersTop10Percent,
      token.smartMoneyHoldingPercent,
      token.devHoldingPercent,
      token.bundlesHoldingPercent,
      safeInt(token.searchCount24h),
      metaInfo.creatorAddress || null,
      issuerTotalTokens,
      issuerSurvivalRate,
      token.auditInfo?.riskLevel || null,
      token.auditInfo?.riskLevel === 1 ? 1 : 0,
      chainCount
    );

    console.log(`[FirstSeen] ${token.symbol} (${token.chainId}): launch_age=${launchAgeMinutes?.toFixed(1)}min, liq=${token.liquidity}, holders=${token.holders}`);
  } catch (err) {
    // 静默失败，不影响主流程
    console.error(`[FirstSeen] ${token.symbol} 快照捕获失败:`, err);
  }
}

// 存储老币到 trending_tokens 表（上线超过7天的热门代币）
function insertTrendingToken(token: BinanceToken): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO trending_tokens (
      chain_id, contract_address, symbol, price, market_cap, liquidity,
      holders, volume_24h, percent_change_24h, launch_time, first_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `) as SqliteStatement;

  stmt.run(
    token.chainId, token.contractAddress, token.symbol,
    token.price, token.marketCap, token.liquidity,
    safeInt(token.holders), token.volume24h, token.percentChange24h,
    safeInt(token.launchTime)
  );
}

// 更新已有代币的最新价格
export function updateTokenLatestPrice(token: BinanceToken): void {
  (db.prepare(`
    UPDATE tokens SET
      price_latest = ?, percent_change_1m = ?, percent_change_5m = ?,
      percent_change_1h = ?, percent_change_4h = ?, percent_change_24h = ?,
      volume_24h = ?, liquidity = ?, holders = ?, market_cap = ?,
      unique_trader_24h = ?, count_24h = ?, search_count_24h = ?,
      updated_at = datetime('now')
    WHERE chain_id = ? AND contract_address = ?
  `) as SqliteStatement).run(
    token.price, token.percentChange1m, token.percentChange5m,
    token.percentChange1h, token.percentChange4h, token.percentChange24h,
    token.volume24h, token.liquidity, safeInt(token.holders), token.marketCap,
    safeInt(token.uniqueTrader24h), safeInt(token.count24h), safeInt(token.searchCount24h),
    token.chainId, token.contractAddress
  );
}

// 创建追踪计划
export function createTrackingPlans(chainId: string, contractAddress: string): void {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO tracking_plans (chain_id, contract_address, snapshot_type, target_at)
    VALUES (?, ?, ?, ?)
  `) as SqliteStatement;

  for (const [snapshotType, intervalMs] of Object.entries(SNAPSHOT_INTERVALS)) {
    const targetAt = new Date(now + intervalMs).toISOString();
    stmt.run(chainId, contractAddress, snapshotType, targetAt);
  }

  console.log(`[TokenService] 为 ${chainId}:${contractAddress} 创建了 ${Object.keys(SNAPSHOT_INTERVALS).length} 个追踪计划`);
}

// 获取待执行的快照计划
export function getPendingSnapshotPlans(): Array<{
  id: number; chain_id: string; contract_address: string; snapshot_type: string; target_at: string;
}> {
  const now = new Date().toISOString();
  return (db.prepare(`
    SELECT id, chain_id, contract_address, snapshot_type, target_at
    FROM tracking_plans WHERE executed = 0 AND target_at <= ?
    ORDER BY target_at ASC LIMIT 50
  `) as SqliteStatement).all(now) as any[];
}

// 执行快照
export function executeSnapshot(
  plan: { id: number; chain_id: string; contract_address: string; snapshot_type: string; target_at: string },
  tokenData: BinanceToken | null
): void {
  const now = new Date().toISOString();

  if (!tokenData) {
    (db.prepare(`
      INSERT OR REPLACE INTO token_snapshots (
        chain_id, contract_address, snapshot_type, snapshot_at, target_at, price, status
      ) VALUES (?, ?, ?, ?, ?, '0', 'missed')
    `) as SqliteStatement).run(plan.chain_id, plan.contract_address, plan.snapshot_type, now, plan.target_at);
  } else {
    const firstToken = (db.prepare(
      'SELECT price_first, liquidity, holders FROM tokens WHERE chain_id = ? AND contract_address = ?'
    ) as SqliteStatement).get(plan.chain_id, plan.contract_address) as any;

    const priceFirst = firstToken ? parseFloat(firstToken.price_first) : 0;
    const priceNow = parseFloat(tokenData.price);
    const priceChangeFromFirst = priceFirst > 0 ? ((priceNow - priceFirst) / priceFirst * 100).toFixed(2) : '0';

    const prevSnapshot = (db.prepare(`
      SELECT price FROM token_snapshots
      WHERE chain_id = ? AND contract_address = ?
      ORDER BY snapshot_at DESC LIMIT 1
    `) as SqliteStatement).get(plan.chain_id, plan.contract_address) as any;

    const pricePrev = prevSnapshot ? parseFloat(prevSnapshot.price) : 0;
    const priceChangeFromPrev = pricePrev > 0 ? ((priceNow - pricePrev) / pricePrev * 100).toFixed(2) : '0';

    const liquidityFirst = firstToken ? parseFloat(firstToken.liquidity || '0') : 0;
    const liquidityNow = parseFloat(tokenData.liquidity || '0');
    const liquidityChange = liquidityFirst > 0 ? ((liquidityNow - liquidityFirst) / liquidityFirst * 100).toFixed(2) : '0';

    const holdersFirst = firstToken ? (firstToken.holders || 0) : 0;
    const holdersNow = safeInt(tokenData.holders) || 0;
    const holdersChange = holdersNow - holdersFirst;

    (db.prepare(`
      INSERT OR REPLACE INTO token_snapshots (
        chain_id, contract_address, snapshot_type, snapshot_at, target_at,
        price, price_change_from_first, price_change_from_prev,
        volume_24h, volume_1h, liquidity, liquidity_change_from_first,
        holders, holders_change_from_first, unique_trader_24h, count_24h,
        holders_top10_percent, smart_money_holding_percent, dev_holding_percent, bundles_holding_percent,
        raw_data, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')
    `) as SqliteStatement).run(
      plan.chain_id, plan.contract_address, plan.snapshot_type, now, plan.target_at,
      tokenData.price, priceChangeFromFirst, priceChangeFromPrev,
      tokenData.volume24h, tokenData.volume1h, tokenData.liquidity, liquidityChange,
      holdersNow, holdersChange, safeInt(tokenData.uniqueTrader24h), safeInt(tokenData.count24h),
      tokenData.holdersTop10Percent, tokenData.smartMoneyHoldingPercent,
      tokenData.devHoldingPercent, tokenData.bundlesHoldingPercent,
      JSON.stringify(tokenData)
    );
  }

  (db.prepare('UPDATE tracking_plans SET executed = 1, executed_at = ? WHERE id = ?') as SqliteStatement).run(now, plan.id);
}

// 存储社交话题
export function upsertSocialTopics(topics: SocialTopic[]): number {
  let count = 0;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO social_topics (
      topic_id, chain_id, topic_name_en, topic_name_cn, topic_type, topic_link,
      topic_tags, create_time, rising_time, viral_time,
      ai_summary_en, ai_summary_cn,
      topic_net_inflow, topic_net_inflow_1h, topic_net_inflow_ath,
      token_size, token_list, contract_addresses, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) as SqliteStatement;

  const now = new Date().toISOString();

  for (const topic of topics) {
    const contractAddresses = (topic.tokenList || []).map(t => t.contractAddress);
    stmt.run(
      topic.topicId, topic.chainId,
      topic.name?.topicNameEn || '', topic.name?.topicNameCn || '',
      topic.type, topic.topicLink,
      JSON.stringify(topic.topicTags || []),
      topic.createTime, topic.risingTime, topic.viralTime,
      topic.aiSummary?.aiSummaryEn || '', topic.aiSummary?.aiSummaryCn || '',
      topic.topicNetInflow, topic.topicNetInflow1h, topic.topicNetInflowAth,
      topic.tokenSize, JSON.stringify(topic.tokenList || []),
      JSON.stringify(contractAddresses), now
    );
    count++;
  }

  return count;
}

// 获取代币列表
// 发行时间范围映射（毫秒）
const LAUNCH_WITHIN_MAP: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

// 链名称 → chainId 映射
const CHAIN_MAP: Record<string, string> = {
  'bsc': '56',
  'solana': 'CT_501',
  'base': '8453',
  'eth': '1',
};

// 风险等级映射（基于 auditInfo.riskLevel）
// riskLevel: 1=low, 2=medium, 3=high
const RISK_LEVEL_MAP: Record<string, number[]> = {
  'low': [1],
  'medium': [2],
  'high': [3],
};

export function getTokens(params: {
  page?: number; pageSize?: number; chain?: string; symbol?: string;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
  launch_within?: string; creator?: string; risk_level?: string;
  holders_min?: number; holders_max?: number;
  liquidity_min?: number; liquidity_max?: number;
  is_new_coin?: number;
}): { data: any[]; total: number; page: number; pageSize: number } {
  const page = params.page || 1;
  const pageSize = Math.min(params.pageSize || 20, 100);
  const offset = (page - 1) * pageSize;

  let where = '1=1';
  const queryParams: any[] = [];

  // 链筛选（支持链名称和 chainId）
  if (params.chain) {
    const chainId = CHAIN_MAP[params.chain.toLowerCase()] || params.chain;
    where += ' AND chain_id = ?';
    queryParams.push(chainId);
  }

  // 代币名称模糊搜索
  if (params.symbol) {
    where += ' AND symbol LIKE ?';
    queryParams.push(`%${params.symbol}%`);
  }

  // 发行时间范围筛选
  if (params.launch_within && params.launch_within !== 'all' && LAUNCH_WITHIN_MAP[params.launch_within]) {
    const thresholdMs = Date.now() - LAUNCH_WITHIN_MAP[params.launch_within];
    where += ' AND launch_time >= ?';
    queryParams.push(String(thresholdMs));
  }

  // 发行方筛选（精确匹配）
  if (params.creator) {
    where += ' AND creator_address = ?';
    queryParams.push(params.creator);
  }

  // 风险等级筛选（基于 audit_info JSON 中的 riskLevel）
  if (params.risk_level && RISK_LEVEL_MAP[params.risk_level]) {
    const levels = RISK_LEVEL_MAP[params.risk_level];
    const placeholders = levels.map(() => '?').join(',');
    // audit_info 存储为 JSON 字符串，用 json_extract 提取 riskLevel
    where += ` AND json_extract(audit_info, '$.riskLevel') IN (${placeholders})`;
    queryParams.push(...levels);
  }

  // 持有人范围筛选
  if (params.holders_min !== undefined) {
    where += ' AND holders >= ?';
    queryParams.push(params.holders_min);
  }
  if (params.holders_max !== undefined) {
    where += ' AND holders <= ?';
    queryParams.push(params.holders_max);
  }

  // 流动性范围筛选
  if (params.liquidity_min !== undefined) {
    where += ' AND CAST(liquidity AS REAL) >= ?';
    queryParams.push(params.liquidity_min);
  }
  if (params.liquidity_max !== undefined) {
    where += ' AND CAST(liquidity AS REAL) <= ?';
    queryParams.push(params.liquidity_max);
  }

  // 新币筛选
  if (params.is_new_coin !== undefined) {
    where += ' AND is_new_coin = ?';
    queryParams.push(params.is_new_coin);
  }

  const sortBy = ['price_latest', 'market_cap', 'liquidity', 'holders', 'volume_24h', 'first_seen_at', 'launch_time'].includes(params.sortBy || '')
    ? params.sortBy : 'first_seen_at';
  const sortOrder = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const totalRow = (db.prepare(`SELECT COUNT(*) as count FROM tokens WHERE ${where}`) as SqliteStatement).get(...queryParams) as any;
  const data = (db.prepare(`SELECT * FROM tokens WHERE ${where} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`) as SqliteStatement)
    .all(...queryParams, pageSize, offset);

  return { data, total: totalRow.count, page, pageSize };
}

// 获取代币详情
export function getTokenDetail(chainId: string, contractAddress: string): any | null {
  return (db.prepare('SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?') as SqliteStatement)
    .get(chainId, contractAddress) || null;
}

// 获取代币快照
export function getTokenSnapshots(chainId: string, contractAddress: string): any[] {
  return (db.prepare(`
    SELECT * FROM token_snapshots WHERE chain_id = ? AND contract_address = ? ORDER BY snapshot_at ASC
  `) as SqliteStatement).all(chainId, contractAddress);
}

// 获取社交话题列表
export function getSocialTopics(params: {
  page?: number; pageSize?: number; type?: string;
}): { data: any[]; total: number; page: number; pageSize: number } {
  const page = params.page || 1;
  const pageSize = Math.min(params.pageSize || 20, 100);
  const offset = (page - 1) * pageSize;

  let where = '1=1';
  const queryParams: any[] = [];
  if (params.type) { where += ' AND topic_type = ?'; queryParams.push(params.type); }

  const totalRow = (db.prepare(`SELECT COUNT(*) as count FROM social_topics WHERE ${where}`) as SqliteStatement).get(...queryParams) as any;
  const data = (db.prepare(`SELECT * FROM social_topics WHERE ${where} ORDER BY create_time DESC LIMIT ? OFFSET ?`) as SqliteStatement)
    .all(...queryParams, pageSize, offset);

  return { data, total: totalRow.count, page, pageSize };
}

// 获取统计数据
export function getStats(): any {
  const totalTokens = (db.prepare('SELECT COUNT(*) as c FROM tokens') as SqliteStatement).get() as any;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString();
  const todayNewTokens = (db.prepare('SELECT COUNT(*) as c FROM tokens WHERE first_seen_at >= ?') as SqliteStatement).get(todayStr) as any;
  const totalSnapshots = (db.prepare('SELECT COUNT(*) as c FROM token_snapshots') as SqliteStatement).get() as any;
  const totalSocialTopics = (db.prepare('SELECT COUNT(*) as c FROM social_topics') as SqliteStatement).get() as any;
  const trackingActive = (db.prepare('SELECT COUNT(*) as c FROM tracking_plans WHERE executed = 0') as SqliteStatement).get() as any;
  const lastPoll = (db.prepare('SELECT MAX(created_at) as t FROM tokens') as SqliteStatement).get() as any;

  return {
    totalTokens: totalTokens.c,
    todayNewTokens: todayNewTokens.c,
    totalSnapshots: totalSnapshots.c,
    totalSocialTopics: totalSocialTopics.c,
    trackingActive: trackingActive.c,
    lastPollTime: lastPoll?.t || null,
  };
}

function safeInt(val: any): number | null {
  if (val === null || val === undefined) return null;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? null : n;
}
