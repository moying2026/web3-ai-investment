import path from 'path';
import fs from 'fs';

// 使用 Node.js 内置 node:sqlite（需要 --experimental-sqlite）
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'web3_tokens.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// 开启 WAL 模式
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

export function initDatabase(): void {
  // tokens 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      symbol TEXT,
      icon TEXT,
      links TEXT,
      preview_link TEXT,
      aster_pair TEXT,
      decimals INTEGER DEFAULT 18,
      price_first TEXT,
      price_latest TEXT,
      percent_change_1m TEXT,
      percent_change_5m TEXT,
      percent_change_1h TEXT,
      percent_change_4h TEXT,
      percent_change_24h TEXT,
      volume_1m TEXT,
      volume_5m TEXT,
      volume_1h TEXT,
      volume_4h TEXT,
      volume_24h TEXT,
      volume_24h_buy TEXT,
      volume_24h_sell TEXT,
      count_1m INTEGER,
      count_5m INTEGER,
      count_1h INTEGER,
      count_4h INTEGER,
      count_24h INTEGER,
      count_24h_buy INTEGER,
      count_24h_sell INTEGER,
      unique_trader_24h INTEGER,
      unique_trader_4h INTEGER,
      unique_trader_1h INTEGER,
      unique_trader_5m INTEGER,
      unique_trader_1m INTEGER,
      liquidity TEXT,
      holders INTEGER,
      market_cap TEXT,
      launch_time INTEGER,
      token_tag TEXT,
      audit_info TEXT,
      alpha_info TEXT,
      meta_info TEXT,
      kyc_holders INTEGER,
      holders_top10_percent TEXT,
      dev_tokens INTEGER,
      dev_migrated INTEGER,
      dev_migrated_percent REAL,
      issuer_total_tokens INTEGER,
      smart_money_holding_percent REAL,
      kol_holding_percent REAL,
      dev_holding_percent REAL,
      pro_holders_percent REAL,
      new_address_holders_percent REAL,
      bundles_holding_percent REAL,
      search_count_24h INTEGER,
      creator_address TEXT,
      origin_name TEXT,
      blacklist INTEGER DEFAULT 0,
      whitelist INTEGER DEFAULT 0,
      ai_narrative_flag INTEGER DEFAULT 0,
      is_new_coin INTEGER DEFAULT 0,
      total_supply TEXT,
      max_supply TEXT,
      burned_amount TEXT,
      circulating_supply TEXT,
      coingecko_id TEXT,
      is_mintable INTEGER DEFAULT 0,
      is_upgradeable INTEGER DEFAULT 0,
      contract_analysis TEXT,
      onchain_last_sync TEXT,
      chart_1m TEXT,
      chart_5m TEXT,
      chart_1h TEXT,
      chart_4h TEXT,
      chart_24h TEXT,
      first_seen_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chain_id, contract_address)
    )
  `);

  // token_snapshots 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      snapshot_at TEXT NOT NULL,
      target_at TEXT NOT NULL,
      price TEXT NOT NULL,
      price_change_from_first TEXT,
      price_change_from_prev TEXT,
      volume_24h TEXT,
      volume_1h TEXT,
      liquidity TEXT,
      liquidity_change_from_first TEXT,
      holders INTEGER,
      holders_change_from_first INTEGER,
      unique_trader_24h INTEGER,
      count_24h INTEGER,
      holders_top10_percent TEXT,
      smart_money_holding_percent REAL,
      dev_holding_percent REAL,
      bundles_holding_percent REAL,
      raw_data TEXT,
      status TEXT DEFAULT 'ok',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chain_id, contract_address, snapshot_type)
    )
  `);

  // social_topics 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL UNIQUE,
      chain_id TEXT,
      topic_name_en TEXT,
      topic_name_cn TEXT,
      topic_type TEXT,
      topic_link TEXT,
      topic_tags TEXT,
      create_time INTEGER,
      rising_time INTEGER,
      viral_time INTEGER,
      ai_summary_en TEXT,
      ai_summary_cn TEXT,
      topic_net_inflow TEXT,
      topic_net_inflow_1h TEXT,
      topic_net_inflow_ath TEXT,
      token_size INTEGER,
      token_list TEXT,
      contract_addresses TEXT,
      fetched_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // trending_tokens 表（老币参考数据）
  db.exec(`
    CREATE TABLE IF NOT EXISTS trending_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      symbol TEXT,
      price TEXT,
      market_cap TEXT,
      liquidity TEXT,
      holders INTEGER,
      volume_24h TEXT,
      percent_change_24h TEXT,
      launch_time INTEGER,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chain_id, contract_address)
    )
  `);

  // tracking_plans 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracking_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      target_at TEXT NOT NULL,
      executed INTEGER DEFAULT 0,
      executed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chain_id, contract_address, snapshot_type)
    )
  `);

  // 索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens(creator_address)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tokens_launch ON tokens(launch_time)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tokens_first_seen ON tokens(first_seen_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_token ON token_snapshots(chain_id, contract_address)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_type ON token_snapshots(snapshot_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_at ON token_snapshots(snapshot_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_social_topics_type ON social_topics(topic_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_social_topics_time ON social_topics(create_time)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tracking_plans_executed ON tracking_plans(executed, target_at)`);

  // ============ 规则引擎表 ============

  // Agent 独立评分记录
  db.exec(`CREATE TABLE IF NOT EXISTS agent_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    agent_type TEXT NOT NULL CHECK(agent_type IN ('risk','market','issuer','onchain','decision')),
    score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
    confidence REAL DEFAULT 0,
    details_json TEXT,
    evaluated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(chain_id, contract_address, agent_type, evaluated_at)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_scores_token ON agent_scores(chain_id, contract_address)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_scores_type ON agent_scores(agent_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_scores_time ON agent_scores(evaluated_at)`);

  // 策略规则配置
  db.exec(`CREATE TABLE IF NOT EXISTS strategy_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id TEXT UNIQUE NOT NULL,
    scenario TEXT NOT NULL CHECK(scenario IN ('new_coin','trending','anomaly')),
    name TEXT NOT NULL,
    description TEXT,
    conditions_json TEXT NOT NULL,
    action TEXT NOT NULL,
    action_params_json TEXT,
    priority INTEGER DEFAULT 0,
    validation_stage TEXT DEFAULT 'full_validation'
      CHECK(validation_stage IN ('full_validation','filtering','production')),
    min_win_rate REAL,
    min_sample_size INTEGER DEFAULT 10,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // 策略验证记录
  db.exec(`CREATE TABLE IF NOT EXISTS strategy_validations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    symbol TEXT,
    predicted TEXT NOT NULL,
    actual_result TEXT,
    entry_price TEXT,
    exit_price TEXT,
    pnl REAL,
    pnl_percent REAL,
    holding_minutes INTEGER,
    trade_id TEXT,
    validated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sv_rule ON strategy_validations(rule_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sv_token ON strategy_validations(chain_id, contract_address)`);

  // 新币首次发现快照表（用于后期热门潜质分析）
  db.exec(`CREATE TABLE IF NOT EXISTS token_first_seen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    symbol TEXT,
    first_seen_at TEXT NOT NULL,
    launch_time INTEGER,
    launch_age_minutes REAL,           -- 首次发现时距离上线的分钟数
    price_first TEXT,                  -- 首次发现时的价格
    liquidity_first TEXT,              -- 首次发现时的流动性
    holders_first INTEGER,             -- 首次发现时的持有人数
    market_cap_first TEXT,             -- 首次发现时的市值
    volume_1h_first TEXT,              -- 首次发现时的1h成交量
    volume_24h_first TEXT,             -- 首次发现时的24h成交量
    unique_trader_1h_first INTEGER,    -- 首次发现时的1h交易者数
    unique_trader_24h_first INTEGER,   -- 首次发现时的24h交易者数
    holders_top10_percent_first TEXT,  -- 首次发现时的前10持仓占比
    smart_money_holding_first REAL,    -- 首次发现时的Smart Money持仓
    dev_holding_first REAL,            -- 首次发现时的开发者持仓
    bundles_holding_first TEXT,        -- 首次发现时的捆绑持仓
    search_count_24h_first INTEGER,    -- 首次发现时的搜索热度
    creator_address TEXT,              -- 发行方地址
    issuer_total_tokens INTEGER,       -- 发行方历史代币数
    issuer_survival_rate REAL,         -- 发行方迁移率
    audit_risk_level INTEGER,          -- 审计风险等级
    audit_is_verified INTEGER,         -- 是否已验证
    chain_count INTEGER DEFAULT 1,     -- 同名代币出现在几条链
    UNIQUE(chain_id, contract_address)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tfs_token ON token_first_seen(chain_id, contract_address)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tfs_time ON token_first_seen(first_seen_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tfs_creator ON token_first_seen(creator_address)`);

  console.log('[DB] 数据库初始化完成:', DB_PATH);
}

export { db };
