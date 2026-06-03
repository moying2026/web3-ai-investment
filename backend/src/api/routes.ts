import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import {
  getTokens, getTokenDetail, getTokenSnapshots,
  getSocialTopics, getStats
} from '../services/tokenService';
import { addSSEClient, getNewTokenBuffer, getLastPollTime } from '../services/pollingService';

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
      sseClients: 0, // 会在主文件中覆盖
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
      res.write(`event: new_token\ndata: ${JSON.stringify({
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

export default router;

// ============ 模拟盘 API ============

// POST /api/sim/trades — 创建模拟交易
router.post('/sim/trades', (req: Request, res: Response) => {
  try {
    const { v4: uuidv4 } = require('uuid');
    const { chain_id, contract_address, symbol, side, entry_price, entry_amount, stop_loss_percent, take_profit_percent, trade_type, strategy, trigger_reason } = req.body;
    if (!chain_id || !contract_address || !side || !entry_price) {
      res.status(400).json({ code: -1, message: '缺少必填字段: chain_id, contract_address, side, entry_price' });
      return;
    }
    const trade_id = uuidv4();
    const entry_quantity = entry_amount ? (parseFloat(entry_amount) / parseFloat(entry_price)).toString() : null;
    const stop_loss_price = stop_loss_percent ? (parseFloat(entry_price) * (1 - stop_loss_percent / 100)).toString() : null;
    const take_profit_price = take_profit_percent ? (parseFloat(entry_price) * (1 + take_profit_percent / 100)).toString() : null;
    const now = new Date().toISOString();

    (db.prepare(`INSERT INTO sim_trades (
      trade_id, trade_type, strategy, chain_id, contract_address, symbol,
      side, order_type, entry_price, entry_amount, entry_quantity,
      stop_loss_price, stop_loss_percent, take_profit_price, take_profit_percent,
      trigger_reason, status, entry_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MARKET', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`)).run(
      trade_id, trade_type || 'manual', strategy || null, chain_id, contract_address, symbol || null,
      side, entry_price, entry_amount || null, entry_quantity,
      stop_loss_price, stop_loss_percent || null, take_profit_price, take_profit_percent || null,
      trigger_reason || null, now
    );

    // 更新组合统计
    (db.prepare("UPDATE portfolio_state SET total_trades = total_trades + 1, last_trade_at = datetime('now') WHERE portfolio_id = 'main'")).run();

    const trade = (db.prepare('SELECT * FROM sim_trades WHERE trade_id = ?')).get(trade_id);
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
    const data = (db.prepare(`SELECT * FROM sim_trades WHERE ${where} ORDER BY entry_time DESC LIMIT ? OFFSET ?`)).all(...params, pageSize, offset);
    res.json({ code: 0, data: { data, total: total.c, page, pageSize } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/sim/portfolio — 查询组合状态
router.get('/sim/portfolio', (_req: Request, res: Response) => {
  try {
    const portfolio = (db.prepare("SELECT * FROM portfolio_state WHERE portfolio_id = 'main'")).get();
    const openTrades = (db.prepare("SELECT COUNT(*) as c FROM sim_trades WHERE status = 'OPEN'")).get() as any;
    res.json({ code: 0, data: { ...portfolio, open_positions: openTrades.c } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// PUT /api/sim/trades/:id/close — 平仓
router.put('/sim/trades/:id/close', (req: Request, res: Response) => {
  try {
    const tradeId = String(req.params.id);
    const { exit_price, exit_reason } = req.body;
    if (!exit_price) { res.status(400).json({ code: -1, message: '缺少 exit_price' }); return; }

    const trade = (db.prepare('SELECT * FROM sim_trades WHERE trade_id = ? AND status = ?')).get(tradeId, 'OPEN') as any;
    if (!trade) { res.status(404).json({ code: -1, message: '交易未找到或已关闭' }); return; }

    const entryPrice = parseFloat(trade.entry_price);
    const exitPrice = parseFloat(exit_price);
    const pnl = trade.side === 'BUY' ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
    const pnlPercent = (pnl / entryPrice) * 100;
    const holdingMinutes = Math.floor((Date.now() - new Date(trade.entry_time).getTime()) / 60000);
    const exitAmount = trade.entry_quantity ? (parseFloat(trade.entry_quantity) * exitPrice).toString() : null;
    const now = new Date().toISOString();

    (db.prepare(`UPDATE sim_trades SET status = 'CLOSED', exit_price = ?, exit_amount = ?, exit_reason = ?,
      exit_time = ?, pnl = ?, pnl_percent = ?, holding_duration_minutes = ?, updated_at = datetime('now')
      WHERE trade_id = ?`)).run(exitPrice.toString(), exitAmount, exit_reason || 'manual', now, pnl.toFixed(6), pnlPercent, holdingMinutes, tradeId);

    // 更新组合统计
    const isWin = pnl > 0;
    (db.prepare(`UPDATE portfolio_state SET
      winning_trades = winning_trades + ?, losing_trades = losing_trades + ?,
      total_pnl = CAST(total_pnl AS REAL) + ?, position_count = MAX(0, position_count - 1),
      updated_at = datetime('now') WHERE portfolio_id = 'main'`)).run(isWin ? 1 : 0, isWin ? 0 : 1, pnl);

    const updated = (db.prepare('SELECT * FROM sim_trades WHERE trade_id = ?')).get(tradeId);
    res.json({ code: 0, data: updated });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});
