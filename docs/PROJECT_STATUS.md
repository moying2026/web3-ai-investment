# Web3 AI 投资决策系统 — 项目状态

> 版本：v0.1.0
> 日期：2026-06-03
> 更新人：项目牧羊人

---

## 一、项目概述

**目标**：让 AI 团队自负盈亏，通过 Web3 一级市场新币首发实现盈利。
**技术栈**：Node.js + SQLite（后端） / React + Ant Design + ECharts（前端）
**端口**：后端 3002 / 前端 3500

---

## 二、开发进度

### 已完成

| 阶段 | 任务 | 状态 | 负责人 |
|:--|:--|:--|:--|
| 规划 | 项目规划文档 v2.1 | ✅ | 项目牧羊人 |
| 规划 | 数据结构设计 9 张表 | ✅ | 项目牧羊人 |
| 规划 | 前端交互设计 6 个页面 | ✅ | 项目牧羊人 |
| 阶段一 | Binance API 数据采集（3秒轮询） | ✅ | 后端架构师 |
| 阶段一 | SQLite 数据库 + 表结构 | ✅ | 后端架构师 |
| 阶段一 | 新币检测 + 生命周期快照 | ✅ | 后端架构师 |
| 阶段一 | 链上数据采集（CoinGecko + RPC） | ✅ | 后端架构师 |
| 阶段一 | 发行方历史代币 API 对接 | ✅ | 后端架构师 |
| 阶段一 | 迁移状态数据采集 | ✅ | 后端架构师 |
| 阶段一 | Express API 服务（端口 3499） | ✅ | 后端架构师 |
| 阶段一 | SSE 新币推送 | ✅ | 后端架构师 |
| 阶段一 | 前端项目骨架（Vite + React + TS） | ✅ | 前端工程师 |
| 阶段一 | Dashboard 页面（真实数据） | ✅ | 前端工程师 |
| 阶段一 | 代币详情页骨架 | ✅ | 前端工程师 |
| 阶段一 | 交易页骨架 | ✅ | 前端工程师 |
| 阶段一 | 模拟盘/规则引擎/发行方画像骨架 | ✅ | 前端工程师 |
| 阶段一 | 筛选+排序功能 | ✅ | 前端工程师 |
| 阶段一 | 迁移状态展示 | ✅ | 前端工程师 |
| 阶段一 | K 线图骨架（ECharts） | ✅ | 前端工程师 |
| 阶段一 | 发行方画像展示 | ✅ | 前端工程师 |

### 进行中

| 任务 | 状态 | 负责人 | 说明 |
|:--|:--|:--|:--|
| 代币详情页空白修复 | 🔧 | 前端工程师 | 运行时 bug，页面无法渲染 |
| 发行方画像加载失败修复 | 🔧 | 前端工程师 | API 返回异常 |
| 后端端口改为 3002 | 🔧 | 后端架构师 | 避免和桌面自动化工作台 3001 冲突 |
| K 线真实数据存储 | ⏳ | 后端架构师 | Binance chart 字段未存储 |
| 模拟盘系统 | ⏳ | 后端架构师 | sim_trades 表 + CRUD API |

### 待开始

| 任务 | 依赖 | 说明 |
|:--|:--|:--|
| 阶段二：规则从数据中总结 | 数据积累 2-4 周 | 需 200+ 代币样本 |
| 阶段三：规则引擎 + 模拟盘 | 阶段二完成 | 规则成型后编码 |
| 阶段四：AI 博弈决策 | 准确率达标 | 多 Agent 辩论 |
| 阶段五：实盘交易 | 陈哥批准 | 接入交易所 API |

---

## 三、页面数据对接状态

| 页面 | 状态 | 真实数据 | Mock 数据 |
|:--|:--|:--|:--|
| Dashboard | ✅ 全部真实 | 统计、代币表格、筛选、排序、SSE | — |
| 代币详情 | ❌ 有 bug | 基础数据、快照、标签、发行方 | K 线图 mock |
| 交易 | 🟡 部分真实 | 手动下单查询 | AI 推荐、持仓、历史 |
| 模拟盘 | 🔴 全部 Mock | — | 统计、收益曲线、交易记录 |
| 规则引擎 | 🔴 全部 Mock | — | 规则列表 |
| 发行方画像 | ❌ 有 bug | API 已对接 | 加载失败 |

---

## 四、技术架构

```
前端（端口 3500）          后端（端口 3499）
React + Ant Design    →    Express + TypeScript
ECharts               →    SQLite (web3_tokens.db)
SSE (new-tokens)      →    Binance API (3秒轮询)
                      →    CoinGecko + RPC (链上数据)
                      →    发行方历史 API
```

**数据源**：
- 主数据：Binance Web3 API（82 字段/代币，公开，无需 key）
- 链上数据：CoinGecko + BSC/Base/ETH RPC（公开，无需 key）
- 发行方历史：Binance dev/created/tokens/info API（公开，无需 key）

---

## 五、文件结构

```
项目_Web3投资决策系统/
├── backend/
│   ├── src/
│   │   ├── api/routes.ts          # API 路由
│   │   ├── db/database.ts         # SQLite 初始化
│   │   ├── services/
│   │   │   ├── binanceApi.ts      # Binance API 调用
│   │   │   ├── tokenService.ts    # 代币查询服务
│   │   │   ├── pollingService.ts  # 定时轮询（3秒）
│   │   │   ├── onchainService.ts  # 链上数据采集
│   │   │   ├── issuerService.ts   # 发行方历史
│   │   │   ├── supplyService.ts   # 供应量数据
│   │   │   └── ...
│   │   └── index.ts               # 入口
│   ├── data/web3_tokens.db        # SQLite 数据库
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard/         # 实时监控
│   │   │   ├── TokenDetail/       # 代币详情
│   │   │   ├── Trading/           # 交易
│   │   │   ├── SimStats/          # 模拟盘
│   │   │   ├── Rules/             # 规则引擎
│   │   │   └── IssuerProfile/     # 发行方画像
│   │   ├── components/
│   │   ├── services/api.ts
│   │   ├── hooks/
│   │   └── types/
│   └── package.json
└── docs/
    └── (规划文档在桌面自动化工作台项目的 docs/planning/ 下)
```

---

## 六、端口分配

| 服务 | 端口 | 说明 |
|:--|:--|:--|
| Web3 前端 | 3500 | Vite dev server |
| Web3 后端 | 3002 | Express API |
| 桌面自动化工作台 | 9223 | HAS Agent Server |
| 桌面自动化 relayServer | 3001 | WebChat 中转 |

---

## 七、已知问题

1. 代币详情页空白（运行时 bug）
2. 发行方画像加载失败（API 异常）
3. K 线数据字段未存储（chart_1m/5m/1h/4h/24h 为 NULL）
4. 模拟盘功能未实现（无 sim_trades 表）
5. 刷新链上数据接口返回空

---

## 八、下一步

1. 修复代币详情页空白 + 发行方画像加载失败
2. 后端端口改为 3002
3. 存储 K 线数据，前端展示真实 K 线
4. 实现模拟盘系统
5. 数据积累 2-4 周后启动阶段二（规则总结）
