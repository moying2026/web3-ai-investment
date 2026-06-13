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
import { getProxyStatus, setProxy, testProxy } from '../services/proxyService';
import { addLogSSEClient, getRecentLogs, getLogSSEClientCount, logInfo, logWarn, logError } from '../services/logService';
import { addSSEClient, getNewTokenBuffer, getLastPollTime, getSSEClientCount } from '../services/pollingService';
import { ensureSimTables, placeOrder, closePosition, getPendingOrders, getTradesBySide, getPortfolioInfo, updateBudget, reconcileBudget, getOpenPositions, getSimSettings, updateSimSettings } from '../services/simTradeService';
import { fetchSingleSolTokenData, fetchAllSolTokenData, fetchAllSolAudits } from '../services/solanaDataService';

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
    logInfo('API', `代币列表: page=${result.page} total=${result.total} chain=${qs(req.query.chain) || 'all'}`);
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
      logWarn('API', `代币详情: ${chain}/${address} 未找到`);
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
    logInfo('API', `代币详情: ${chain}/${address} symbol=${token.symbol}`);
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
    logInfo('API', `快照: ${chain}/${address} 返回${parsed.length}条`);
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
    logInfo('API', `K线: ${chain}/${address} interval=${interval} limit=${limit} 返回${candles.length}条`);
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

// ============ 发行方黑名单 API（必须在 /issuer/:address 之前） ============

// GET /api/issuer/blacklist — 获取黑名单列表
router.get('/issuer/blacklist', (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const pageSize = parseInt(qs(req.query.pageSize) || '20') || 20;
    const status = qs(req.query.status);
    const riskLevel = parseInt(qs(req.query.riskLevel) || '0') || undefined;
    
    const { getBlacklist } = require('../services/issuerProfiler');
    const result = getBlacklist({ page, pageSize, status, riskLevel });
    
    logInfo('API', `查询黑名单: ${result.total}条`);
    res.json({
      code: 0,
      data: result.list,
      total: result.total,
      page,
      pageSize
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/issuer/blacklist/check/:address — 检查是否在黑名单
router.get('/issuer/blacklist/check/:address', (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const { isBlacklisted } = require('../services/issuerProfiler');
    const blacklisted = isBlacklisted(address);
    
    res.json({
      code: 0,
      data: { address, blacklisted }
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/issuer/blacklist — 添加黑名单
router.post('/issuer/blacklist', (req: Request, res: Response) => {
  try {
    const { issuer_address, reason, risk_level, evidence, source } = req.body;
    
    if (!issuer_address || !reason || !risk_level) {
      res.status(400).json({ code: -1, message: '缺少必要参数' });
      return;
    }
    
    const { addToBlacklist } = require('../services/issuerProfiler');
    const result = addToBlacklist(issuer_address, reason, risk_level, evidence || {}, source || 'manual');
    
    logInfo('API', `添加黑名单: ${issuer_address.slice(0, 10)}...`);
    res.json({
      code: result.success ? 0 : -1,
      message: result.message
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// DELETE /api/issuer/blacklist/:address — 移除黑名单
router.delete('/issuer/blacklist/:address', (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const { reason } = req.body || {};
    
    const { removeFromBlacklist } = require('../services/issuerProfiler');
    const result = removeFromBlacklist(address, reason || '手动移除');
    
    logInfo('API', `移除黑名单: ${address.slice(0, 10)}...`);
    res.json({
      code: result.success ? 0 : -1,
      message: result.message
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/issuer/:address/analyze — 分析发行方风险
router.post('/issuer/:address/analyze', (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const { updateIssuerStats, calculateIssuerRisk } = require('../services/issuerProfiler');
    
    // 更新统计数据
    updateIssuerStats(address);
    
    // 计算风险评分
    const risk = calculateIssuerRisk(address);
    
    logInfo('API', `发行方风险分析: ${address.slice(0, 10)}... 评分: ${risk.score}`);
    res.json({
      code: 0,
      data: risk
    });
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
    logInfo('API', `统计数据: totalTokens=${stats.totalTokens}`);
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

// ============ 发行方画像 API（Phase 1） ============

// POST /api/issuer/:address/analyze — 分析发行方风险
router.post('/issuer/:address/analyze', (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const { updateIssuerStats, calculateIssuerRisk } = require('../services/issuerProfiler');
    
    // 更新统计数据
    updateIssuerStats(address);
    
    // 计算风险评分
    const risk = calculateIssuerRisk(address);
    
    logInfo('API', `发行方风险分析: ${address.slice(0, 10)}... 评分: ${risk.score}`);
    res.json({
      code: 0,
      data: risk
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/issuer/:address/profile — 获取发行方详情（新版本）
router.get('/issuer/:address/profile', (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const { getIssuerDetail, updateIssuerStats, calculateIssuerRisk } = require('../services/issuerProfiler');
    
    // 更新统计数据
    updateIssuerStats(address);
    
    // 获取详情
    const detail = getIssuerDetail(address);
    
    // 计算风险评分
    const risk = calculateIssuerRisk(address);
    
    logInfo('API', `发行方详情: ${address.slice(0, 10)}...`);
    res.json({
      code: 0,
      data: {
        ...detail,
        risk_score: risk
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ 代币分级 API（Phase 2） ============

// GET /api/token/rating/:chain/:address — 获取代币分级
router.get('/token/rating/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { getTokenRating } = require('../services/tokenRater');
    
    const rating = getTokenRating(chain, address);
    
    if (!rating) {
      res.status(404).json({ code: -1, message: '代币未分级' });
      return;
    }
    
    res.json({
      code: 0,
      data: rating
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/token/rating/:chain/:address — 分析并分级代币
router.post('/token/rating/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { calculateTokenRating, saveTokenRating } = require('../services/tokenRater');
    
    // 获取代币数据
    const token = (db.prepare(
      'SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?'
    ) as any).get(chain, address);
    
    if (!token) {
      res.status(404).json({ code: -1, message: '代币不存在' });
      return;
    }
    
    // 计算分级
    const rating = calculateTokenRating(chain, address, token);
    
    // 保存分级
    saveTokenRating(chain, address, rating, token);
    
    logInfo('API', `代币分级: ${token.symbol} → ${rating.level} (${rating.score}分)`);
    res.json({
      code: 0,
      data: rating
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/token/rating/stats — 获取分级统计
router.get('/token/rating/stats', (_req: Request, res: Response) => {
  try {
    const { getRatingStats } = require('../services/tokenRater');
    const stats = getRatingStats();
    
    res.json({
      code: 0,
      data: stats
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/token/rating/level/:level — 获取指定等级的代币列表
router.get('/token/rating/level/:level', (req: Request, res: Response) => {
  try {
    const level = String(req.params.level).toUpperCase();
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const pageSize = parseInt(qs(req.query.pageSize) || '20') || 20;
    
    const { getTokensByLevel, LEVEL_STRATEGIES } = require('../services/tokenRater');
    const result = getTokensByLevel(level, { page, pageSize });
    const strategy = LEVEL_STRATEGIES[level];
    
    res.json({
      code: 0,
      data: {
        ...result,
        strategy
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/token/rating/batch — 批量分级
router.post('/token/rating/batch', (req: Request, res: Response) => {
  try {
    const limit = parseInt(qs(req.query.limit) || '100') || 100;
    const { batchRateTokens } = require('../services/tokenRater');
    
    const result = batchRateTokens(limit);
    
    logInfo('API', `批量分级: ${result.rated}个成功, ${result.skipped}个跳过`);
    res.json({
      code: 0,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/token/rating/strategies — 获取所有分级策略
router.get('/token/rating/strategies', (_req: Request, res: Response) => {
  try {
    const { LEVEL_STRATEGIES } = require('../services/tokenRater');
    
    res.json({
      code: 0,
      data: LEVEL_STRATEGIES
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ 交易真实性分析 API（Phase 3） ============

// GET /api/token/trade-analysis/:chain/:address — 获取交易分析结果
router.get('/token/trade-analysis/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { getTradeAnalysis } = require('../services/tradeAnalyzer');
    
    const analysis = getTradeAnalysis(chain, address);
    
    if (!analysis) {
      res.status(404).json({ code: -1, message: '未找到交易分析数据' });
      return;
    }
    
    res.json({
      code: 0,
      data: analysis
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/token/trade-analysis/:chain/:address — 分析交易真实性
router.post('/token/trade-analysis/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { calculateWashTradingScore, classifyParticipants, saveTradeAnalysis } = require('../services/tradeAnalyzer');
    
    // 获取代币数据
    const token = (db.prepare(
      'SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?'
    ) as any).get(chain, address);
    
    if (!token) {
      res.status(404).json({ code: -1, message: '代币不存在' });
      return;
    }
    
    // 模拟交易数据（实际应该从链上获取）
    const mockTrades = Array.from({ length: 20 }, (_, i) => ({
      from_address: `0x${Math.random().toString(16).slice(2, 42)}`,
      to_address: `0x${Math.random().toString(16).slice(2, 42)}`,
      amount: Math.random() * 1000,
      price: Math.random() * 0.01,
      timestamp: Date.now() - Math.random() * 3600000,
      block_number: 1000000 + i
    }));
    
    // 分析刷单风险
    const washTrading = calculateWashTradingScore(mockTrades);
    
    // 分类参与者
    const participants = classifyParticipants(mockTrades);
    
    const result = {
      wash_trading: washTrading,
      participants: {
        project: participants.project_wallets.size,
        bot: participants.bot_wallets.size,
        kol: participants.kol_wallets.size,
        smart_money: participants.smart_money_wallets.size,
        retail: participants.retail_wallets.size
      },
      suspicious_patterns: [],
      recommendation: washTrading.level === 'high' ? '避免' : 
                     washTrading.level === 'moderate' ? '谨慎' : '正常'
    };
    
    // 保存分析结果
    saveTradeAnalysis(chain, address, result, mockTrades.length);
    
    logInfo('API', `交易分析: ${token.symbol} 刷单风险: ${(washTrading.score * 100).toFixed(0)}%`);
    res.json({
      code: 0,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/token/trade-analysis/batch — 批量分析
router.post('/token/trade-analysis/batch', (req: Request, res: Response) => {
  try {
    const limit = parseInt(qs(req.query.limit) || '100') || 100;
    const { batchAnalyze } = require('../services/tradeAnalyzer');
    
    const result = batchAnalyze(limit);
    
    logInfo('API', `批量交易分析: ${result.analyzed}个成功, ${result.skipped}个跳过`);
    res.json({
      code: 0,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/token/trade-analysis/stats — 获取交易分析统计
router.get('/token/trade-analysis/stats', (_req: Request, res: Response) => {
  try {
    const stats = (db.prepare(`
      SELECT 
        wash_trading_level,
        COUNT(*) as count
      FROM token_trade_analysis
      GROUP BY wash_trading_level
    `) as any).all();
    
    const result: Record<string, number> = {
      clean: 0,
      suspicious: 0,
      moderate: 0,
      high: 0
    };
    
    for (const stat of stats) {
      result[stat.wash_trading_level] = stat.count;
    }
    
    res.json({
      code: 0,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ 相关面分析 API（Phase 4） ============

// GET /api/token/context/:chain/:address — 获取相关面分析结果
router.get('/token/context/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { getContextAnalysis } = require('../services/contextAnalyzer');
    
    const analysis = getContextAnalysis(chain, address);
    
    if (!analysis) {
      res.status(404).json({ code: -1, message: '未找到相关面分析数据' });
      return;
    }
    
    res.json({
      code: 0,
      data: analysis
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/token/context/:chain/:address — 分析相关面风险
router.post('/token/context/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { calculateContextRisk, saveContextAnalysis } = require('../services/contextAnalyzer');
    
    // 获取代币数据
    const token = (db.prepare(
      'SELECT * FROM tokens WHERE chain_id = ? AND contract_address = ?'
    ) as any).get(chain, address);
    
    if (!token) {
      res.status(404).json({ code: -1, message: '代币不存在' });
      return;
    }
    
    // 分析相关面风险
    const result = calculateContextRisk(token.symbol, token.name);
    
    // 保存分析结果
    saveContextAnalysis(chain, address, result);
    
    logInfo('API', `相关面分析: ${token.symbol} 风险: ${result.context_risk_level}`);
    res.json({
      code: 0,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/token/context/batch — 批量分析
router.post('/token/context/batch', (req: Request, res: Response) => {
  try {
    const limit = parseInt(qs(req.query.limit) || '100') || 100;
    const { batchAnalyze } = require('../services/contextAnalyzer');
    
    const result = batchAnalyze(limit);
    
    logInfo('API', `批量相关面分析: ${result.analyzed}个成功, ${result.skipped}个跳过`);
    res.json({
      code: 0,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/token/context/stats — 获取相关面分析统计
router.get('/token/context/stats', (_req: Request, res: Response) => {
  try {
    const stats = (db.prepare(`
      SELECT 
        context_risk_level,
        COUNT(*) as count
      FROM token_context_analysis
      GROUP BY context_risk_level
    `) as any).all();
    
    const result: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0
    };
    
    for (const stat of stats) {
      result[stat.context_risk_level] = stat.count;
    }
    
    res.json({
      code: 0,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/token/context/hot-tokens — 添加热门代币
router.post('/token/context/hot-tokens', (req: Request, res: Response) => {
  try {
    const { symbol, chain_id, contract_address, heat_score } = req.body;
    
    if (!symbol || !chain_id || !contract_address) {
      res.status(400).json({ code: -1, message: '缺少必要参数' });
      return;
    }
    
    const { addHotToken } = require('../services/contextAnalyzer');
    addHotToken(symbol, chain_id, contract_address, heat_score || 50);
    
    logInfo('API', `添加热门代币: ${symbol}`);
    res.json({
      code: 0,
      message: '成功添加热门代币'
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/token/context/hot-tokens — 获取热门代币列表
router.get('/token/context/hot-tokens', (_req: Request, res: Response) => {
  try {
    const { getHotTokens } = require('../services/contextAnalyzer');
    const hotTokens = getHotTokens();
    
    res.json({
      code: 0,
      data: hotTokens
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ 钱包智能 API（Phase 5） ============

// GET /api/wallet/:chain/:address — 获取钱包详情
router.get('/wallet/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { getWalletDetail, updateWalletStats } = require('../services/walletIntelligence');
    
    // 更新统计数据
    updateWalletStats(chain, address);
    
    // 获取详情
    const detail = getWalletDetail(chain, address);
    
    res.json({
      code: 0,
      data: detail
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/wallet/:chain/:address/analyze — 分析钱包（Smart Money识别）
router.post('/wallet/:chain/:address/analyze', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { identifySmartMoney, updateWalletStats, getOrCreateWalletProfile } = require('../services/walletIntelligence');
    
    // 获取或创建钱包画像
    const profile = getOrCreateWalletProfile(chain, address);
    
    // 分析Smart Money
    const smartMoneyScore = identifySmartMoney(address, chain);
    
    // 更新统计数据
    updateWalletStats(chain, address);
    
    // 确定钱包类型
    let walletType = 'unknown';
    if (smartMoneyScore.score >= 60) walletType = 'smart_money';
    else if (smartMoneyScore.trade_count > 100) walletType = 'whale';
    
    // 更新钱包类型
    (db.prepare(`
      UPDATE wallet_profiles SET wallet_type = ? WHERE chain_id = ? AND address = ?
    `) as any).run(walletType, chain, address);
    
    logInfo('API', `钱包分析: ${address.slice(0, 10)}... 类型: ${walletType} 评分: ${smartMoneyScore.score}`);
    res.json({
      code: 0,
      data: {
        wallet_type: walletType,
        smart_money_score: smartMoneyScore
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/wallet/watchlist — 添加监控
router.post('/wallet/watchlist', (req: Request, res: Response) => {
  try {
    const { wallet_address, chain_id, priority, alert_on_buy, alert_on_sell, alert_threshold_usd } = req.body;
    
    if (!wallet_address || !chain_id) {
      res.status(400).json({ code: -1, message: '缺少必要参数' });
      return;
    }
    
    const { addToWatchlist } = require('../services/walletIntelligence');
    const result = addToWatchlist({
      wallet_address,
      chain_id,
      priority: priority || 'normal',
      alert_on_buy: alert_on_buy !== false,
      alert_on_sell: alert_on_sell !== false,
      alert_threshold_usd: alert_threshold_usd || 1000
    });
    
    res.json({
      code: result.success ? 0 : -1,
      message: result.message
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// DELETE /api/wallet/watchlist/:chain/:address — 移除监控
router.delete('/wallet/watchlist/:chain/:address', (req: Request, res: Response) => {
  try {
    const chain = String(req.params.chain);
    const address = String(req.params.address);
    const { removeFromWatchlist } = require('../services/walletIntelligence');
    
    const result = removeFromWatchlist(chain, address);
    
    res.json({
      code: result.success ? 0 : -1,
      message: result.message
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/wallet/watchlist — 获取监控列表
router.get('/wallet/watchlist', (req: Request, res: Response) => {
  try {
    const page = parseInt(qs(req.query.page) || '1') || 1;
    const pageSize = parseInt(qs(req.query.pageSize) || '20') || 20;
    const status = qs(req.query.status);
    const priority = qs(req.query.priority);
    
    const { getWatchlist } = require('../services/walletIntelligence');
    const result = getWatchlist({ page, pageSize, status, priority });
    
    res.json({
      code: 0,
      data: result.list,
      total: result.total,
      page,
      pageSize
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/wallet/watchlist/stats — 获取监控统计
router.get('/wallet/watchlist/stats', (_req: Request, res: Response) => {
  try {
    const { getWatchlistStats, getWalletTypeStats } = require('../services/walletIntelligence');
    
    res.json({
      code: 0,
      data: {
        watchlist: getWatchlistStats(),
        wallet_types: getWalletTypeStats()
      }
    });
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
    if (!result.success) { logWarn('模拟交易', `创建交易失败: ${symbol} ${side} - ${result.reason}`); res.status(400).json({ code: -1, message: result.reason }); return; }
    const trade = (db.prepare('SELECT * FROM sim_trades WHERE trade_id = ?')).get(result.trade_id);
    logInfo('模拟交易', `创建交易: ${side} ${symbol} @ ${price || 'market'}, trade_id=${result.trade_id}`);
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

// POST /api/sim/portfolio/reconcile — 预算对账（修复批量平仓后预算未回收）
router.post('/sim/portfolio/reconcile', (_req: Request, res: Response) => {
  try {
    const result = reconcileBudget();
    logInfo('模拟交易', `预算对账API: used=$${result.used_budget} available=$${result.available_budget}`);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/sim/settings — 获取用户设置（止盈止损阈值等）
router.get('/sim/settings', (_req: Request, res: Response) => {
  try {
    ensureSimTables();
    const settings = getSimSettings();
    res.json({ code: 0, data: settings });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// PUT /api/sim/settings — 更新用户设置（止盈止损阈值等）
router.put('/sim/settings', (req: Request, res: Response) => {
  try {
    ensureSimTables();
    const { stop_loss_percent, take_profit_percent, auto_mode } = req.body;
    const result = updateSimSettings({ stop_loss_percent, take_profit_percent, auto_mode });
    logInfo('模拟交易', `设置更新API: SL=${result.stop_loss_percent}% TP=${result.take_profit_percent}%`);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(400).json({ code: -1, message: err.message });
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
    logInfo('模拟交易', `手动平仓: ${trade.symbol} @ ${price}, reason=${reason || 'manual'}`);
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

// GET /api/sim/open-positions — 未平仓订单列表（含当前价格、止盈止损价格、实时盈亏）
router.get('/sim/open-positions', (_req: Request, res: Response) => {
  try {
    ensureSimTables();
    const positions = getOpenPositions();
    // 计算汇总
    const totalInvested = positions.reduce((s: number, p: any) => s + p.buy_amount, 0);
    const totalCurrentValue = positions.reduce((s: number, p: any) => s + p.current_value, 0);
    const totalUnrealizedPnl = positions.reduce((s: number, p: any) => s + p.unrealized_pnl, 0);
    const avgPnlPct = positions.length > 0 ? positions.reduce((s: number, p: any) => s + p.unrealized_pnl_percent, 0) / positions.length : 0;
    res.json({
      code: 0,
      data: {
        positions,
        summary: {
          count: positions.length,
          total_invested: parseFloat(totalInvested.toFixed(2)),
          total_current_value: parseFloat(totalCurrentValue.toFixed(2)),
          total_unrealized_pnl: parseFloat(totalUnrealizedPnl.toFixed(2)),
          avg_pnl_percent: parseFloat(avgPnlPct.toFixed(2)),
        },
      },
    });
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

    logInfo('API', `收益曲线: days=${days} 数据点=${result.length}`);
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

    logInfo('API', `AI分析统计: total=${total} avgScore=${parseFloat(avgScore).toFixed(1)}`);

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

// GET /api/ai/decision-criteria — AI 决策标准与阈值
router.get('/ai/decision-criteria', (_req: Request, res: Response) => {
  try {
    const { THRESHOLDS } = require('../config/thresholds');
    
    // 评分维度说明
    const dimensions = [
      {
        key: 'security',
        name: '合约安全',
        maxScore: 20,
        weight: THRESHOLDS.decision.weights.risk,
        criteria: [
          { condition: '审计风险低 (risk_level=1)', score: 18, description: '合约通过安全审计' },
          { condition: '审计风险中等 (risk_level=2)', score: 10, description: '合约审计有部分风险' },
          { condition: '审计风险高 (risk_level≥3)', score: 3, description: '合约存在高风险' },
          { condition: '异常税率', score: -5, description: '买入/卖出税率异常' },
          { condition: '买入税率>5%', score: -3, description: '买入成本过高' },
        ],
      },
      {
        key: 'smartMoney',
        name: '聪明钱信号',
        maxScore: 25,
        weight: THRESHOLDS.decision.weights.onchain,
        criteria: [
          { condition: 'SM持有者≥10', score: 22, description: '大量聪明钱关注' },
          { condition: 'SM持有者≥5', score: 18, description: '聪明钱关注度较高' },
          { condition: 'SM持有者≥2', score: 14, description: '少量聪明钱关注' },
          { condition: 'SM持有者<2', score: 6, description: '聪明钱关注度低' },
          { condition: 'SM占比>5%', score: 3, description: '聪明钱重仓' },
          { condition: 'SM买入信号', score: 5, description: '聪明钱正在买入' },
        ],
      },
      {
        key: 'social',
        name: '社交热度',
        maxScore: 15,
        weight: THRESHOLDS.decision.weights.market,
        criteria: [
          { condition: '搜索量≥100/24h', score: 13, description: '搜索热度高' },
          { condition: '搜索量≥30/24h', score: 10, description: '搜索热度中等' },
          { condition: '搜索量<30/24h', score: 5, description: '搜索热度低' },
          { condition: '有社交话题关联', score: 2, description: '社交媒体讨论' },
        ],
      },
      {
        key: 'issuer',
        name: '发行方信誉',
        maxScore: 15,
        weight: THRESHOLDS.decision.weights.issuer,
        criteria: [
          { condition: '迁移率>50%', score: 13, description: '项目方有成功迁移历史' },
          { condition: '迁移率>20%', score: 10, description: '项目方迁移记录一般' },
          { condition: '迁移率<20%', score: 4, description: '项目方迁移记录差' },
          { condition: '发行代币>100个', score: -2, description: '⚠️ 批量发币风险' },
        ],
      },
      {
        key: 'liquidity',
        name: '流动性/持有人',
        maxScore: 25,
        weight: THRESHOLDS.decision.weights.liquidity,
        criteria: [
          { condition: '持有人≥500', score: 4, description: '持有人数量健康' },
          { condition: '持有人≥100', score: 2, description: '持有人数量中等' },
          { condition: '持有人<100', score: -2, description: '持有人过少' },
          { condition: '流动性≥$100K', score: 4, description: '流动性充足' },
          { condition: '流动性≥$20K', score: 2, description: '流动性中等' },
          { condition: '流动性<$20K', score: -3, description: '⚠️ 流动性差' },
          { condition: '24H交易量≥$50K', score: 3, description: '交易活跃' },
          { condition: '市值<$50K', score: 2, description: '低市值上涨空间大' },
        ],
      },
    ];

    // 决策阈值
    const decisionRules = {
      buyThreshold: THRESHOLDS.decision.buyThreshold,
      holdThreshold: THRESHOLDS.decision.holdThreshold,
      watchThreshold: THRESHOLDS.decision.watchThreshold,
      riskDowngradeRule: '高风险标记≥3个时，BUY降级为HOLD，HOLD降级为WATCH',
    };

    // 交易金额配置
    const tradingRules = {
      buyAmountMap: {
        BUY: { amount: 100, description: 'AI建议买入时投入$100' },
        HOLD: { amount: 50, description: 'AI建议持有时投入$50' },
        AVOID: { amount: 10, description: 'AI建议回避时投入$10' },
      },
      budget: {
        totalBudget: 10000,
        maxPerTrade: 100,
        maxPositions: 1000,
        maxChainPercent: 40,
      },
      stopLoss: THRESHOLDS.simulation.stopLossPercent,
      takeProfit: THRESHOLDS.simulation.takeProfitPercent,
    };

    // 发行方风险阈值
    const issuerRisk = THRESHOLDS.issuer;
    const addressRisk = THRESHOLDS.address;

    logInfo('API', 'AI决策标准查询');
    res.json({
      code: 0,
      data: {
        dimensions,
        decisionRules,
        tradingRules,
        issuerRisk,
        addressRisk,
      },
    });
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

// ============ AI 阈值管理 API ============

// GET /api/ai/thresholds — 获取所有阈值配置
router.get('/ai/thresholds', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT key, value FROM ai_thresholds').all() as any[];
    const thresholds: Record<string, string> = {};
    for (const row of rows) {
      thresholds[row.key] = row.value;
    }
    logInfo('API', '获取AI阈值配置');
    res.json({ code: 0, data: thresholds });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// PUT /api/ai/thresholds — 更新阈值配置
router.put('/ai/thresholds', (req: Request, res: Response) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      res.status(400).json({ code: -1, message: '请求体必须是对象' });
      return;
    }

    const allowedKeys = new Set([
      'dimension_weight_risk', 'dimension_weight_market', 'dimension_weight_issuer',
      'dimension_weight_onchain', 'dimension_weight_liquidity',
      'buy_threshold', 'hold_threshold', 'watch_threshold',
      'buy_amount_buy', 'buy_amount_hold', 'buy_amount_avoid',
      'total_budget', 'max_per_trade', 'max_positions', 'max_chain_pct',
      'stop_loss_percent', 'take_profit_percent',
    ]);

    const stmt = db.prepare('INSERT INTO ai_thresholds (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime(\'now\')');
    
    let updated = 0;
    for (const [key, value] of Object.entries(updates)) {
      if (allowedKeys.has(key)) {
        stmt.run(key, String(value), String(value));
        updated++;
      }
    }

    logInfo('API', `更新AI阈值: ${updated}项`);
    res.json({ code: 0, data: { updated }, message: `成功更新${updated}项配置` });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// GET /api/ai/thresholds/defaults — 获取默认阈值配置
router.get('/ai/thresholds/defaults', (_req: Request, res: Response) => {
  try {
    const defaults = {
      dimension_weight_risk: 0.25,
      dimension_weight_market: 0.15,
      dimension_weight_issuer: 0.15,
      dimension_weight_onchain: 0.25,
      dimension_weight_liquidity: 0.20,
      buy_threshold: 70,
      hold_threshold: 50,
      watch_threshold: 30,
      buy_amount_buy: 100,
      buy_amount_hold: 50,
      buy_amount_avoid: 10,
      total_budget: 10000,
      max_per_trade: 100,
      max_positions: 1000,
      max_chain_pct: 40,
      stop_loss_percent: -20,
      take_profit_percent: 50,
    };
    res.json({ code: 0, data: defaults });
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
    logInfo('Agent评分', `${chain}/${address}: score=${result.score} rec=${result.recommendation}`);
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
      logWarn('系统控制', `模块切换失败: ${moduleId} 不存在`);
      res.status(404).json({ code: -1, message: `Module ${moduleId} not found` });
      return;
    }

    const status = getModuleStatus(moduleId);
    logInfo('系统控制', `模块切换: ${moduleId} → ${running ? '启动' : '暂停'}`);
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
    const startTime = Date.now();
    for (const status of statuses) {
      toggleModule(status.id, running);
    }
    const elapsed = Date.now() - startTime;
    logInfo('系统控制', `全部${running ? '启动' : '暂停'}: ${statuses.length} 个模块, 耗时 ${elapsed}ms`);
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
    logInfo('Agent讨论', `${chain}/${contract}: 讨论完成`);
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
    logInfo('Agent讨论', `${chain}/${contract}: 查询历史 limit=${limit}`);
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

// ============ 代理配置 API ============

// GET /api/system/proxy — 获取代理状态
router.get('/system/proxy', (_req: Request, res: Response) => {
  try {
    const status = getProxyStatus();
    res.json({ code: 0, data: status });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/system/proxy — 设置代理
router.post('/system/proxy', async (req: Request, res: Response) => {
  try {
    const { address, enabled } = req.body;
    if (typeof address !== 'string' || typeof enabled !== 'boolean') {
      res.status(400).json({ code: -1, message: '参数格式错误: {address: string, enabled: boolean}' });
      return;
    }
    const result = setProxy(address, enabled);
    if (!result.success) {
      logError('代理检测', `代理保存失败: ${result.message}`);
      res.status(500).json({ code: -1, message: result.message });
      return;
    }
    // 设置后立即测试连通性
    const test = await testProxy();
    logInfo('代理检测', `代理已保存: ${address} (${enabled ? '启用' : '禁用'}), 连通性: ${test.success ? 'OK' : 'FAIL'}`);
    res.json({ code: 0, data: { ...result, test } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ 系统日志 API ============

// GET /api/system/logs — SSE 实时日志流
router.get('/system/logs', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // 发送连接成功事件
  res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', module: 'system', message: '日志流连接成功' })}\n\n`);

  // 心跳保活
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  // 注册客户端
  const removeClient = addLogSSEClient((data: string) => {
    res.write(data);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient();
  });
});

// GET /api/system/logs/history — 返回最近 100 条日志
router.get('/system/logs/history', (_req: Request, res: Response) => {
  try {
    const logs = getRecentLogs(100);
    res.json({ code: 0, data: { logs, total: logs.length, sseClients: getLogSSEClientCount() } });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/system/proxy/test — 测试代理连通性
router.post('/system/proxy/test', async (_req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    const result = await testProxy();
    const elapsed = Date.now() - startTime;
    logInfo('代理检测', `连通性测试: ${result.success ? '成功' : '失败'}, 耗时 ${elapsed}ms`);
    res.json({ code: 0, data: result });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// ============ SOL链数据 API ============

// GET /api/sol/token/:address — 获取单个SOL代币的DexScreener+RugCheck数据
router.get('/sol/token/:address', async (req: Request, res: Response) => {
  try {
    const address = String(req.params.address);
    const result = await fetchSingleSolTokenData(address);
    logInfo('SOL数据', `单代币查询: ${address}`);
    res.json({
      code: 0,
      data: {
        dex: result.dexData ? {
          price_usd: result.dexData.priceUsd,
          volume_24h: result.dexData.volume?.h24,
          price_change_24h: result.dexData.priceChange?.h24,
          price_change_1h: result.dexData.priceChange?.h1,
          liquidity: result.dexData.liquidity?.usd,
          market_cap: result.dexData.marketCap || result.dexData.fdv,
          txns_24h: result.dexData.txns?.h24,
          dex: result.dexData.dexId,
          pair_address: result.dexData.pairAddress,
        } : null,
        audit: result.audit ? {
          score: result.audit.score,
          score_normalised: result.audit.score_normalised,
          risks: result.audit.risks,
          lp_locked_pct: result.audit.lpLockedPct,
          token_program: result.audit.tokenProgram,
        } : null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});

// POST /api/sol/refresh-all — 手动触发全量SOL数据采集
router.post('/sol/refresh-all', async (_req: Request, res: Response) => {
  try {
    const dexResult = await fetchAllSolTokenData();
    const auditResult = await fetchAllSolAudits();
    logInfo('SOL数据', `手动全量采集: dex=${dexResult.updated} audit=${auditResult.audited}`);
    res.json({
      code: 0,
      data: {
        dex: dexResult,
        audit: auditResult,
      },
    });
  } catch (err: any) {
    res.status(500).json({ code: -1, message: err.message });
  }
});
