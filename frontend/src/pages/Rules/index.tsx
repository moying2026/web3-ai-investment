import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Progress, Row, Col, Statistic, Spin, Empty, Tabs, Alert, Tooltip, Button, InputNumber, Form, message } from 'antd';
import {
  SafetyOutlined,
  TeamOutlined,
  GlobalOutlined,
  BankOutlined,
  DollarOutlined,
  ThunderboltOutlined,
  QuestionCircleOutlined,
  EditOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { ruleApi } from '../../services/api';
import { formatNumber } from '../../utils/format';

interface DimensionScores {
  security: string;
  smartMoney: string;
  social: string;
  issuer: string;
  liquidity: string;
}

interface RecDist {
  recommendation: string;
  count: number;
  avg_score: number;
}

interface StrategyStat {
  strategy: string;
  trade_count: number;
  avg_score: number;
  wins: number;
}

interface ScoreBand {
  band: string;
  count: number;
}

interface AnalysisData {
  totalAnalyses: number;
  avgScore: string;
  recommendationDistribution: RecDist[];
  avgDimensionScores: DimensionScores | null;
  strategyStats: StrategyStat[];
  scoreBands: ScoreBand[];
}

interface SimStatsData {
  total: number;
  open: number;
  closed: number;
  winCount: number;
  lossCount: number;
  winRate: string;
  totalPnl: string;
  byStrategy: Array<{ strategy: string; count: number; wins: number; total_pnl: number }>;
  byChain: Array<{ chain_id: string; count: number; wins: number; total_pnl: number }>;
}

interface DecisionCriteria {
  dimensions: Array<{
    key: string;
    name: string;
    maxScore: number;
    weight: number;
    criteria: Array<{
      condition: string;
      score: number;
      description: string;
    }>;
  }>;
  decisionRules: {
    buyThreshold: number;
    holdThreshold: number;
    watchThreshold: number;
    riskDowngradeRule: string;
  };
  tradingRules: {
    buyAmountMap: Record<string, { amount: number; description: string }>;
    budget: {
      totalBudget: number;
      maxPerTrade: number;
      maxPositions: number;
      maxChainPercent: number;
    };
    stopLoss: number;
    takeProfit: number;
  };
  issuerRisk: Record<string, number>;
  addressRisk: Record<string, number>;
}

const chainMap: Record<string, string> = { '56': 'BSC', 'CT_501': 'SOL', '1': 'ETH', '8453': 'Base' };

const dimensionMeta: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  security: { label: '合约安全', icon: <SafetyOutlined />, color: '#52c41a' },
  smartMoney: { label: '聪明钱', icon: <TeamOutlined />, color: '#1890ff' },
  social: { label: '社交热度', icon: <GlobalOutlined />, color: '#faad14' },
  issuer: { label: '发行方信誉', icon: <BankOutlined />, color: '#722ed1' },
  liquidity: { label: '流动性', icon: <DollarOutlined />, color: '#13c2c2' },
};

const recLabelMap: Record<string, { text: string; color: string }> = {
  BUY: { text: '买入', color: 'green' },
  SELL: { text: '卖出', color: 'red' },
  HOLD: { text: '持有', color: 'blue' },
  WATCH: { text: '观望', color: 'default' },
  ai_score_buy: { text: 'AI 评分买入', color: 'green' },
  ai_hold: { text: 'AI 持有', color: 'blue' },
  ai_avoid: { text: 'AI 回避', color: 'red' },
};

const Rules: React.FC = () => {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [simStats, setSimStats] = useState<SimStatsData | null>(null);
  const [criteria, setCriteria] = useState<DecisionCriteria | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm] = Form.useForm();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [a, s, c, t] = await Promise.all([
          ruleApi.getAnalysis(),
          ruleApi.getSimStats(),
          ruleApi.getDecisionCriteria(),
          ruleApi.getThresholds(),
        ]);
        setAnalysis(a as any);
        setSimStats(s as any);
        setCriteria(c as any);
        setThresholds(t as any);
        // 初始化表单值
        if (t) {
          editForm.setFieldsValue(t);
        }
      } catch { /* 静默 */ }
      finally { setLoading(false); }
    };
    load();
  }, [editForm]);

  // 保存阈值配置
  const handleSave = async () => {
    try {
      const values = await editForm.validateFields();
      setSaving(true);
      await ruleApi.updateThresholds(values);
      setThresholds(values);
      setEditing(false);
      message.success('阈值配置已保存');
      // 重新加载配置
      const c = await ruleApi.getDecisionCriteria();
      setCriteria(c as any);
    } catch (err) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 取消编辑
  const handleCancel = () => {
    editForm.setFieldsValue(thresholds || {});
    setEditing(false);
  };

  // 评分维度雷达图
  const dimKeys = Object.keys(dimensionMeta);
  const radarOption = analysis?.avgDimensionScores ? {
    radar: {
      indicator: dimKeys.map(k => ({
        name: dimensionMeta[k].label,
        max: 100,
      })),
    },
    series: [{
      type: 'radar' as const,
      data: [{
        value: dimKeys.map(k => parseFloat((analysis.avgDimensionScores as any)?.[k] || '0')),
        name: 'AI 评分维度',
        areaStyle: { opacity: 0.2 },
        lineStyle: { color: '#1890ff' },
        itemStyle: { color: '#1890ff' },
      }],
    }],
  } : null;

  // 推荐分布饼图
  const pieOption = analysis?.recommendationDistribution?.length ? {
    tooltip: { trigger: 'item' as const },
    legend: { bottom: 0 },
    series: [{
      type: 'pie' as const,
      radius: ['40%', '70%'],
      data: analysis.recommendationDistribution.map(r => ({
        name: recLabelMap[r.recommendation]?.text || r.recommendation,
        value: r.count,
      })),
      label: { formatter: '{b}: {c} ({d}%)' },
    }],
  } : null;

  // 评分区间柱状图
  const scoreBandOption = analysis?.scoreBands?.length ? {
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'category' as const, data: analysis.scoreBands.map(b => b.band) },
    yAxis: { type: 'value' as const },
    series: [{
      data: analysis.scoreBands.map(b => b.count),
      type: 'bar' as const,
      itemStyle: {
        color: (params: any) => {
          const colors = ['#ff4d4f', '#faad14', '#1890ff', '#52c41a'];
          return colors[params.dataIndex] || '#1890ff';
        },
      },
    }],
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
  } : null;

  // 策略效果表格列
  const strategyColumns = [
    {
      title: '策略',
      dataIndex: 'strategy',
      key: 'strategy',
      render: (v: string) => <Tag color="blue">{v || '未指定'}</Tag>,
    },
    { title: '交易次数', dataIndex: 'trade_count', key: 'trade_count' },
    { title: '胜场', dataIndex: 'wins', key: 'wins' },
    {
      title: '胜率',
      key: 'winRate',
      render: (_: any, record: any) => {
        const count = record.trade_count ?? record.count ?? 0;
        const wins = record.wins ?? 0;
        const rate = count > 0 ? (wins / count * 100) : 0;
        return <Progress percent={parseFloat(rate.toFixed(1))} size="small" status={rate >= 50 ? 'success' : 'exception'} />;
      },
    },
    {
      title: '累计盈亏',
      dataIndex: 'total_pnl',
      key: 'total_pnl',
      render: (v: number) => {
        const num = v ?? 0;
        return <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>{formatNumber(num, { prefix: '$', decimals: 2 })}</span>;
      },
    },
  ];

  // 链分布表格列
  const chainColumns = [
    {
      title: '链',
      dataIndex: 'chain_id',
      key: 'chain_id',
      render: (v: string) => <Tag>{chainMap[v] || v}</Tag>,
    },
    { title: '交易次数', dataIndex: 'count', key: 'count' },
    { title: '胜场', dataIndex: 'wins', key: 'wins' },
    {
      title: '胜率',
      key: 'winRate',
      render: (_: any, record: any) => {
        const rate = record.count > 0 ? (record.wins / record.count * 100) : 0;
        return <Progress percent={parseFloat(rate.toFixed(1))} size="small" status={rate >= 50 ? 'success' : 'exception'} />;
      },
    },
    {
      title: '累计盈亏',
      dataIndex: 'total_pnl',
      key: 'total_pnl',
      render: (v: number) => {
        const num = v ?? 0;
        return <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>{formatNumber(num, { prefix: '$', decimals: 2 })}</span>;
      },
    },
  ];

  // 推荐分布表格列
  const recColumns = [
    {
      title: '推荐类型',
      dataIndex: 'recommendation',
      key: 'recommendation',
      render: (v: string) => {
        const meta = recLabelMap[v] || { text: v, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    { title: '触发次数', dataIndex: 'count', key: 'count' },
    {
      title: '平均评分',
      dataIndex: 'avg_score',
      key: 'avg_score',
      render: (v: number) => <span style={{ fontWeight: 'bold' }}>{parseFloat(String(v)).toFixed(1)}</span>,
    },
  ];

  return (
    <Spin spinning={loading}>
      <div>
        {/* 顶部概览 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card>
              <Statistic title="AI 分析总数" value={analysis?.totalAnalyses ?? '-'} prefix={<ThunderboltOutlined />} />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic title="平均评分" value={analysis?.avgScore ?? '-'} prefix={<SafetyOutlined />}
                valueStyle={{ color: parseFloat(analysis?.avgScore || '0') >= 60 ? '#3f8600' : '#cf1322' }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic title="模拟盘交易" value={simStats?.total ?? '-'}
                suffix={simStats ? `(胜率 ${simStats.winRate})` : undefined} />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic title="累计盈亏" value={simStats ? parseFloat(simStats.totalPnl) : 0} precision={2} prefix="$"
                valueStyle={{ color: parseFloat(simStats?.totalPnl || '0') >= 0 ? '#3f8600' : '#cf1322' }} />
            </Card>
          </Col>
        </Row>

        {/* 评分维度 + 推荐分布 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={12}>
            <Card title="📊 AI 评分维度" size="small">
              {radarOption ? (
                <ReactECharts option={radarOption} style={{ height: 300 }} />
              ) : (
                <Empty description="暂无评分数据" />
              )}
              {analysis?.avgDimensionScores && (
                <Row gutter={8} style={{ marginTop: 8 }}>
                  {dimKeys.map(k => (
                    <Col span={4} key={k} style={{ textAlign: 'center' }}>
                      <div style={{ color: dimensionMeta[k].color, fontSize: 20 }}>{dimensionMeta[k].icon}</div>
                      <div style={{ fontSize: 12, color: '#8c8c8c' }}>{dimensionMeta[k].label}</div>
                      <div style={{ fontSize: 16, fontWeight: 'bold' }}>{parseFloat((analysis.avgDimensionScores as any)?.[k] || '0').toFixed(1)}</div>
                    </Col>
                  ))}
                </Row>
              )}
            </Card>
          </Col>
          <Col span={12}>
            <Card title="🎯 推荐分布" size="small">
              {pieOption ? (
                <ReactECharts option={pieOption} style={{ height: 300 }} />
              ) : (
                <Empty description="暂无推荐数据" />
              )}
            </Card>
          </Col>
        </Row>

        {/* 评分区间分布 */}
        {analysis?.scoreBands?.length ? (
          <Card title="📈 评分区间分布" size="small" style={{ marginBottom: 24 }}>
            <Row gutter={16}>
              <Col span={16}>
                <ReactECharts option={scoreBandOption!} style={{ height: 250 }} />
              </Col>
              <Col span={8}>
                <Table
                  dataSource={analysis.scoreBands}
                  rowKey="band"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '评分区间', dataIndex: 'band', key: 'band', render: (v: string) => <Tag>{v}</Tag> },
                    { title: '交易数量', dataIndex: 'count', key: 'count' },
                  ]}
                />
              </Col>
            </Row>
          </Card>
        ) : null}

        {/* 推荐触发统计 */}
        {analysis?.recommendationDistribution?.length ? (
          <Card title="📋 推荐触发统计" size="small" style={{ marginBottom: 24 }}>
            <Table
              dataSource={analysis.recommendationDistribution}
              columns={recColumns}
              rowKey="recommendation"
              size="small"
              pagination={false}
            />
          </Card>
        ) : null}

        {/* 策略效果 + 链分布 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={12}>
            <Card title="🧠 策略效果" size="small">
              {(analysis?.strategyStats?.length || simStats?.byStrategy?.length) ? (
                <Table
                  dataSource={analysis?.strategyStats?.length ? analysis.strategyStats : simStats?.byStrategy}
                  columns={strategyColumns}
                  rowKey={(r: any) => r.strategy || 'default'}
                  size="small"
                  pagination={false}
                />
              ) : (
                <Empty description="暂无策略数据" />
              )}
            </Card>
          </Col>
          <Col span={12}>
            <Card title="🔗 链分布" size="small">
              {simStats?.byChain?.length ? (
                <Table
                  dataSource={simStats.byChain}
                  columns={chainColumns}
                  rowKey="chain_id"
                  size="small"
                  pagination={false}
                />
              ) : (
                <Empty description="暂无链分布数据" />
              )}
            </Card>
          </Col>
        </Row>

        {/* AI 决策标准 */}
        {criteria && (
          <Card 
            title="🤖 AI 决策标准" 
            style={{ marginBottom: 24 }}
            extra={
              editing ? (
                <span>
                  <Button 
                    type="primary" 
                    icon={<SaveOutlined />} 
                    onClick={handleSave}
                    loading={saving}
                    style={{ marginRight: 8 }}
                  >
                    保存
                  </Button>
                  <Button icon={<UndoOutlined />} onClick={handleCancel}>
                    取消
                  </Button>
                </span>
              ) : (
                <Button type="primary" ghost icon={<EditOutlined />} onClick={() => setEditing(true)}>
                  编辑配置
                </Button>
              )
            }
          >
            <Alert
              message="以下为 AI 评分系统实际使用的决策标准和阈值，点击编辑配置可修改"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            
            <Form form={editForm} layout="vertical">
              <Tabs items={[
                {
                  key: 'dimensions',
                  label: '评分维度',
                  children: (
                    <Table
                      dataSource={criteria.dimensions}
                      rowKey="key"
                      size="small"
                      pagination={false}
                      columns={[
                        {
                          title: '维度',
                          dataIndex: 'name',
                          key: 'name',
                          render: (v: string, r: any) => (
                            <span>
                              {v}
                              <Tooltip title={`权重: ${(r.weight * 100).toFixed(0)}%`}>
                                <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                              </Tooltip>
                            </span>
                          ),
                        },
                        { title: '满分', dataIndex: 'maxScore', key: 'maxScore', width: 80 },
                        {
                          title: '权重',
                          dataIndex: 'weight',
                          key: 'weight',
                          width: 120,
                          render: (_: number, r: any) => {
                            const key = `dimension_weight_${r.key}`;
                            return editing ? (
                              <Form.Item name={key} noStyle>
                                <InputNumber min={0} max={1} step={0.05} style={{ width: 80 }} />
                              </Form.Item>
                            ) : (
                              `${(r.weight * 100).toFixed(0)}%`
                            );
                          },
                        },
                        {
                          title: '评分规则',
                          dataIndex: 'criteria',
                          key: 'criteria',
                          render: (items: Array<{ condition: string; score: number; description: string }>) => (
                            <div style={{ fontSize: 12 }}>
                              {items.map((item, i) => (
                                <div key={i} style={{ marginBottom: 4 }}>
                                  <Tag color={item.score > 0 ? 'green' : item.score < 0 ? 'red' : 'default'}>
                                    {item.score > 0 ? '+' : ''}{item.score}
                                  </Tag>
                                  {item.condition}
                                  <span style={{ color: '#999' }}> — {item.description}</span>
                                </div>
                              ))}
                            </div>
                          ),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: 'thresholds',
                  label: '决策阈值',
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Card title="综合评分阈值" size="small" type="inner">
                          <Form form={editForm} layout="vertical">
                            <Row gutter={16}>
                              <Col span={8}>
                                <Form.Item label="BUY 阈值" name="buy_threshold">
                                  <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item label="HOLD 阈值" name="hold_threshold">
                                  <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item label="WATCH 阈值" name="watch_threshold">
                                  <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                            </Row>
                          </Form>
                          <Table
                            dataSource={[
                              { score: `≥${thresholds?.buy_threshold || criteria.decisionRules.buyThreshold}`, rec: 'BUY', desc: '建议买入', color: 'green' },
                              { score: `≥${thresholds?.hold_threshold || criteria.decisionRules.holdThreshold}`, rec: 'HOLD', desc: '建议持有', color: 'blue' },
                              { score: `≥${thresholds?.watch_threshold || criteria.decisionRules.watchThreshold}`, rec: 'WATCH', desc: '建议观望', color: 'orange' },
                              { score: `<${thresholds?.watch_threshold || criteria.decisionRules.watchThreshold}`, rec: 'AVOID', desc: '建议回避', color: 'red' },
                            ]}
                            rowKey="rec"
                            size="small"
                            pagination={false}
                            columns={[
                              { title: '分数区间', dataIndex: 'score', key: 'score' },
                              { title: '建议', dataIndex: 'rec', key: 'rec', render: (v: string, r: any) => <Tag color={r.color}>{v}</Tag> },
                              { title: '说明', dataIndex: 'desc', key: 'desc' },
                            ]}
                          />
                          <Alert
                            message={criteria.decisionRules.riskDowngradeRule}
                            type="warning"
                            style={{ marginTop: 8 }}
                          />
                        </Card>
                      </Col>
                      <Col span={12}>
                        <Card title="交易金额配置" size="small" type="inner">
                          <Form form={editForm} layout="vertical">
                            <Row gutter={16}>
                              <Col span={8}>
                                <Form.Item label="BUY 金额" name="buy_amount_buy">
                                  <InputNumber min={1} max={10000} style={{ width: '100%' }} prefix="$" />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item label="HOLD 金额" name="buy_amount_hold">
                                  <InputNumber min={1} max={10000} style={{ width: '100%' }} prefix="$" />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item label="AVOID 金额" name="buy_amount_avoid">
                                  <InputNumber min={0} max={10000} style={{ width: '100%' }} prefix="$" />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Row gutter={16}>
                              <Col span={12}>
                                <Form.Item label="总预算" name="total_budget">
                                  <InputNumber min={1000} max={1000000} style={{ width: '100%' }} prefix="$" />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item label="单笔上限" name="max_per_trade">
                                  <InputNumber min={1} max={10000} style={{ width: '100%' }} prefix="$" />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Row gutter={16}>
                              <Col span={12}>
                                <Form.Item label="最大持仓数" name="max_positions">
                                  <InputNumber min={1} max={10000} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item label="单链上限(%)" name="max_chain_pct">
                                  <InputNumber min={1} max={100} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Row gutter={16}>
                              <Col span={12}>
                                <Form.Item label="止损(%)" name="stop_loss_percent">
                                  <InputNumber min={-90} max={0} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item label="止盈(%)" name="take_profit_percent">
                                  <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                            </Row>
                          </Form>
                        </Card>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'risks',
                  label: '风险阈值',
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Card title="发行方风险" size="small" type="inner">
                          <Table
                            dataSource={[
                              { rule: '发行代币总数', high: `>${criteria.issuerRisk.totalTokensHigh}`, medium: `>${criteria.issuerRisk.totalTokensMedium}`, desc: '批量发币风险' },
                              { rule: '近7天发行', high: `>${criteria.issuerRisk.recent7dHigh}`, medium: `>${criteria.issuerRisk.recent7dMedium}`, desc: '短期大量发币' },
                              { rule: '迁移率', high: `<${(criteria.issuerRisk.migrationRateLow * 100).toFixed(0)}%`, medium: `<${(criteria.issuerRisk.migrationRateMedium * 100).toFixed(0)}%`, desc: '项目方跑路风险' },
                            ]}
                            rowKey="rule"
                            size="small"
                            pagination={false}
                            columns={[
                              { title: '规则', dataIndex: 'rule', key: 'rule' },
                              { title: '高风险', dataIndex: 'high', key: 'high', render: (v: string) => <Tag color="red">{v}</Tag> },
                              { title: '中风险', dataIndex: 'medium', key: 'medium', render: (v: string) => <Tag color="orange">{v}</Tag> },
                              { title: '说明', dataIndex: 'desc', key: 'desc' },
                            ]}
                          />
                        </Card>
                      </Col>
                      <Col span={12}>
                        <Card title="地址风险" size="small" type="inner">
                          <Table
                            dataSource={[
                              { rule: '前10持仓占比', high: `≥${criteria.addressRisk.top10PercentHigh}%`, medium: `≥${criteria.addressRisk.top10PercentMedium}%`, desc: '持仓集中度' },
                              { rule: '批量地址占比', high: `≥${criteria.addressRisk.bundlesHigh}%`, medium: `≥${criteria.addressRisk.bundlesMedium}%`, desc: '刷量嫌疑' },
                              { rule: '开发者持仓', high: `≥${criteria.addressRisk.devHoldingHigh}%`, medium: '-', desc: '跑路风险' },
                              { rule: '持有人数量', high: `<${criteria.addressRisk.holdersLow}`, medium: '-', desc: '活跃度过低' },
                            ]}
                            rowKey="rule"
                            size="small"
                            pagination={false}
                            columns={[
                              { title: '规则', dataIndex: 'rule', key: 'rule' },
                              { title: '高风险', dataIndex: 'high', key: 'high', render: (v: string) => <Tag color="red">{v}</Tag> },
                              { title: '中风险', dataIndex: 'medium', key: 'medium', render: (v: string) => v !== '-' ? <Tag color="orange">{v}</Tag> : '-' },
                              { title: '说明', dataIndex: 'desc', key: 'desc' },
                            ]}
                          />
                        </Card>
                      </Col>
                    </Row>
                  ),
                },
              ]} />
            </Form>
          </Card>
        )}
      </div>
    </Spin>
  );
};

export default Rules;
