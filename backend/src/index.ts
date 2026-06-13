import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { initDatabase } from './db/database';
import { initKnownTokensCache } from './services/tokenService';
import { startPolling } from './services/pollingService';
import { reconcileBudget } from './services/simTradeService';
import { loadThresholdsFromDB } from './config/thresholds';
import routes from './api/routes';

const PORT = parseInt(process.env.PORT || '3500', 10);

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('  Web3 AI 投资决策系统 — 后端数据采集服务');
  console.log('  版本: 0.1.0');
  console.log('='.repeat(60));

  // 1. 初始化数据库
  console.log('\n[1/4] 初始化数据库...');
  initDatabase();

  // 1.5 加载 AI 阈值配置
  loadThresholdsFromDB();

  // 2. 加载已知代币缓存
  console.log('[2/4] 加载已知代币缓存...');
  initKnownTokensCache();

  // 2.5 预算对账（修复批量平仓后预算未回收）
  reconcileBudget();

  // 3. 启动 Express 服务
  console.log('[3/4] 启动 API 服务...');
  const app = express();

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json());

  // API 路由
  app.use('/api', routes);

  // 前端静态文件
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));

  // SPA 兜底：非 API 路由一律返回 index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`[API] 服务已启动: http://localhost:${PORT}`);
    console.log(`[API] SSE 端点: http://localhost:${PORT}/api/stream/new-tokens`);
  });

  // 4. 启动轮询服务
  console.log('[4/4] 启动数据采集轮询...');
  startPolling();

  console.log('\n✅ 系统启动完成，开始采集数据...\n');
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
