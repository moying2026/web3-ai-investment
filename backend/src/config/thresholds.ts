// 阈值配置 — 所有规则引擎阈值集中管理，便于后期根据实际数据调整

export const THRESHOLDS = {
  // 发行方风险
  issuer: {
    totalTokensHigh: 100,       // 发行代币总数 >100 → 高风险
    totalTokensMedium: 20,      // 发行代币总数 >20 → 中风险
    recent7dHigh: 10,           // 近7天发行 >10 → 高风险（批量发币）
    recent7dMedium: 5,          // 近7天发行 >5 → 中风险
    migrationRateLow: 0.1,      // 迁移率 <10% → 高风险
    migrationRateMedium: 0.3,   // 迁移率 <30% → 中风险
    minTokensForRateCheck: 5,   // 迁移率检查最少代币数
  },

  // 地址风险
  address: {
    top10PercentHigh: 80,       // 前10持仓 ≥80% → 高度集中
    top10PercentMedium: 60,     // 前10持仓 ≥60% → 中等集中
    top10PercentHealthy: 30,    // 前10持仓 <30% → 分布均匀
    bundlesHigh: 50,            // 批量地址 ≥50% → 高度可疑
    bundlesMedium: 30,          // 批量地址 ≥30% → 偏高
    devHoldingHigh: 20,         // 开发者持仓 ≥20% → 跑路风险
    smHoldingStrong: 10,        // Smart Money ≥10% → 重仓（正面）
    smHoldingMedium: 5,         // Smart Money ≥5% → 关注
    holdersLow: 50,             // 持有人 <50 → 过少
    holdersHealthy: 500,        // 持有人 ≥500 → 健康
    uniqueTradersLow: 10,       // 24h交易者 <10 → 活跃度极低
    uniqueTradersHealthy: 50,   // 24h交易者 ≥50 → 活跃
  },

  // 同名检测
  duplicate: {
    crossChainMinAgeDays: 7,    // 跨链项目最少上线天数
    commonSymbols: ['TEST', 'MOON', 'DOGE', 'PEPE', 'SHIB'], // 常见名称，需额外验证
  },

  // 决策加权
  decision: {
    weights: {
      risk: 0.25,
      market: 0.15,
      issuer: 0.15,
      onchain: 0.25,
      liquidity: 0.20,
    },
    buyThreshold: 70,           // 综合评分 ≥70 → BUY
    holdThreshold: 50,          // 综合评分 ≥50 → HOLD
    watchThreshold: 30,         // 综合评分 ≥30 → WATCH
    lowConfidenceThreshold: 0.3, // 任一 Agent 置信度 <0.3 → 整体降低
  },

  // 模拟交易
  simulation: {
    defaultBuyAmount: 100,      // 默认买入金额 $100
    stopLossPercent: -20,       // 止损 -20%
    takeProfitPercent: 50,      // 止盈 +50%
  },
} as const;
