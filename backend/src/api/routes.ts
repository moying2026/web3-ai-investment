import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db/database';

// undici + proxy support
const { fetch: undiciFetch, ProxyAgent } = require('undici');
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
let iconDispatcher: any = undefined;
if (PROXY_URL) {
  iconDispatcher = new ProxyAgent(PROXY_URL);
  console.log(`[IconProxy] 使用代理: ${PROXY_URL}`);
}
import {
  getTokens, getTokenDetail, getTokenSnapshots,
  getSocialTopics, getStats
} from '../services/tokenService';
import { fetchKlines } from '../services/binanceApi';
import { addSSEClient, getNewTokenBuffer, getLastPollTime, getSSEClientCount } from '../services/pollingService';
import { ensureSimTables, placeOrder, closePosition, getPendingOrders, getTradesBySide, getPortfolioInfo, updateBudget } from '../services/simTradeService';

const router = Router();

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}

function qn(val: unknown): number | undefined {
  const s = qs(val);
  if (s === undefined) return undefined;
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}

// Chain 名称 → chain_id 映射（tokens 表存的是数字 ID）
const CHAIN_MAP: Record<string, string> = {
  'bsc': '56', '56': '56',
  'eth': '1', '1': '1', 'ethereum': '1',
  'base': '8453', '8453': '8453',
  'polygon': '137', '137': '137',
  'arbitrum': '42161', '42161': '42161',
  'optimism': '10', '10': '10',
  'solana': 'CT_501', 'CT_501': 'CT_501',
  'avalanche': '43114', '43114': '43114',
};
function resolveChainId(chain: string): string {
  return CHAIN_MAP[chain.toLowerCase()] || chain;
}

// GET /api/tokens — 代币列表（支持多维筛选）
router.get('/tokens', (req: Request, res: Response) => {
  try {
    const result = getTokens({
      page: parseInt(qs(req.query.page) || '1') || 1,
      pageSize: parseInt(qs(req.query.pageSize) || '20') || 20,
      chain: qs(req.query.chain),
      symbol: qs(req.query.symbol),
      sortBy: qs(req.query.sortBy),
      sortOrder: qs(req.query.sortOrder) as 'asc' | 'desc' | undefined,
      launch_within: qs(req.query.launch_within),
      creator: qs(req.query.creator),
      risk_level: qs(req.query.risk_level),
      holders_min: qn(req.query.holders_min),
      holders_max: qn(req.query.holders_max),
      liquidity_min: qn(req.query.liquidity_min),
      liquidity_max: qn(req.query.liquidity_max),
      is_new_coin: qn(req.query.is_new_coin),
    });
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/tokens/:chain/:address — 代币详情
router.get('/tokens/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const token = getTokenDetail(chain, address);
    if (!token) {
      res.status(404).json({ code: -1, message: '代币未找到' });
      return;
    }
    // 解析 JSON 字段
    const parsed = {
      ...token,
      links: safeJsonParse(token.links),
      preview_link: safeJsonParse(token.preview_link),
      token_tag: safeJsonParse(token.token_tag),
      audit_info: safeJsonParse(token.audit_info),
      alpha_info: safeJsonParse(token.alpha_info),
      meta_info: safeJsonParse(token.meta_info),
    };
    res.json({ code: 0, data: parsed });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/tokens/:chain/:address/snapshots — 生命周期快照
router.get('/tokens/:chain/:address/snapshots', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const snapshots = getTokenSnapshots(chain, address);
    const parsed = snapshots.map(s => ({
      ...s,
      raw_data: safeJsonParse(s.raw_data),
    }));
    res.json({ code: 0, data: parsed });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/tokens/:chain/:address/klines — K线数据（OHLCV）
router.get('/tokens/:chain/:address/klines', async (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const interval = qs(req.query.interval) || '1h';
    const limit = Math.min(Math.max(parseInt(qs(req.query.limit) || '100') || 100, 1), 1000);

    const candles = await fetchKlines(chain, address, interval, limit);
    res.json({ code: 0, data: candles });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/tokens/:chain/:address/refresh-onchain — 手动刷新单个代币链上数据
router.get('/tokens/:chain/:address/refresh-onchain', async (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { fetchSingleTokenOnchain } = require('../services/onchainService');
    const token = getTokenDetail(chain, address);
    if (!token) { res.status(404).json({ code: -1, message: '代币未找到' }); return; }
    const ok = await fetchSingleTokenOnchain(chain, address, token.symbol, token.decimals);
    if (ok) {
      const updated = getTokenDetail(chain, address);
      res.json({ code: 0, message: '刷新成功', data: updated });
    } else {
      res.status(500).json({ code: -1, message: '链上数据采集失败' });
    }
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/issuers/:address — 发行方详情
router.get('/issuers/:address', (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const { getIssuerProfile } = require('../services/issuerService');
    const profile = getIssuerProfile(address);
    if (!profile) { res.status(404).json({ code: -1, message: '发行方未找到' }); return; }
    res.json({ code: 0, data: profile });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/issuer/:address — 发行方画像详情（含风险评估）
router.get('/issuer/:address', (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const profile = (db.prepare('SELECT * FROM issuer_profiles WHERE issuer_address = ?').get(address)) as any;
    if (!profile) { res.status(404).json({ code: -1, message: '发行方未找到' }); return; }

    // 统计迁移情况
    const migratedCount = (db.prepare(
      'SELECT COUNT(*) as c FROM issuer_tokens WHERE issuer_address = ? AND migrated = 1'
    ).get(address) as any).c;
    const unmigratedCount = (db.prepare(
      'SELECT COUNT(*) as c FROM issuer_tokens WHERE issuer_address = ? AND (migrated = 0 OR migrated IS NULL)'
    ).get(address) as any).c;
    const migrationRate = profile.total_tokens > 0 ? migratedCount / profile.total_tokens : 0;

    // 风险评估
    let riskLevel = 'low';
    const riskReasons: string[] = [];
    if (profile.total_tokens > 100) {
      riskLevel = 'high';
      riskReasons.push(`发行代币数量过多: ${profile.total_tokens}`);
    } else if (profile.total_tokens > 20) {
      riskLevel = 'medium';
      riskReasons.push(`发行代币数量较多: ${profile.total_tokens}`);
    }
    if (migrationRate < 0.1 && profile.total_tokens > 5) {
      riskLevel = 'high';
      riskReasons.push(`迁移率极低: ${(migrationRate * 100).toFixed(1)}%`);
    } else if (migrationRate < 0.3 && profile.total_tokens > 5) {
      if (riskLevel === 'low') riskLevel = 'medium';
      riskReasons.push(`迁移率偏低: ${(migrationRate * 100).toFixed(1)}%`);
    }
    if (riskReasons.length === 0) riskReasons.push('无明显风险');

    res.json({
      code: 0,
      data: {
        issuerAddress: profile.issuer_address,
        totalTokens: profile.total_tokens,
        aliveTokens: profile.alive_tokens,
        deadTokens: profile.dead_tokens,
        migratedCount,
        unmigratedCount,
        survivalRate: profile.survival_rate,
        migrationRate,
        firstSeenAt: profile.first_seen_at,
        lastSeenAt: profile.last_seen_at,
        riskLevel,
        riskReasons,
      },
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/issuer/:address/tokens — 发行方历史代币列表
router.get('/issuer/:address/tokens', (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const pageSize = Math.min(parseInt(qs(req.query.pageSize) || '50') || 50, 200);
    const offset = (page - 1) * pageSize;

    const total = (db.prepare(
      'SELECT COUNT(*) as c FROM issuer_tokens WHERE issuer_address = ?'
    ).get(address) as any).c;

    const data = db.prepare(
      'SELECT * FROM issuer_tokens WHERE issuer_address = ? ORDER BY create_time DESC LIMIT ? OFFSET ?'
    ).all(address, pageSize, offset);

    res.json({ code: 0, data: { data, total, page, pageSize } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/social-topics — 社交热度话题
router.get('/social-topics', (req: Request, res: Response) => {
  try {
    const result = getSocialTopics({
      page: parseInt(qs(req.query.page) || '1') || 1,
      pageSize: parseInt(qs(req.query.pageSize) || '20') || 20,
      type: qs(req.query.type),
    });
    // 解析 JSON 字段
    result.data = result.data.map(t => ({
      ...t,
      topic_tags: safeJsonParse(t.topic_tags),
      token_list: safeJsonParse(t.token_list),
      contract_addresses: safeJsonParse(t.contract_addresses),
    }));
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/stats — 统计数据
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = getStats();
    res.json({ code: 0, data: stats });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/health — 健康检查
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    code: 0,
    data: {
      status: 'ok',
      uptime: process.uptime(),
      lastPollTime: getLastPollTime(),
      sseClients: getSSEClientCount(),
      timestamp: new Date().toISOString(),
    },
  });
});

// GET /api/stream/new-tokens — SSE 实时推送新币
router.get('/stream/new-tokens', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // 发送已有的缓冲数据
  const buffer = getNewTokenBuffer();
  if (buffer.length > 0) {
    for (const token of buffer.slice(-10)) {
      res.write(`data: ${JSON.stringify({
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
      })}\n\n`);
    }
  }

  // 发送心跳
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  // 注册客户端
  const removeClient = addSSEClient((data: string) => {
    res.write(data);
  });

  // 连接关闭时清理
  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient();
  });
});

function safeJsonParse(str: any): any {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return str; }
}

// ============ 代币图标代理 ============

const ICON_CACHE_DIR = path.resolve(__dirname, '../../data/token-icons');

// 确保缓存目录存在
if (!fs.existsSync(ICON_CACHE_DIR)) {
  fs.mkdirSync(ICON_CACHE_DIR, { recursive: true });
}

// GET /api/token-icon/:chain/:address — 从本地缓存返回图标，无缓存返回404
router.get('/token-icon/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);

    // 在缓存目录中查找匹配文件（支持任意扩展名）
    const files = fs.readdirSync(ICON_CACHE_DIR);
    const match = files.find(f => f.startsWith(`${chain}_${address}.`));

    if (match) {
      // 本地缓存命中
      const cacheFilePath = path.join(ICON_CACHE_DIR, match);
      const ext = path.extname(match).toLowerCase();
      const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
      const mimeType = mimeMap[ext] || 'image/png';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(cacheFilePath).pipe(res);
      return;
    }

    // 本地无缓存，从 Binance CDN 下载
    const iconPath = qs(req.query.icon);
    if (!iconPath) {
      res.status(404).json({ code: -1, message: '图标未缓存且缺少 icon 参数' });
      return;
    }

    const cdnUrl = `https://bin.bnbstatic.com${iconPath}`;
    const fetchOptions: any = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    };
    if (iconDispatcher) fetchOptions.dispatcher = iconDispatcher;

    undiciFetch(cdnUrl, fetchOptions).then(async (resp: any) => {
      if (!resp.ok) {
        res.status(404).json({ code: -1, message: `CDN 图标获取失败 (${resp.status})` });
        return;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length === 0) {
        res.status(404).json({ code: -1, message: 'CDN 返回空内容' });
        return;
      }

      // 保存到本地缓存
      const ext = path.extname(iconPath) || '.png';
      const cacheFileName = `${chain}_${address}${ext}`;
      const cacheFilePath = path.join(ICON_CACHE_DIR, cacheFileName);
      fs.writeFileSync(cacheFilePath, buf);

      const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
      res.setHeader('Content-Type', mimeMap[ext] || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(buf);
    }).catch((err: any) => {
      res.status(404).json({ code: -1, message: `CDN 请求失败: ${err.message}` });
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/token-icon/upload — 浏览器端上传base64图标到后端缓存
router.post('/token-icon/upload', (req: Request, res: Response) => {
  try {
    const { chain, address, icon } = req.body;
    if (!chain || !address || !icon) {
      res.status(400).json({ code: -1, message: '缺少必填字段: chain, address, icon (base64)' });
      return;
    }

    // 解析 base64 data URI: data:image/png;base64,xxx 或纯 base64
    let base64Data = icon;
    let ext = '.png';
    const dataUriMatch = icon.match(/^data:image\/(\w+);base64,(.+)$/);
    if (dataUriMatch) {
      ext = `.${dataUriMatch[1] === 'jpeg' ? 'jpg' : dataUriMatch[1]}`;
      base64Data = dataUriMatch[2];
    }

    const buf = Buffer.from(base64Data, 'base64');
    if (buf.length === 0) {
      res.status(400).json({ code: -1, message: 'base64 数据为空' });
      return;
    }

    const cacheFileName = `${chain}_${address}${ext}`;
    const cacheFilePath = path.join(ICON_CACHE_DIR, cacheFileName);

    // 清理旧文件（不同扩展名）
    const files = fs.readdirSync(ICON_CACHE_DIR);
    for (const f of files) {
      if (f.startsWith(`${chain}_${address}.`) && f !== cacheFileName) {
        fs.unlinkSync(path.join(ICON_CACHE_DIR, f));
      }
    }

    fs.writeFileSync(cacheFilePath, buf);
    res.json({ code: 0, message: '图标上传成功', data: { path: `/api/token-icon/${chain}/${address}` } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

export default router;

// ============ 模拟盘 API ============

// POST /api/sim/trades — 创建交易（统一 placeOrder，Web3 swap 语义）
router.post('/sim/trades', (req: Request, res: Response) => {
  try {
    ensureSimTables();
    const { chain_id, contract_address, symbol, dex, side, from_token, from_amount, from_contract, to_token, to_amount, to_contract, price, price_impact, gas_fee, gas_token, stop_loss_percent, take_profit_percent, strategy, trigger_reason, is_simulated } = req.body;
    if (!chain_id || !contract_address || !side) {
      res.status(400).json({ code: -1, message: '缺少必填字段: chain_id, contract_address, side' }); return;
    }
    const result = placeOrder({ chain_id, contract_address, symbol, dex, side, from_token, from_amount: from_amount ? parseFloat(from_amount) : undefined, from_contract, to_token, to_amount: to_amount ? parseFloat(to_amount) : undefined, to_contract, price: price ? parseFloat(price) : undefined, price_impact: price_impact ? parseFloat(price_impact) : undefined, gas_fee: gas_fee ? parseFloat(gas_fee) : undefined, gas_token, is_simulated: is_simulated ?? 1, strategy, trigger_reason, stop_loss_percent, take_profit_percent });
    if (!result.success) { res.status(400).json({ code: -1, message: result.reason }); return; }
    const trade = (db.prepare('SELECT * FROM sim_trades WHERE trade_id = ?')).get(result.trade_id);
    res.json({ code: 0, data: trade });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/sim/trades — 查询交易记录
router.get('/sim/trades', (req: Request, res: Response) => {
  try {
    const status = qs(req.query.status);
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const pageSize = Math.min(parseInt(qs(req.query.pageSize) || '20') || 20, 100);
    const offset = (page - 1) * pageSize;

    let where = '1=1';
    const params: any[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }

    const total = (db.prepare(`SELECT COUNT(*) as c FROM sim_trades WHERE ${where}`)).get(...params) as any;
    const data = (db.prepare(`SELECT * FROM sim_trades WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)).all(...params, pageSize, offset);
    res.json({ code: 0, data: { data, total: total.c, page, pageSize } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/sim/portfolio — 查询组合状态（含预算信息）
router.get('/sim/portfolio', (_req: Request, res: Response) => {
  try {
    ensureSimTables();
    const info = getPortfolioInfo();
    res.json({ code: 0, data: info });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// PUT /api/sim/portfolio — 修改预算配置
router.put('/sim/portfolio', (req: Request, res: Response) => {
  try {
    ensureSimTables();
    const { total_budget, max_per_trade_amount, max_positions, max_chain_pct } = req.body;
    const result = updateBudget({ total_budget, max_per_trade_amount, max_positions, max_chain_pct });
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// PUT /api/sim/trades/:id/close — 平仓（创建独立 SELL 记录）
router.put('/sim/trades/:id/close', (req: Request, res: Response) => {
  try {
    ensureSimTables();
    const tradeId = String(req.params.id);
    const { price, reason } = req.body;
    if (!price) { res.status(400).json({ code: -1, message: '缺少 price' }); return; }

    const trade = (db.prepare('SELECT * FROM sim_trades WHERE trade_id = ? AND side = ? AND status = ?')).get(tradeId, 'BUY', 'SUCCESS') as any;
    if (!trade) { res.status(404).json({ code: -1, message: 'BUY 记录未找到或已关闭' }); return; }

    closePosition(trade, parseFloat(price), reason || 'manual');

    const updated = (db.prepare('SELECT * FROM sim_trades WHERE trade_id = ?')).get(tradeId);
    const sellRecord = (db.prepare('SELECT * FROM sim_trades WHERE parent_trade_id = ? AND side = ? ORDER BY created_at DESC LIMIT 1').get(tradeId, 'SELL')) as any;
    res.json({ code: 0, data: { buy: updated, sell: sellRecord } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/sim/pending-orders — 查询挂单
router.get('/sim/pending-orders', (req: Request, res: Response) => {
  try {
    ensureSimTables();
    const status = qs(req.query.status) || 'PENDING';
    const orders = getPendingOrders(status);
    res.json({ code: 0, data: orders });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/sim/trades/by-side — 按方向查询交易记录
router.get('/sim/trades/by-side', (req: Request, res: Response) => {
  try {
    ensureSimTables();
    const side = (qs(req.query.side) || 'BUY').toUpperCase();
    if (side !== 'BUY' && side !== 'SELL') {
      res.status(400).json({ code: -1, message: 'side must be BUY or SELL' }); return;
    }
    const limit = parseInt(qs(req.query.limit) || '50') || 50;
    const trades = getTradesBySide(side, limit);
    res.json({ code: 0, data: { side, trades } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ AI 分析准确性 API ============

// GET /api/sim/stats — 模拟盘统计
router.get('/sim/stats', (_req: Request, res: Response) => {
  try {
    const total = (db.prepare("SELECT COUNT(*) as c FROM sim_trades").get() as any).c;
    const openCount = (db.prepare("SELECT COUNT(*) as c FROM sim_trades WHERE status = 'PENDING'").get() as any).c;
    const closedCount = (db.prepare("SELECT COUNT(*) as c FROM sim_trades WHERE status = 'SUCCESS'").get() as any).c;
    const winCount = (db.prepare("SELECT COUNT(*) as c FROM sim_trades WHERE status = 'SUCCESS' AND CAST(pnl AS REAL) > 0").get() as any).c;
    const lossCount = (db.prepare("SELECT COUNT(*) as c FROM sim_trades WHERE status = 'SUCCESS' AND CAST(pnl AS REAL) <= 0").get() as any).c;
    const totalPnl = (db.prepare("SELECT COALESCE(SUM(CAST(pnl AS REAL)), 0) as s FROM sim_trades WHERE status = 'SUCCESS'").get() as any).s;
    const avgHolding = (db.prepare("SELECT COALESCE(AVG(holding_duration_minutes), 0) as a FROM sim_trades WHERE status = 'SUCCESS' AND holding_duration_minutes IS NOT NULL").get() as any).a;
    const portfolio = (db.prepare("SELECT * FROM portfolio_state WHERE portfolio_id = 'main'").get() as any);
    const maxDrawdown = portfolio ? parseFloat(portfolio.max_drawdown_percent || '0') : 0;
    const winRate = closedCount > 0 ? (winCount / closedCount * 100) : 0;

    // 按策略分布
    const byStrategy = db.prepare(`
      SELECT strategy, COUNT(*) as count,
        SUM(CASE WHEN status = 'SUCCESS' AND CAST(pnl AS REAL) > 0 THEN 1 ELSE 0 END) as wins,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN CAST(pnl AS REAL) ELSE 0 END), 0) as total_pnl
      FROM sim_trades GROUP BY strategy
    `).all();

    // 按链分布
    const byChain = db.prepare(`
      SELECT chain_id, COUNT(*) as count,
        SUM(CASE WHEN status = 'SUCCESS' AND CAST(pnl AS REAL) > 0 THEN 1 ELSE 0 END) as wins,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN CAST(pnl AS REAL) ELSE 0 END), 0) as total_pnl
      FROM sim_trades GROUP BY chain_id
    `).all();

    res.json({
      code: 0,
      data: {
        total,
        open: openCount,
        closed: closedCount,
        winCount,
        lossCount,
        winRate: winRate.toFixed(1) + '%',
        totalPnl: parseFloat(totalPnl).toFixed(2),
        avgHoldingMinutes: Math.round(avgHolding),
        maxDrawdown: maxDrawdown.toFixed(2) + '%',
        portfolio: {
          totalValue: portfolio?.total_value || '10000',
          availableBalance: portfolio?.available_balance || '10000',
          lockedBalance: portfolio?.locked_balance || '0',
        },
        byStrategy,
        byChain,
      },
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/sim/daily-pnl — 收益曲线数据（按天聚合）
router.get('/sim/daily-pnl', (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);

    // 获取初始预算
    const portfolio = (db.prepare('SELECT total_budget FROM portfolio_state WHERE portfolio_id = \'main\'').get() as any);
    const initialBudget: number = portfolio?.total_budget || 10000;

    // 查询所有已平仓交易（SELL 方向，状态 SUCCESS），按平仓日期聚合
    const rows = db.prepare(`
      SELECT
        CASE
          WHEN typeof(closed_at) = 'integer' THEN date(closed_at / 1000, 'unixepoch', 'localtime')
          ELSE date(closed_at)
        END as trade_date,
        SUM(CAST(pnl AS REAL)) as daily_pnl
      FROM sim_trades
      WHERE side = 'SELL' AND status = 'SUCCESS' AND closed_at IS NOT NULL
      GROUP BY trade_date
      HAVING trade_date IS NOT NULL
      ORDER BY trade_date ASC
    `).all() as { trade_date: string; daily_pnl: number }[];

    // 构建日期→当日盈亏 map
    const pnlByDate = new Map<string, number>();
    for (const row of rows) {
      pnlByDate.set(row.trade_date, row.daily_pnl);
    }

    // 确定日期范围：从第一笔平仓交易到今天
    const today = new Date();
    const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    let startDate: Date;
    if (rows.length > 0) {
      // 从第一笔平仓日期开始
      startDate = new Date(rows[0].trade_date + 'T00:00:00');
      // 但最多只回溯 days 天
      const maxStart = new Date(endDate);
      maxStart.setDate(maxStart.getDate() - days + 1);
      if (startDate < maxStart) startDate = maxStart;
    } else {
      // 无交易记录，返回最近 days 天
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days + 1);
    }

    // 生成完整日期序列，填充空白天
    const result: { date: string; pnl: number; totalValue: number }[] = [];
    let cumulativePnl = 0;
    const cursor = new Date(startDate);

    while (cursor <= endDate) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const dayPnl = pnlByDate.get(dateStr) || 0;
      cumulativePnl += dayPnl;
      result.push({
        date: dateStr,
        pnl: parseFloat(dayPnl.toFixed(2)),
        totalValue: parseFloat((initialBudget + cumulativePnl).toFixed(2)),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/ai/analysis — AI 评估分析统计
router.get('/ai/analysis', (_req: Request, res: Response) => {
  try {
    const total = (db.prepare("SELECT COUNT(*) as c FROM ai_analysis").get() as any).c;
    const avgScore = (db.prepare("SELECT COALESCE(AVG(score), 0) as a FROM ai_analysis").get() as any).a;

    // 按推荐分类统计
    const recDistribution = db.prepare(`
      SELECT recommendation, COUNT(*) as count, AVG(score) as avg_score
      FROM ai_analysis GROUP BY recommendation
    `).all();

    // 评分维度平均分（从 dimension_scores_json 解析）
    const allAnalyses = db.prepare("SELECT dimension_scores_json FROM ai_analysis WHERE dimension_scores_json IS NOT NULL").all() as any[];
    const dimTotals = { security: 0, smartMoney: 0, social: 0, issuer: 0, liquidity: 0 };
    let dimCount = 0;
    for (const a of allAnalyses) {
      try {
        const scores = JSON.parse(a.dimension_scores_json);
        if (scores) {
          dimTotals.security += scores.security || 0;
          dimTotals.smartMoney += scores.smartMoney || 0;
          dimTotals.social += scores.social || 0;
          dimTotals.issuer += scores.issuer || 0;
          dimTotals.liquidity += scores.liquidity || 0;
          dimCount++;
        }
      } catch { /* skip */ }
    }
    const avgDimensions = dimCount > 0 ? {
      security: (dimTotals.security / dimCount).toFixed(1),
      smartMoney: (dimTotals.smartMoney / dimCount).toFixed(1),
      social: (dimTotals.social / dimCount).toFixed(1),
      issuer: (dimTotals.issuer / dimCount).toFixed(1),
      liquidity: (dimTotals.liquidity / dimCount).toFixed(1),
    } : null;

    // 按策略统计（关联 sim_trades）
    const strategyStats = db.prepare(`
      SELECT st.strategy, COUNT(*) as trade_count,
        AVG(aa.score) as avg_score,
        SUM(CASE WHEN st.status = 'SUCCESS' AND CAST(st.pnl AS REAL) > 0 THEN 1 ELSE 0 END) as wins
      FROM sim_trades st
      JOIN ai_analysis aa ON st.chain_id = aa.chain_id AND st.contract_address = aa.contract_address
      WHERE st.trade_type = 'ai_auto'
      GROUP BY st.strategy
    `).all();

    // 评分区间分布
    const scoreBands = db.prepare(`
      SELECT
        CASE
          WHEN score < 30 THEN '0-29'
          WHEN score < 50 THEN '30-49'
          WHEN score < 70 THEN '50-69'
          ELSE '70-100'
        END as band,
        COUNT(*) as count
      FROM ai_analysis GROUP BY band ORDER BY band
    `).all();

    res.json({
      code: 0,
      data: {
        totalAnalyses: total,
        avgScore: parseFloat(avgScore).toFixed(1),
        recommendationDistribution: recDistribution,
        avgDimensionScores: avgDimensions,
        strategyStats,
        scoreBands,
      },
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/sim/accuracy — AI 分析准确性统计
router.get('/sim/accuracy', (_req: Request, res: Response) => {
  try {
    const { getAccuracyStats } = require('../services/simTradeService');
    const stats = getAccuracyStats();
    res.json({ code: 0, data: stats });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/analysis — AI 分析结果列表
router.get('/analysis', (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const pageSize = Math.min(parseInt(qs(req.query.pageSize) || '20') || 20, 100);
    const offset = (page - 1) * pageSize;
    const recommendation = qs(req.query.recommendation);

    let where = '1=1';
    const params: any[] = [];
    if (recommendation) { where += ' AND aa.recommendation = ?'; params.push(recommendation); }

    const total = (db.prepare(`SELECT COUNT(*) as c FROM ai_analysis aa WHERE ${where}`).get(...params) as any).c;
    const data = db.prepare(`
      SELECT aa.*,
        t.holders, t.liquidity, t.market_cap, t.volume_24h, t.launch_time,
        t.audit_info, t.holders_top10_percent, t.smart_money_holding_percent,
        t.dev_holding_percent, t.bundles_holding_percent,
        ta.risk_level as audit_risk_level, ta.risk_level_enum as audit_risk_level_enum,
        ta.buy_tax, ta.sell_tax, ta.unusual_buy_tax, ta.unusual_sell_tax,
        ta.is_verified, ta.risk_items
      FROM ai_analysis aa
      LEFT JOIN tokens t ON aa.chain_id = t.chain_id AND aa.contract_address = t.contract_address
      LEFT JOIN token_audit ta ON aa.chain_id = ta.chain_id AND aa.contract_address = ta.contract_address
      WHERE ${where}
      ORDER BY aa.analyzed_at DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);

    // 解析 JSON 字段
    const parsed = data.map((a: any) => {
      const auditInfo = safeJsonParse(a.audit_info);
      return {
        ...a,
        reasons: safeJsonParse(a.reasons_json),
        dimensionScores: safeJsonParse(a.dimension_scores_json),
        audit_info: auditInfo,
        riskLevel: a.audit_risk_level_enum || (auditInfo?.riskLevel) || null,
        holders: a.holders || 0,
        liquidity: a.liquidity || '0',
        market_cap: a.market_cap || '0',
        volume_24h: a.volume_24h || '0',
        launch_time: a.launch_time || null,
        holders_top10_percent: a.holders_top10_percent || '0',
        smart_money_holding_percent: a.smart_money_holding_percent || 0,
        dev_holding_percent: a.dev_holding_percent || 0,
        bundles_holding_percent: a.bundles_holding_percent || '0',
        audit: {
          riskLevel: a.audit_risk_level || null,
          riskLevelEnum: a.audit_risk_level_enum || null,
          buyTax: a.buy_tax || null,
          sellTax: a.sell_tax || null,
          unusualBuyTax: a.unusual_buy_tax || 0,
          unusualSellTax: a.unusual_sell_tax || 0,
          isVerified: a.is_verified || 0,
          riskItems: safeJsonParse(a.risk_items),
        },
      };
    });

    res.json({ code: 0, data: { data: parsed, total: total, page, pageSize } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ 规则引擎 API ============

// GET /api/tokens/:chain/:address/similar — 同名/跨链检测
router.get('/tokens/:chain/:address/similar', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const token = (db.prepare('SELECT symbol FROM tokens WHERE chain_id = ? AND contract_address = ?').get(chain, address)) as any;
    if (!token) { res.status(404).json({ code: -1, message: '代币未找到' }); return; }
    const { findSimilarTokens } = require('../services/tokenAnalyzer');
    const result = findSimilarTokens(token.symbol, chain, address);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/issuer/:address/risk — 发行方风险评估
router.get('/issuer/:address/risk', (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const { assessIssuerRisk } = require('../services/tokenAnalyzer');
    const result = assessIssuerRisk(address);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/tokens/:chain/:address/address-risk — 地址风险分析
router.get('/tokens/:chain/:address/address-risk', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const token = (db.prepare('SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?').get(chain, address)) as any;
    if (!token) { res.status(404).json({ code: -1, message: '代币未找到' }); return; }
    const { scoreAddressRisk } = require('../services/tokenAnalyzer');
    const result = scoreAddressRisk(token);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/agents/score/:chain/:address — 多 Agent 评分
router.get('/agents/score/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = resolveChainId(String(req.params.chain));
    const address = String(req.params.address);
    const { evaluateDecision } = require('../services/agents/decisionAgent');
    const result = evaluateDecision({ chainId: chain, contractAddress: address });
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/agents/scores — Agent 评分历史
router.get('/agents/scores', (req: Request, res: Response) => {
  try {
    const agentType = qs(req.query.agent_type);
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const pageSize = Math.min(parseInt(qs(req.query.pageSize) || '50') || 50, 200);
    const offset = (page - 1) * pageSize;

    let where = '1=1';
    const params: any[] = [];
    if (agentType) { where += ' AND agent_type = ?'; params.push(agentType); }

    const total = (db.prepare(`SELECT COUNT(*) as c FROM agent_scores WHERE ${where}`).get(...params) as any).c;
    const data = db.prepare(`SELECT * FROM agent_scores WHERE ${where} ORDER BY evaluated_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);

    res.json({ code: 0, data: { data, total, page, pageSize } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/rules — 策略规则列表
router.get('/rules', (_req: Request, res: Response) => {
  try {
    const rules = db.prepare('SELECT * FROM strategy_rules ORDER BY priority DESC').all();
    res.json({ code: 0, data: rules });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/thresholds — 获取当前阈值配置
router.get('/thresholds', (_req: Request, res: Response) => {
  try {
    const { THRESHOLDS } = require('../config/thresholds');
    res.json({ code: 0, data: THRESHOLDS });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ 系统控制 API ============

// GET /api/system/status — 所有模块状态
router.get('/system/status', (_req: Request, res: Response) => {
  try {
    const { getAllModuleStatuses } = require('../services/systemControl');
    const statuses = getAllModuleStatuses();
    res.json({ code: 0, data: statuses });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/system/:moduleId/toggle — 切换模块状态
router.post('/system/:moduleId/toggle', (req: Request, res: Response) => {
  try {
    const moduleId = String(req.params.moduleId);
    const { running } = req.body;
    const { toggleModule, getModuleStatus } = require('../services/systemControl');

    if (typeof running !== 'boolean') {
      res.status(400).json({ code: -1, message: 'running must be a boolean' });
      return;
    }

    const success = toggleModule(moduleId, running);
    if (!success) {
      res.status(404).json({ code: -1, message: `Module ${moduleId} not found` });
      return;
    }

    const status = getModuleStatus(moduleId);
    res.json({ code: 0, data: status });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/system/toggle-all — 一键启停所有模块
router.post('/system/toggle-all', (req: Request, res: Response) => {
  try {
    const { running } = req.body;
    const { toggleModule, getAllModuleStatuses } = require('../services/systemControl');

    if (typeof running !== 'boolean') {
      res.status(400).json({ code: -1, message: 'running must be a boolean' });
      return;
    }

    const statuses = getAllModuleStatuses();
    for (const status of statuses) {
      toggleModule(status.id, running);
    }

    res.json({ code: 0, data: { message: `All modules ${running ? 'started' : 'paused'}`, count: statuses.length } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ 多 Agent 讨论 ============
import { runDiscussion, getDiscussionHistory } from '../services/agentDiscussionService';

// POST /api/agents/discuss/:chain/:contractAddress — 启动代币讨论
router.post('/agents/discuss/:chain/:contractAddress', async (req: Request, res: Response) => {
  try {
    const chain = resolveChainId(String(req.params.chain));
    const contract = String(req.params.contractAddress);
    const result = await runDiscussion(chain, contract);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/agents/discuss/:chain/:contractAddress/history — 讨论历史
router.get('/agents/discuss/:chain/:contractAddress/history', (req: Request, res: Response) => {
  try {
    const chain = resolveChainId(String(req.params.chain));
    const contract = String(req.params.contractAddress);
    const limit = parseInt(qs(req.query.limit) || '10') || 10;
    const result = getDiscussionHistory(chain, contract, limit);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ BscScan 链上数据抓取（通过 HAS 桌面自动化） ============
import {
  getTokenTransfers as getBscscanTokenTransfers,
  getTokenInfo as getBscscanTokenInfo,
  getHolders as getBscscanHolders,
  checkHASConnection,
  scrapePages,
  getDBStats,
} from '../services/bscscanScraperService';

// GET /api/bscscan/status — HAS 连接状态
router.get('/bscscan/status', async (_req: Request, res: Response) => {
  try {
    const result = await checkHASConnection();
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/bscscan/token-transfers/:contractAddress — 代币交易记录（先查库，后台增量同步）
router.get('/bscscan/token-transfers/:contractAddress', async (req: Request, res: Response) => {
  try {
    const contract = String(req.params.contractAddress);
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const limit = parseInt(qs(req.query.limit) || '25') || 25;
    const result = await getBscscanTokenTransfers(contract, page, limit);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/bscscan/scrape/:contractAddress — 手动触发抓取入库
router.post('/bscscan/scrape/:contractAddress', async (req: Request, res: Response) => {
  try {
    const contract = String(req.params.contractAddress);
    const pages = parseInt(qs(req.query.pages) || '5') || 5;
    const order = qs(req.query.order) || 'asc';
    const result = await scrapePages(contract, pages, order);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/bscscan/stats/:contractAddress — 数据库统计
router.get('/bscscan/stats/:contractAddress', (req: Request, res: Response) => {
  try {
    const contract = String(req.params.contractAddress);
    const result = getDBStats(contract);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/bscscan/token-info/:contractAddress — 代币基本信息
router.get('/bscscan/token-info/:contractAddress', async (req: Request, res: Response) => {
  try {
    const contract = String(req.params.contractAddress);
    const result = await getBscscanTokenInfo(contract);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/bscscan/holders/:contractAddress — 持有人数据
router.get('/bscscan/holders/:contractAddress', async (req: Request, res: Response) => {
  try {
    const contract = String(req.params.contractAddress);
    const result = await getBscscanHolders(contract);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ Etherscan API V2 链上数据查询 ============
import {
  getContractVerificationStatus,
  getTransactionDetail,
  getTokenBalance,
  getNativeBalance,
  getGasPrice,
  getAccountTransactions,
  getTokenTransfers,
  getInternalTransactions,
  getLatestBlockNumber,
  getApiKeyStatus,
} from '../services/etherscanService';

// GET /api/etherscan/status — API Key 状态
router.get('/etherscan/status', (_req: Request, res: Response) => {
  try {
    res.json({ code: 0, data: getApiKeyStatus() });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/etherscan/contract/:chain/:address — 合约验证状态
router.get('/etherscan/contract/:chain/:address', async (req: Request, res: Response) => {
  try {
    const result = await getContractVerificationStatus(String(req.params.chain), String(req.params.address));
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/etherscan/tx/:chain/:hash — 交易详情
router.get('/etherscan/tx/:chain/:hash', async (req: Request, res: Response) => {
  try {
    const result = await getTransactionDetail(String(req.params.chain), String(req.params.hash));
    if (!result) { res.status(404).json({ code: -1, message: '交易未找到' }); return; }
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/etherscan/balance/:chain/:address — 原生代币余额
router.get('/etherscan/balance/:chain/:address', async (req: Request, res: Response) => {
  try {
    const result = await getNativeBalance(String(req.params.chain), String(req.params.address));
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/etherscan/token-balance/:chain/:wallet/:contract — 代币余额
router.get('/etherscan/token-balance/:chain/:wallet/:contract', async (req: Request, res: Response) => {
  try {
    const result = await getTokenBalance(String(req.params.chain), String(req.params.wallet), String(req.params.contract));
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/etherscan/gas/:chain — Gas 价格
router.get('/etherscan/gas/:chain', async (req: Request, res: Response) => {
  try {
    const result = await getGasPrice(String(req.params.chain));
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/etherscan/txs/:chain/:address — 账户交易列表
router.get('/etherscan/txs/:chain/:address', async (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const offset = parseInt(qs(req.query.offset) || '10') || 10;
    const result = await getAccountTransactions(String(req.params.chain), String(req.params.address), page, offset);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/etherscan/token-transfers/:chain/:address — 代币转账记录
router.get('/etherscan/token-transfers/:chain/:address', async (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const offset = parseInt(qs(req.query.offset) || '10') || 10;
    const contract = qs(req.query.contract);
    const result = await getTokenTransfers(String(req.params.chain), String(req.params.address), contract, page, offset);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/etherscan/internal-txs/:chain/:address — 合约内部交易
router.get('/etherscan/internal-txs/:chain/:address', async (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const offset = parseInt(qs(req.query.offset) || '10') || 10;
    const result = await getInternalTransactions(String(req.params.chain), String(req.params.address), page, offset);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/etherscan/block/:chain — 最新区块号
router.get('/etherscan/block/:chain', async (req: Request, res: Response) => {
  try {
    const result = await getLatestBlockNumber(String(req.params.chain));
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});
