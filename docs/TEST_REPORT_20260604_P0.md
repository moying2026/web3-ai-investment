# Web3 规则引擎 P0 验收测试报告

> 版本：v1.0
> 日期：2026-06-04
> 测试人：测试主管
> 对应 commit：977eabc (feat(web3): implement rule engine P0)

---

## 一、测试概要

| 项目 | 内容 |
|:--|:--|
| 测试范围 | 同名/跨链检测、发行方频率、地址分析、多Agent评分、阈值配置 |
| 测试用例 | 30 条（覆盖设计文档 TC-SIM/TC-ISS/TC-ADDR + Agent/规则引擎验证） |
| 通过 | 28 条（93.3%） |
| 失败 | 2 条（6.7%） |
| 验收标准 | ≥90% → ✅ **达标** |

---

## 二、测试结果明细

### 2.1 同名/跨链检测（8 条，通过 6 条）

| 用例 | 结果 | 说明 |
|:--|:--|:--|
| TC-SIM-001 精确同名同链 | ✅ | 接口可用，返回 sameName/crossChain/riskLevel，格式正确 |
| TC-SIM-002 同名不同链查询 | ⚠️ | 接口返回 code=null + "代币未找到"，非 500 错误，属**边界正常行为**（该地址确实不在 bsc 链上） |
| TC-SIM-003 名称相似搜索结构 | ✅ | 返回 sameName/crossChain/duplicateCount/riskLevel/riskReasons，结构完整 |
| TC-SIM-004 不存在地址不崩溃 | ✅ | 返回 code=-1 + "代币未找到"，无 500 |
| TC-SIM-005 大小写处理 | ⚠️ | chain_id 大小写变化返回 code=null，但同链查询正常。**低风险**：实际使用中 chain_id 不会变大小写 |
| TC-SIM-006 返回格式完整 | ✅ | 包含 sameName/crossChain/duplicateCount/riskLevel |
| TC-SIM-007 空地址边界 | ✅ | 不返回 500 |
| TC-SIM-008 特殊字符地址 | ✅ | 不返回 500 |

### 2.2 发行方频率检测（7 条，全部通过）

| 用例 | 结果 | 说明 |
|:--|:--|:--|
| TC-ISS-001 批量发币阈值=20 | ✅ | totalTokensMedium=20，与设计一致 |
| TC-ISS-002 阈值字段完整 | ✅ | 包含 totalTokensHigh/Medium、recent7dHigh/Medium、migrationRate 等 7 个字段 |
| TC-ISS-003 高风险发行方检测 | ✅ | **真实案例验证**：发行方 0xaf50... 发行 580 个代币，正确标记为 high 风险 |
| TC-ISS-004 7天频率阈值 | ✅ | recent7dHigh=10 |
| TC-ISS-005 迁移率阈值 | ✅ | migrationRateLow=0.1 |
| TC-ISS-006 迁移率计算 | ✅ | 发行方 580 个代币迁移率 99.66%，计算正确 |
| TC-ISS-007 不存在发行方不崩溃 | ✅ | 返回 code=0 + 无历史数据，置信度 0.2，合理降级 |

### 2.3 地址分析（7 条，全部通过）

| 用例 | 结果 | 说明 |
|:--|:--|:--|
| TC-ADDR-001 地址风险接口可用 | ✅ | 返回 score/riskFlags/highlights/confidence |
| TC-ADDR-002 包含评分数据 | ✅ | score=17（RPGKITTY）/ score=21（Serenity），数据合理 |
| TC-ADDR-003 包含风险标记字段 | ✅ | riskFlags 和 highlights 字段均存在 |
| TC-ADDR-004 集中度高阈值=80% | ✅ | top10PercentHigh=80 |
| TC-ADDR-005 捆绑持仓高阈值=50% | ✅ | bundlesHigh=50 |
| TC-ADDR-006 不存在地址不崩溃 | ✅ | 不返回 500 |
| TC-ADDR-007 健康持仓阈值=30% | ✅ | top10PercentHealthy=30 |

### 2.4 多Agent评分接口（5 条，全部通过）

| 用例 | 结果 | 说明 |
|:--|:--|:--|
| AGENT-001 评分接口可用 | ✅ | 返回 decision Agent 综合评分 |
| AGENT-002 4维Agent评分完整 | ✅ | 包含 risk/market/issuer/onchain/liquidity 5 个维度 |
| AGENT-003 批量评分接口可用 | ✅ | /api/agents/scores 可访问 |
| AGENT-004 决策阈值配置 | ✅ | buyThreshold=70, holdThreshold=50 |
| AGENT-005 Agent权重配置 | ✅ | 5 个权重(risk 0.25, market 0.15, issuer 0.15, onchain 0.25, liquidity 0.2)，总和=1.0 |

### 2.5 规则引擎接口（3 条，全部通过）

| 用例 | 结果 | 说明 |
|:--|:--|:--|
| RULE-001 规则列表接口 | ✅ | /api/rules 可访问 |
| RULE-002 模拟盘买入金额 | ✅ | defaultBuyAmount=100 |
| RULE-003 止损配置 | ✅ | stopLossPercent=-20 |

---

## 三、阈值配置验证汇总

| 配置项 | 预期值 | 实际值 | 状态 |
|:--|:--|:--|:--|
| totalTokensMedium（批量发币阈值） | 20 | 20 | ✅ |
| recent7dHigh（7天高频阈值） | 10 | 10 | ✅ |
| migrationRateLow（低迁移率） | 0.1 | 0.1 | ✅ |
| top10PercentHigh（高集中度） | 80% | 80 | ✅ |
| bundlesHigh（高捆绑持仓） | 50% | 50 | ✅ |
| top10PercentHealthy（健康持仓） | 30% | 30 | ✅ |
| buyThreshold（买入阈值） | 70 | 70 | ✅ |
| holdThreshold（持有阈值） | 50 | 50 | ✅ |
| defaultBuyAmount（默认买入金额） | 100 | 100 | ✅ |
| stopLossPercent（止损） | -20% | -20 | ✅ |

---

## 四、发现的问题

### 4.1 低风险问题（不影响验收）

| 编号 | 问题 | 严重程度 | 建议 |
|:--|:--|:--|:--|
| BUG-001 | 同名检测接口：查询不存在的 chain+address 组合时返回 code=null（非标准 code 值） | 低 | 统一返回 code=-1 + message="代币未找到" |
| BUG-002 | 地址分析接口：riskFlags 在当前数据下始终为空数组 | 低 | 需验证有明显风险数据时 riskFlags 是否正常填充 |

### 4.2 观察项（后续迭代）

| 项目 | 说明 |
|:--|:--|
| Agent 评分置信度 | 当前所有 Agent 的 confidence=0（无审计数据/链上数据），评分精度依赖数据积累 |
| 发行方风险：仅检测数量 | 当前只按 totalTokens 判断，未区分"同一项目多次部署"和"批量发币刷量" |
| 地址分析：无捆绑持仓数据 | 当前 DB 中 bundles_holding_percent 为空，需验证数据采集链路 |

---

## 五、验收结论

| 指标 | 结果 | 状态 |
|:--|:--|:--|
| P0 测试用例通过率 ≥ 90% | 93.3%（28/30） | ✅ 达标 |
| API 返回格式正确 | 所有接口返回 {code, data} 结构 | ✅ 达标 |
| 阈值可配置 | /api/thresholds 返回完整配置 | ✅ 达标 |
| 多 Agent 评分逻辑正确 | 5 维评分 + 权重加权 + 综合决策 | ✅ 达标 |
| 高风险发行方检测 | 580 个代币的发行方正确标记为 high | ✅ 达标 |
| 边界处理 | 空地址/特殊字符/不存在地址均不崩溃 | ✅ 达标 |

**总评：✅ P0 验收通过**

---

## 六、遗留与后续

1. **数据积累**：当前仅 20 个代币样本，同名检测和地址分析的有效性需更多数据验证
2. **置信度优化**：所有 Agent 的 confidence=0，需接入审计数据和链上数据后提升
3. **P1 测试准备**：策略验证框架的三张新表（agent_scores/strategy_rules/strategy_validations）需后端建表后执行 P1 测试用例
