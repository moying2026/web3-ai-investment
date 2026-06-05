# 规则引擎与多 Agent 架构设计

> 版本：v1.0
> 日期：2026-06-04
> 整理人：项目牧羊人
> 参与者：陈哥、后端架构师、前端工程师

---

## 一、项目目标

通过 Web3 一级市场新币首发实现盈利，利用 AI 多 Agent 协作决策，精准识别机会、规避风险。

---

## 二、三大场景分类

### A. 新币上线（小额试水，快进快出）

**核心逻辑：** 开盘 10-15 秒内小额买入（0.01 BNB），翻倍出本金，4 倍出剩余一半。

**分析维度：**

| 维度 | 检测内容 | 数据来源 | 优先级 |
|:--|:--|:--|:--|
| 同名/跨链检测 | 判断仿币 vs 真实跨链项目 | tokens 表按 symbol 模糊搜索 | P0 |
| 项目信息核验 | 网址/GitHub/团队/推特一致性 | 代币 links 字段 | P1 |
| 发行方频率 | 批量发币过滤（>20个→高风险） | issuer_profiles 表 | P0 |
| KOL 身份核验 | 长期持有型 vs 赚跑型 | 需新增 KOL 地址库 | P2 |
| 地址分析 | 内幕地址、批量刷号机器地址 | holders_top10_percent, bundles_holding_percent | P0 |

**入场策略（需模拟盘验证）：**
- 开盘 10-15 秒，0.01 BNB 试水
- 翻倍出本金（回收成本）
- 4 倍出剩余一半
- 其余按止损/止盈规则管理

### B. 老币上热门（分析热度逻辑）

**核心逻辑：** 判断热度来源，区分利好类型，把控入场节奏。

**分析维度：**

| 维度 | 检测内容 | 数据来源 | 优先级 |
|:--|:--|:--|:--|
| 利好类型判断 | 重大利好 vs 短期话题 vs 政治局势 | social_topics + AI 分析 | P1 |
| 空气币过滤 | 项目已死的不参与 | onchain_last_sync + 活跃度 | P1 |
| 热度持续性 | 话题热度变化曲线 | 需新增时序数据 | P2 |
| 市值等硬性指标 | 流动性、持有人、成交量 | tokens 表 | P0 |

### C. 老币异动（主动挖掘机会）

**核心逻辑：** 检测异常波动，寻找抄底机会。

**分析维度：**

| 维度 | 检测内容 | 数据来源 | 优先级 |
|:--|:--|:--|:--|
| 放量暴跌检测 | 持续放量暴跌后企稳 | 需价格时序数据 | P2 |
| 黑天鹅事件 | 跳水后分批抄底 | 需异常波动检测 | P2 |
| 庄家吸筹检测 | 长期不动代币的低位筹码吸收 | 需大额地址持仓变化追踪 | P3 |

---

## 三、多 Agent 决策架构

### 3.1 Agent 分工

| Agent | 职责 | 评分维度 | 数据来源 |
|:--|:--|:--|:--|
| 风险评估 Agent | 审计数据、合约风险 | security 评分 | audit_info, contract_analysis |
| 市场分析 Agent | 热度、话题、KOL | social 评分 | social_topics, search_count |
| 发行方分析 Agent | 历史、迁移率、频率 | issuer 评分 | issuer_profiles, issuer_tokens |
| 链上分析 Agent | 地址分布、内幕检测 | smartMoney 评分 | holders, bundles |
| 最终决策 Agent | 综合各 Agent 评分 | 综合评分 + 建议 | 以上四个 Agent |

### 3.2 技术架构

**后端：独立评分 + 共享数据层**
- 每个 Agent 封装为独立 Service
- Agent 接口统一：`evaluate(chainId, contractAddress) → {score, details}`
- Agent 之间不直接通信，从共享数据层（SQLite）读取数据
- 轮询流程：采集数据 → 5 个 Agent 并行评分 → 决策 Agent 汇总 → 触发模拟交易

**前端：综合结论 + 各 Agent 独立评分**
- 顶层：综合决策卡片（最终建议、综合评分、置信度）
- 底层：各 Agent 评分面板（可展开查看详情）
- 颜色编码：≥70 绿色、40-69 橙色、<40 红色

### 3.3 数据库新增

```sql
-- 各 Agent 独立评分记录
CREATE TABLE agent_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  agent_type TEXT NOT NULL,  -- risk/market/issuer/onchain/decision
  score REAL NOT NULL,
  details_json TEXT,
  evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 策略规则配置
CREATE TABLE strategy_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT UNIQUE NOT NULL,
  scenario TEXT NOT NULL,  -- new_coin/trending/anomaly
  conditions_json TEXT NOT NULL,
  action TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 策略验证记录
CREATE TABLE strategy_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  predicted TEXT NOT NULL,
  actual_result TEXT,
  pnl REAL,
  validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 四、策略演进机制

### 4.1 三阶段演进

| 阶段 | 状态 | 说明 | 前端标识 |
|:--|:--|:--|:--|
| 全量验证期 | 蓝色 | 所有新币都模拟下单，积累数据 | 蓝色标签 |
| 筛选期 | 黄色 | 根据胜率筛选有效策略，标记验证结论 | 黄色标签 |
| 精简运行期 | 绿色 | 只对符合条件的币种下单，其他备注依据不再跟进 | 绿色标签 |

### 4.2 定期复盘

- 每周/每月回顾历史数据
- 挖掘遗漏机会
- 调整策略权重

---

## 五、前端展示方案

### 5.1 多 Agent 评分展示

**顶层：综合决策卡片**
- 最终建议：BUY / SELL / HOLD / WATCH（大字+颜色）
- 综合评分：0-100 分（环形进度条）
- 置信度：基于各 Agent 一致性计算
- 触发场景标签：新币上线 / 热门 / 异动

**底层：各 Agent 评分面板**
- 复用现有五维雷达图
- 每个 Agent 独立卡片：评分 + 关键发现 + 风险提示
- 点击展开 details_json 详细数据

### 5.2 三大场景差异化展示

**A. 新币上线：卡片流布局**
- 代币图标+名称+评分+关键风险点
- 一键「模拟买入」/「跳过」按钮
- 实时刷新，新币 SSE 推送

**B. 老币上热门：话题热力图 + 时间线**
- 左侧：社交话题列表（按热度排序）
- 右侧：选中话题关联代币的价格/成交量走势
- 利好类型标签（重大利好/短期话题/政治局势）

**C. 老币异动：异常检测仪表盘**
- 实时异动列表（放量暴跌/异常交易量）
- 价格走势 + 标注异常时间点
- 抄底信号卡片（分批入场建议）

### 5.3 策略验证 Tab

Rules 页面新增「策略验证」Tab：
- 策略列表：规则名称、场景标签、触发次数、胜率、累计盈亏
- 策略详情：点击展开，显示该规则下的所有验证记录
- 演进状态：全量验证期（蓝）→ 筛选期（黄）→ 精简运行期（绿）

---

## 六、优先级与排期

| 优先级 | 任务 | 负责人 | 时间 | 说明 |
|:--|:--|:--|:--|:--|
| P0 | 新币基础过滤 | 后端 | 1-2天 | 同名检测 + 发行方频率 + 地址基础分析 |
| P0 | 前端展示适配 | 前端 | 1-2天 | 同名检测结果 + 发行方批量发币标记 |
| P1 | 策略验证框架 | 后端 | 3-5天 | 新增三张表 + 策略演进机制 |
| P1 | 策略验证 Tab | 前端 | 3-5天 | Rules 页面扩展 |
| P2 | 多 Agent 拆分 | 后端 | 1-2周 | 从单一 service 拆分为 5 个 Agent |
| P2 | 多 Agent 评分面板 | 前端 | 1-2周 | 需等后端 Agent 接口就绪 |
| P3 | 数据源补充 | 后端 | 持续 | KOL 地址库、项目信息核验、链上地址聚类 |

---

## 七、技术风险

1. **数据源限制**：Binance 公开 API 无 KOL/地址聚类数据，需额外数据源或链上解析
2. **时序数据**：老币异动需要价格时序存储，当前数据库没有专门的时序表
3. **API 限流**：多 Agent 并行评分会增加 API 调用量，需注意代理限流
4. **前端适配**：A 场景的卡片流需要新的移动端适配布局

---

## 八、前端技术细化（前端工程师补充，2026-06-04）

### 8.1 组件选型评估

| 展示需求 | 组件方案 | 可行性 | 备注 |
|:--|:--|:--|:--|
| 综合决策卡片 | Ant Design Card + Statistic + Progress | ✅ 完全满足 | 已在 SimStats/Trading 中使用 |
| 五维雷达图 | ECharts radar | ✅ 已实现 | Rules 页面已接入 |
| Agent 评分面板 | Ant Design Collapse + Card | ✅ 完全满足 | 每个 Agent 可折叠展开 |
| A 场景卡片流 | Ant Design List + Card（虚拟滚动） | ✅ 可实现 | 需引入 react-virtualized 或 Ant Design VirtualList |
| B 场景话题热力图 | ECharts heatmap + 价格走势双轴图 | ✅ 完全满足 | ECharts 原生支持 |
| C 场景异常仪表盘 | ECharts line + markPoint 标注异常点 | ✅ 完全满足 | markPoint 可标注暴跌/放量时间点 |
| 策略验证表格 | Ant Design Table + Tag + Progress | ✅ 完全满足 | 已在 Rules/SimStats 中使用 |
| 环形进度条（评分） | Ant Design Progress type="circle" | ✅ 完全满足 | 可自定义颜色区间 |
| 实时新币推送 | 现有 SSE 基础设施 | ✅ 已有 | Dashboard 已使用 SSE |

**结论：现有 ECharts + Ant Design 组件库完全满足所有展示需求，无需引入新依赖。**

### 8.2 前端需要的 API 接口清单

| 接口 | 方法 | 说明 | 优先级 | 调用场景 |
|:--|:--|:--|:--|:--|
| `/api/tokens/:chain/:address/similar` | GET | 同名/跨链代币列表 | P0 | 代币详情页 |
| `/api/issuer/:address/risk` | GET | 发行方风险评估（含批量发币标记） | P0 | 发行方画像页 |
| `/api/tokens/:chain/:address/address-analysis` | GET | 地址分析（内幕/批量刷号） | P0 | 代币详情页 |
| `/api/agent/evaluate` | POST | 触发多 Agent 评分 | P2 | 代币详情页/交易页 |
| `/api/agent/scores/:chain/:address` | GET | 获取各 Agent 评分结果 | P2 | 代币详情页 |
| `/api/strategies` | GET | 策略规则列表 | P1 | Rules 页面 |
| `/api/strategies/:ruleId/validations` | GET | 策略验证记录 | P1 | Rules 页面 |
| `/api/strategies/:ruleId` | PATCH | 更新策略状态（启用/禁用/调整） | P1 | Rules 页面 |
| `/api/anomaly/detect` | GET | 异常波动检测结果 | P2 | C 场景仪表盘 |
| `/api/social/topics/:topicId/tokens` | GET | 话题关联代币列表 | P1 | B 场景热力图 |

**已有可复用接口：**
- `GET /api/tokens` — 代币列表（筛选+排序）
- `GET /api/tokens/:chain/:address` — 代币详情
- `GET /api/issuer/:address` — 发行方画像
- `GET /api/issuer/:address/tokens` — 发行方历史代币
- `GET /api/ai/analysis` — AI 分析结果
- `GET /api/sim/stats` — 模拟盘统计
- `GET /api/sim/trades` — 交易记录
- `GET /api/social-topics` — 社交话题列表

### 8.3 移动端适配方案

**适配策略：响应式布局优先，不做独立移动端页面。**

| 圏面 | 桌面端 (≥1200px) | 平板 (768-1199px) | 手机 (<768px) |
|:--|:--|:--|:--|
| 综合决策卡片 | Row 4 列 | Row 2 列 | Row 1 列 |
| Agent 评分面板 | 水平排列 5 卡片 | 2+3 排列 | 垂直堆叠 |
| A 场景卡片流 | 3 列网格 | 2 列网格 | 1 列全宽卡片 |
| B 场景热力图 | 左右分栏 | 上下分栏 | 上下分栏 |
| C 场景仪表盘 | 左右分栏 | 上下分栏 | 上下分栏 |
| 策略表格 | 完整表格 | 完整表格（横向滚动） | 卡片列表形式 |

**技术实现：**
- 使用 Ant Design 的 `Row.Col` 响应式栅格（xs/sm/md/lg/xl 断点）
- 卡片流场景：桌面端 `span={8}`，平板 `span={12}`，手机 `span={24}`
- 表格场景：手机端切换为卡片列表（`Card` + 描述列表），用 `useMediaQuery` 或 CSS 媒体查询
- K 线图：手机端隐藏时间周期切换按钮，默认显示日线

**CSS 方案：** 统一使用 Ant Design 内联 style + 响应式工具类，不引入额外 CSS 框架。

### 8.4 前端实现路径

| 阶段 | 任务 | 依赖 | 工作量 |
|:--|:--|:--|:--|
| P0-前端-1 | 代币详情页新增「相似代币」区块 | 后端 `/api/tokens/:chain/:address/similar` | 0.5天 |
| P0-前端-2 | 代币详情页新增「地址分析」区块 | 后端 `/api/tokens/:chain/:address/address-analysis` | 0.5天 |
| P0-前端-3 | 发行方画像页新增「批量发币」风险标签 | 后端 `/api/issuer/:address/risk`（已有） | 0.5天 |
| P1-前端-1 | Rules 页面新增「策略验证」Tab | 后端 strategy_rules + strategy_validations 表 | 1天 |
| P1-前端-2 | A 场景新币卡片流页面 | 后端新币推送 + Agent 评分 | 1.5天 |
| P1-前端-3 | B 场景热门话题热力图 | 后端社交话题关联代币接口 | 1天 |
| P2-前端-1 | 多 Agent 评分面板 | 后端 Agent 接口定义确定 | 2天 |
| P2-前端-2 | C 场景异常检测仪表盘 | 后端异常检测接口 | 1.5天 |
| P2-前端-3 | 移动端响应式适配 | 以上页面完成后 | 1天 |

---

## 九、验收标准

1. P0 完成后：新币上线时能自动检测同名代币、批量发币、地址风险
2. P1 完成后：策略验证框架运行，能记录预测结果和实际盈亏
3. P2 完成后：5 个 Agent 独立评分，前端展示综合结论和各 Agent 详情
4. P3 持续迭代：数据源逐步丰富，评分精度持续提升

---

## 九、后端技术补充（后端架构师 · 2026-06-04）

### 9.1 数据库设计审查与细化

#### 9.1.1 agent_scores 表（完整字段定义 + 索引）

```sql
CREATE TABLE agent_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK(agent_type IN ('risk','market','issuer','onchain','decision')),
  score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
  details_json TEXT,           -- Agent 评分详情（JSON）
  confidence REAL DEFAULT 0,   -- 置信度 0-1（数据完整性决定）
  evaluated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(chain_id, contract_address, agent_type, evaluated_at) -- 同一代币同一Agent同一时间只有一条
);

CREATE INDEX idx_agent_scores_token ON agent_scores(chain_id, contract_address);
CREATE INDEX idx_agent_scores_type ON agent_scores(agent_type);
CREATE INDEX idx_agent_scores_time ON agent_scores(evaluated_at);
CREATE INDEX idx_agent_scores_score ON agent_scores(score);
```

**设计说明：**
- `confidence` 字段：当审计数据缺失、发行方无历史等情况时，置信度降低，决策 Agent 加权时会打折
- `details_json` 格式示例（risk agent）：
  ```json
  {
    "risk_level": 2,
    "buy_tax": "0.02",
    "sell_tax": "0.02",
    "unusual_tax": false,
    "is_verified": true,
    "risk_items": ["高买入税率"],
    "confidence": 0.8
  }
  ```

#### 9.1.2 strategy_rules 表（完整字段定义）

```sql
CREATE TABLE strategy_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT UNIQUE NOT NULL,       -- 规则ID，如 'A.1', 'A.3', 'B.1'
  scenario TEXT NOT NULL CHECK(scenario IN ('new_coin','trending','anomaly')),
  name TEXT NOT NULL,                  -- 规则名称
  description TEXT,                    -- 规则描述
  conditions_json TEXT NOT NULL,       -- 条件表达式（JSON）
  action TEXT NOT NULL,                -- 触发动作：buy/skip/watch/alert
  action_params_json TEXT,             -- 动作参数（如买入金额、止损比例）
  priority INTEGER DEFAULT 0,          -- 优先级（数值越大越优先）
  validation_stage TEXT DEFAULT 'full_validation'
    CHECK(validation_stage IN ('full_validation','filtering','production')),
  min_win_rate REAL,                   -- 进入 production 阶段的最低胜率
  min_sample_size INTEGER DEFAULT 10,  -- 最少验证样本数
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**conditions_json 格式定义：**
```json
{
  "operator": "AND",
  "conditions": [
    {"field": "issuer.total_tokens", "op": ">", "value": 20},
    {"field": "token.holders", "op": "<", "value": 100},
    {"field": "audit.risk_level", "op": ">=", "value": 3},
    {"field": "token.symbol_duplicate_count", "op": ">", "value": 0}
  ]
}
```

#### 9.1.3 strategy_validations 表

```sql
CREATE TABLE strategy_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  symbol TEXT,
  predicted TEXT NOT NULL,          -- 预测结果：buy/skip/watch
  actual_result TEXT,               -- 实际结果：win/loss/neutral/pending
  entry_price TEXT,
  exit_price TEXT,
  pnl REAL,                        -- 盈亏金额
  pnl_percent REAL,                -- 盈亏百分比
  holding_minutes INTEGER,         -- 持仓时长（分钟）
  trade_id TEXT,                   -- 关联 sim_trades.trade_id
  validated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sv_rule ON strategy_validations(rule_id);
CREATE INDEX idx_sv_token ON strategy_validations(chain_id, contract_address);
CREATE INDEX idx_sv_result ON strategy_validations(actual_result);
```

### 9.2 Agent Service 接口定义

#### 统一接口规范

```typescript
// types/agent.ts
export interface AgentEvaluateRequest {
  chainId: string;
  contractAddress: string;
  symbol?: string;
  // 可选的预加载数据（避免重复查询）
  tokenData?: TokenRow;
  auditData?: TokenAuditRow;
  dynamicData?: TokenDynamicRow;
  issuerProfile?: IssuerProfileRow;
}

export interface AgentEvaluateResult {
  agentType: 'risk' | 'market' | 'issuer' | 'onchain' | 'decision';
  score: number;           // 0-100
  confidence: number;      // 0-1
  details: Record<string, any>;
  riskFlags: string[];     // 风险标记（红色警告）
  highlights: string[];    // 亮点标记（绿色提示）
  evaluatedAt: string;
}

export interface DecisionResult extends AgentEvaluateResult {
  agentType: 'decision';
  recommendation: 'BUY' | 'HOLD' | 'WATCH' | 'AVOID';
  subScores: {
    risk: AgentEvaluateResult;
    market: AgentEvaluateResult;
    issuer: AgentEvaluateResult;
    onchain: AgentEvaluateResult;
  };
  triggerRule?: string;    // 命中的策略规则 ID
  scenario: 'new_coin' | 'trending' | 'anomaly';
}
```

#### 各 Agent 实现要点

| Agent | 评分逻辑 | 错误处理 |
|:--|:--|:--|
| RiskAgent | risk_level=1→18, 2→10, 3→3; unusual_tax→-5; buy_tax>5%→-3 | 审计数据缺失→score=10, confidence=0.3 |
| MarketAgent | search_count≥100→13, ≥30→10, <30→5; 社交话题关联→+2 | 无社交数据→score=7, confidence=0.4 |
| IssuerAgent | 迁移率>50%→13, >20%→10, <20%→4; 总数>100→-2 | 无历史→score=7, confidence=0.2 |
| OnchainAgent | SM持仓≥10→22, ≥5→18, ≥2→14; 持仓占比>5%→+3 | 无链上数据→score=10, confidence=0.3 |
| DecisionAgent | 加权汇总: risk×0.25 + market×0.15 + issuer×0.15 + onchain×0.25 + 流动性×0.2 | 任一 Agent confidence<0.3→整体置信度降低 |

### 9.3 P0 任务技术实现细节

#### 9.3.1 同名/跨链检测算法

```typescript
// tokenService.ts 新增
export function findSimilarTokens(
  symbol: string,
  chainId: string,
  excludeAddress?: string
): {
  sameName: { chain_id: string; contract_address: string; symbol: string; first_seen_at: string }[];
  crossChain: { chain_id: string; contract_address: string; symbol: string }[];
  duplicateCount: number;
  isCrossChainProject: boolean;  // 判断是否为真实跨链项目
} {
  // 1. 精确匹配同名（忽略大小写）
  const sameName = db.prepare(`
    SELECT chain_id, contract_address, symbol, first_seen_at
    FROM tokens
    WHERE UPPER(symbol) = UPPER(?) AND (chain_id != ? OR contract_address != ?)
    ORDER BY first_seen_at ASC
  `).all(symbol, chainId, excludeAddress || '') as any[];

  // 2. 跨链检测：同名代币出现在不同链上
  const chains = new Set(sameName.map(t => t.chain_id));
  const crossChain = sameName.filter(t => t.chain_id !== chainId);

  // 3. 判断是否为真实跨链项目（规则：至少2条链有同名代币，且最早上线超过7天）
  const isCrossChain = chains.size >= 2 && sameName.length > 0
    && (Date.now() - new Date(sameName[0].first_seen_at).getTime()) > 7 * 24 * 60 * 60 * 1000;

  return {
    sameName,
    crossChain,
    duplicateCount: sameName.length,
    isCrossChainProject: isCrossChain,
  };
}
```

**判定逻辑：**
- `duplicateCount === 0` → 新币，无同名 → 通过
- `duplicateCount > 0 && isCrossChainProject` → 真实跨链项目（如 USDT）→ 通过
- `duplicateCount > 0 && !isCrossChainProject` → 疑似仿币 → 高风险标记
- 额外检查：同名代币中是否有存活超过 30 天的老币（排除常见名称如 "TEST"）

#### 9.3.2 发行方频率判断逻辑

```typescript
// tokenService.ts 新增
export function assessIssuerRisk(issuerAddress: string): {
  totalTokens: number;
  recentTokens7d: number;
  recentTokens30d: number;
  riskLevel: 'low' | 'medium' | 'high';
  riskReasons: string[];
} {
  const profile = db.prepare(
    'SELECT * FROM issuer_profiles WHERE issuer_address = ?'
  ).get(issuerAddress) as any;

  if (!profile) {
    return { totalTokens: 0, recentTokens7d: 0, recentTokens30d: 0, riskLevel: 'low', riskReasons: ['无发行方历史'] };
  }

  const recent7d = db.prepare(`
    SELECT COUNT(*) as c FROM issuer_tokens
    WHERE issuer_address = ? AND create_time > ?
  `).get(issuerAddress, Math.floor(Date.now() / 1000) - 7 * 86400) as any;

  const recent30d = db.prepare(`
    SELECT COUNT(*) as c FROM issuer_tokens
    WHERE issuer_address = ? AND create_time > ?
  `).get(issuerAddress, Math.floor(Date.now() / 1000) - 30 * 86400) as any;

  const riskReasons: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' = 'low';

  // 频率判断
  if (profile.total_tokens > 100) {
    riskLevel = 'high';
    riskReasons.push(`发行代币总数过多: ${profile.total_tokens}`);
  } else if (profile.total_tokens > 20) {
    riskLevel = 'medium';
    riskReasons.push(`发行代币数较多: ${profile.total_tokens}`);
  }

  // 近期频率（更危险）
  if (recent7d.c > 10) {
    riskLevel = 'high';
    riskReasons.push(`近7天发行${recent7d.c}个代币（批量发币）`);
  } else if (recent7d.c > 5) {
    if (riskLevel === 'low') riskLevel = 'medium';
    riskReasons.push(`近7天发行${recent7d.c}个代币`);
  }

  // 迁移率
  const migrationRate = profile.total_tokens > 0
    ? (profile.alive_tokens || 0) / profile.total_tokens : 0;
  if (migrationRate < 0.1 && profile.total_tokens > 5) {
    riskLevel = 'high';
    riskReasons.push(`迁移率极低: ${(migrationRate * 100).toFixed(1)}%`);
  }

  if (riskReasons.length === 0) riskReasons.push('无异常');

  return {
    totalTokens: profile.total_tokens,
    recentTokens7d: recent7d.c,
    recentTokens30d: recent30d.c,
    riskLevel,
    riskReasons,
  };
}
```

#### 9.3.3 地址基础分析

**已有字段直接利用（无需新增数据源）：**

| 字段 | 来源 | 风险阈值 |
|:--|:--|:--|
| holders_top10_percent | tokens 表 | ≥80% → 高度集中（庄家控盘）；≥60% → 中等集中 |
| bundles_holding_percent | tokens 表 | ≥30% → 疑似批量刷号；≥50% → 高度可疑 |
| dev_holding_percent | tokens 表 | ≥20% → 开发者持仓过高（跑路风险） |
| smart_money_holding_percent | tokens 表 | ≥10% → Smart Money 重仓（正面信号） |
| unique_trader_24h | tokens 表 | <10 → 交易活跃度极低（流动性风险） |

**评分函数：**

```typescript
export function scoreAddressRisk(token: TokenRow): {
  score: number;  // 0-25（满分25）
  riskFlags: string[];
  highlights: string[];
} {
  let score = 12;  // 基准分
  const riskFlags: string[] = [];
  const highlights: string[] = [];

  const top10 = parseFloat(token.holders_top10_percent || '0');
  const bundles = parseFloat(token.bundles_holding_percent || '0');
  const devHolding = parseFloat(token.dev_holding_percent || '0');
  const smHolding = parseFloat(token.smart_money_holding_percent || '0');
  const holders = token.holders || 0;
  const uniqueTraders = token.unique_trader_24h || 0;

  // 顶部持仓集中度
  if (top10 >= 80) { score -= 5; riskFlags.push(`前10持仓占比极高: ${top10.toFixed(1)}%`); }
  else if (top10 >= 60) { score -= 3; riskFlags.push(`前10持仓占比偏高: ${top10.toFixed(1)}%`); }
  else if (top10 < 30 && top10 > 0) { score += 3; highlights.push('持仓分布均匀'); }

  // 批量地址
  if (bundles >= 50) { score -= 6; riskFlags.push(`疑似批量刷号: ${bundles.toFixed(1)}%`); }
  else if (bundles >= 30) { score -= 4; riskFlags.push(`批量地址占比偏高: ${bundles.toFixed(1)}%`); }

  // 开发者持仓
  if (devHolding >= 20) { score -= 4; riskFlags.push(`开发者持仓过高: ${devHolding.toFixed(1)}%`); }

  // Smart Money（正面信号）
  if (smHolding >= 10) { score += 4; highlights.push(`Smart Money 重仓: ${smHolding.toFixed(1)}%`); }
  else if (smHolding >= 5) { score += 2; highlights.push(`Smart Money 关注`); }

  // 持有人数
  if (holders >= 500) { score += 2; }
  else if (holders < 50) { score -= 2; riskFlags.push(`持有人过少: ${holders}`); }

  // 交易活跃度
  if (uniqueTraders >= 50) { score += 2; }
  else if (uniqueTraders < 10) { score -= 2; riskFlags.push('交易活跃度极低'); }

  return { score: Math.max(0, Math.min(25, score)), riskFlags, highlights };
}
```

### 9.4 数据源可行性确认

| 数据需求 | 是否已有 | 来源表/字段 | 备注 |
|:--|:--|:--|:--|
| 代币基础信息 | ✅ | tokens 表 | price, holders, liquidity, market_cap |
| 同名代币检测 | ✅ | tokens.symbol 字段 | 模糊搜索即可 |
| 发行方历史 | ✅ | issuer_profiles + issuer_tokens | total_tokens, survival_rate |
| 发行方近期频率 | ✅ | issuer_tokens.create_time | 按时间窗口统计 |
| 合约审计 | ✅ | token_audit 表 | risk_level, buy_tax, sell_tax |
| Smart Money | ✅ | token_dynamic + smart_money_signals | smart_money_holders, direction |
| 持仓分布 | ✅ | tokens 表 | holders_top10_percent, bundles_holding_percent |
| 社交话题 | ✅ | social_topics 表 | topic_type, topic_tags |
| 搜索热度 | ✅ | tokens.search_count_24h | 已有 |
| 项目官网/GitHub | ⚠️ 部分 | tokens.links 字段 | JSON格式，需解析 |
| KOL 地址库 | ❌ | 无 | 需新增数据源（P2） |
| 价格时序数据 | ❌ | 无 | 老币异动场景需要（P2） |
| 链上地址聚类 | ❌ | 无 | 需第三方数据源（P3） |

### 9.5 P0 开发任务拆分

| 序号 | 任务 | 新增文件/修改 | 预估工时 |
|:--|:--|:--|:--|
| 1 | agent_scores 表初始化 | db/database.ts 新增 initAgentScoresTable() | 0.5h |
| 2 | strategy_rules 表初始化 | db/database.ts 新增 initStrategyTables() | 0.5h |
| 3 | strategy_validations 表初始化 | 同上 | 含在内 |
| 4 | findSimilarTokens() | services/tokenService.ts 新增函数 | 1h |
| 5 | assessIssuerRisk() | services/tokenService.ts 新增函数 | 1h |
| 6 | scoreAddressRisk() | services/tokenService.ts 新增函数 | 1h |
| 7 | RiskAgent 服务 | services/agents/riskAgent.ts | 2h |
| 8 | MarketAgent 服务 | services/agents/marketAgent.ts | 2h |
| 9 | IssuerAgent 服务 | services/agents/issuerAgent.ts | 1.5h |
| 10 | OnchainAgent 服务 | services/agents/onchainAgent.ts | 1.5h |
| 11 | DecisionAgent 服务 | services/agents/decisionAgent.ts | 2h |
| 12 | 轮询流程集成 | services/pollingService.ts 改造 | 1.5h |
| 13 | API 端点 | api/routes.ts 新增 /api/agents/score/:chain/:address | 1h |
| 14 | 策略规则 CRUD API | api/routes.ts 新增 /api/rules/* | 1.5h |
| **合计** | | | **约 17h（2-3天）** |

---

## 十、测试方案（测试主管补充，2026-06-04）

### 10.1 验收标准可测试性审查

| 验收标准 | 可测试性 | 问题 | 建议补充 |
|:--|:--|:--|:--|
| P0：自动检测同名代币 | ⚠️ 部分可测 | “自动”触发时机不明确——是轮询发现新币时自动跑，还是需要手动触发？ | 明确触发入口：新币 SSE 推送时自动附带同名检测结果 |
| P0：批量发币标记 | ⚠️ 部分可测 | “批量”的阈值未量化（>20 个？>50 个？） | 文档已写 >20 个→高风险，需确认阈值是否可配置 |
| P0：地址风险 | ❌ 不可测 | “地址风险”无量化标准——内幕地址占比多少算高风险？ | 补充判定规则：如 holders_top10_percent > 40% → 高集中度 |
| P1：策略验证框架 | ✅ 可测 | 有表结构、有记录逻辑 | 需补充：验证记录写入时机（模拟交易完成时？T+1？） |
| P1：记录预测结果和实际盈亏 | ⚠️ 部分可测 | “实际盈亏”的计算基准不明——是价格变化还是模拟交易 PnL？ | 明确：以模拟交易的买入价和卖出价差额为准 |
| P2：5 个 Agent 独立评分 | ✅ 可测 | 有明确接口定义 evaluate() | 需补充：各 Agent 评分范围是否统一 0-100？ |
| P2：前端展示综合结论 | ✅ 可测 | 有颜色编码规则 | 需补充：置信度的计算公式（各 Agent 一致性） |

**总结：P0 验收标准需补充 3 项量化指标，P1 需补充 1 项计算基准，P2 基本可测。**

### 10.2 P0 任务测试用例设计

#### 10.2.1 同名/跨链检测测试用例

| 编号 | 用例名 | 前置条件 | 输入 | 预期结果 | 优先级 |
|:--|:--|:--|:--|:--|:--|
| TC-SIM-001 | 精确同名同链 | DB 中已有 symbol="PEPE" chain="bsc" 的代币 | 新上线 symbol="PEPE" chain="bsc" | 返回 1 条匹配，标记“同名同链-高风险仿币” | P0 |
| TC-SIM-002 | 同名不同链 | DB 中已有 symbol="PEPE" chain="bsc" | 新上线 symbol="PEPE" chain="eth" | 返回 1 条匹配，标记“跨链-需核实” | P0 |
| TC-SIM-003 | 名称相似但不同 | DB 中有 "PEPE" | 新上线 "PEPE2.0" | 模糊搜索返回匹配，标记“名称相似-疑似蹭热度” | P0 |
| TC-SIM-004 | 全新名称无冲突 | DB 中无 "XYZABC" 相关代币 | 新上线 symbol="XYZABC" | 返回 0 条匹配，无风险标记 | P0 |
| TC-SIM-005 | 大小写不敏感 | DB 中有 "pepe" | 新上线 "PEPE" | 返回匹配，忽略大小写 | P1 |
| TC-SIM-006 | 同名多链项目（真实跨链） | DB 中 PEPE 在 bsc/eth/sol 三条链均有 | 新上线 chain="base" | 返回 3 条匹配，标记“已有跨链项目-新增链” | P1 |
| TC-SIM-007 | 空 symbol 边界 | 新代币 symbol 为空字符串 | symbol="" | 返回空结果，不报错 | P1 |
| TC-SIM-008 | 特殊字符 symbol | 新代币 symbol 含特殊字符 | symbol="PEPE🚀" | 正常处理，不崩溃 | P2 |

**验证方法：**
- 单元测试：直接调用后端同名检测函数，传入预设 DB 数据
- 集成测试：通过 API `GET /api/tokens/:chain/:address/similar` 验证返回格式
- 回归测试：每次新增代币入库后，自动触发同名检测

#### 10.2.2 发行方频率检测测试用例

| 编号 | 用例名 | 前置条件 | 输入 | 预期结果 | 优先级 |
|:--|:--|:--|:--|:--|:--|
| TC-ISS-001 | 批量发币（>20 个） | issuer 地址 X 已发行 25 个代币 | 查询 X 的风险评估 | 标记“批量发币-高风险”，score < 30 | P0 |
| TC-ISS-002 | 正常发币（<20 个） | issuer 地址 Y 已发行 5 个代币 | 查询 Y 的风险评估 | 无批量标记，score 正常计算 | P0 |
| TC-ISS-003 | 临界值 20 个 | issuer 地址 Z 已发行恰好 20 个 | 查询 Z 的风险评估 | 需确认：20 个是否触发？建议 >20 才触发 | P0 |
| TC-ISS-004 | 新发行方（0 个历史） | issuer 地址 W 无历史记录 | 查询 W 的风险评估 | 无批量标记，但标记“新发行方-无历史” | P1 |
| TC-ISS-005 | 发行频率异常（24h 内发 10 个） | issuer 地址 V 在 24h 内发行 10 个代币 | 查询 V 的风险评估 | 标记“短期高频发行-极高风险” | P0 |
| TC-ISS-006 | 长期正常发行方 | issuer 地址 U，6 个月发行 12 个代币 | 查询 U 的风险评估 | 无批量标记，score 较高 | P1 |
| TC-ISS-007 | 发行方地址不存在 | DB 中无此 issuer 地址 | 查询不存在的地址 | 返回默认评估，不报错 | P1 |

**验证方法：**
- 准备测试数据：在 issuer_profiles 表中预设不同发行方数据
- API 测试：`GET /api/issuer/:address/risk`
- 边界测试：阈值 20 附近（19/20/21）的行为一致性

#### 10.2.3 地址分析测试用例

| 编号 | 用例名 | 前置条件 | 输入 | 预期结果 | 优先级 |
|:--|:--|:--|:--|:--|:--|
| TC-ADDR-001 | 高集中度持仓 | holders_top10_percent = 85% | 查询地址分析 | 标记“持仓高度集中-高风险”，前 10 持有者占 85% | P0 |
| TC-ADDR-002 | 正常分散持仓 | holders_top10_percent = 25% | 查询地址分析 | 标记“持仓分散-低风险” | P0 |
| TC-ADDR-003 | 大量捆绑持仓 | bundles_holding_percent = 60% | 查询地址分析 | 标记“捆绑持仓严重-疑似机器人刷量” | P0 |
| TC-ADDR-004 | 无捆绑持仓 | bundles_holding_percent = 0% | 查询地址分析 | 无捆绑标记 | P0 |
| TC-ADDR-005 | 内幕地址检测 | 前 5 个买入地址在开盘 3 秒内完成 | 查询地址分析 | 标记“疑似内幕地址-开盘抢入” | P1 |
| TC-ADDR-006 | 地址数据缺失 | holders 和 bundles 字段为空 | 查询地址分析 | 返回“数据不足-无法评估”，不报错 | P1 |
| TC-ADDR-007 | 极端集中度 | holders_top10_percent = 99% | 查询地址分析 | 标记“极度集中-疑似 rug pull 风险” | P0 |

**验证方法：**
- 数据准备：在 tokens 表中预设不同 holders_top10_percent 和 bundles_holding_percent 值
- API 测试：`GET /api/tokens/:chain/:address/address-analysis`
- 风险等级校验：确认返回的风险标签与预设数据匹配

### 10.3 模拟盘验证测试策略

#### 10.3.1 模拟盘测试分层

| 层级 | 测试内容 | 方法 | 通过标准 |
|:--|:--|:--|:--|
| L1 基础功能 | 模拟买入/卖出是否正确记录 | 调用 sim API + 查询 sim_trades 表 | 交易记录字段完整、金额正确 |
| L2 策略触发 | 规则引擎触发模拟交易的条件是否正确 | 预设规则 + 模拟数据 → 验证触发 | 触发条件与规则定义一致 |
| L3 盈亏计算 | 模拟交易的盈亏计算是否准确 | 已知价格序列 → 验证 PnL | 误差 < 0.01（精度到分） |
| L4 策略演进 | 从全量验证期到筛选期的状态切换是否正确 | 模拟 200+ 代币数据 → 验证胜率统计 | 胜率计算准确、状态标签正确切换 |
| L5 端到端 | 新币上线 → 检测 → 评分 → 模拟交易 → 全链路 | 实时环境跑 24h | 无报错、交易记录可追溯 |

#### 10.3.2 模拟盘测试数据准备

**场景 A：新币上线模拟**
- 准备 50 个模拟代币数据（含同名、批量发币、高集中度等风险特征）
- 预期：30 个被过滤（高风险），20 个进入模拟买入
- 验证：过滤率、买入时机（开盘 10-15 秒内）、金额（0.01 BNB）

**场景 B：老币热门模拟**
- 准备 10 个热门代币数据（含不同类型利好）
- 预期：根据利好类型给出不同持仓建议
- 验证：利好分类准确、建议合理

**场景 C：老币异动模拟**
- 准备 5 个异常波动代币数据（暴跌 50%+、放量 10x+）
- 预期：触发异动检测，生成抄底信号
- 验证：检测灵敏度、信号及时性

#### 10.3.3 策略验证记录测试

| 编号 | 用例名 | 验证点 |
|:--|:--|:--|
| TC-STRAT-001 | 模拟交易完成 → 自动写入 strategy_validations | predicted 字段正确、validated_at 时间准确 |
| TC-STRAT-002 | 实际价格变化 → 更新 actual_result 和 pnl | T+1 或价格变化时自动更新 |
| TC-STRAT-003 | 策略胜率统计 | 100 条验证记录 → 胜率计算准确 |
| TC-STRAT-004 | 策略演进状态切换 | 胜率 > 60% → 从“全量验证期”切换到“筛选期” |
| TC-STRAT-005 | 禁用低胜率策略 | 胜率 < 30% → 自动标记为“待优化” |

### 10.4 测试环境与数据准备方案

#### 10.4.1 测试环境

| 环境 | 用途 | 配置 |
|:--|:--|:--|
| 本地开发环境 | 单元测试 + 接口测试 | 后端 3499 + SQLite 内存库 |
| 当前服务器 | 集成测试 + 端到端 | 后端 3499 + 前端 3500 + 真实 DB |
| 模拟数据环境 | 策略验证测试 | 独立 SQLite 库（test_web3_tokens.db） |

#### 10.4.2 测试数据准备

**方式一：DB Seed 脚本**
```sql
-- 插入测试用同名代币
INSERT INTO tokens (chain_id, contract_address, symbol, name, ...) VALUES
('bsc', '0xTEST1', 'PEPE', 'Pepe', ...),
('eth', '0xTEST2', 'PEPE', 'Pepe', ...),
('bsc', '0xTEST3', 'PEPE2.0', 'Pepe 2.0', ...);

-- 插入测试用发行方
INSERT INTO issuer_profiles (issuer_address, total_tokens_issued, ...) VALUES
('0xISSUER1', 25, ...),  -- 批量发币
('0xISSUER2', 5, ...),   -- 正常
('0xISSUER3', 20, ...);  -- 临界值
```

**方式二：Mock API 响应**
- 对 Binance API 返回进行 Mock，控制输入数据
- 适用于单元测试和 CI 环境

**方式三：历史数据回放**
- 从现有 web3_tokens.db 导出真实数据作为测试基线
- 适用于回归测试和性能测试

#### 10.4.3 测试执行计划

| 阶段 | 测试内容 | 执行时机 | 负责人 |
|:--|:--|:--|:--|
| P0 开发完成后 | 同名检测 + 发行方频率 + 地址分析接口测试 | 后端交付后 1 天内 | 测试主管 |
| P0 前端完成后 | 前端展示 + 交互测试 | 前端交付后 1 天内 | 测试主管 |
| P1 策略框架完成后 | 策略验证记录 + 演进逻辑测试 | 后端交付后 2 天内 | 测试主管 |
| P2 Agent 拆分完成后 | 多 Agent 评分 + 前端面板测试 | 前后端联调后 | 测试主管 |
| 每周 | 模拟盘回归测试（自动） | 每周一凌晨 | 自动化脚本 |

---

**版本记录更新：**
- v1.0 / 2026-06-04：项目牧羊人创建基础文档
- v1.0 / 2026-06-04：前端工程师补充前端技术细化（第八节）
- v1.0 / 2026-06-04：测试主管补充测试方案（第十节）
