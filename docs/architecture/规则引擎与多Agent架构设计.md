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
