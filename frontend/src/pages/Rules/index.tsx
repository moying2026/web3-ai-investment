import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Progress, Row, Col, Statistic, Spin, Empty } from 'antd';
import {
  SafetyOutlined,
  TeamOutlined,
  GlobalOutlined,
  BankOutlined,
  DollarOutlined,
  ThunderboltOutlined,
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [a, s] = await Promise.all([ruleApi.getAnalysis(), ruleApi.getSimStats()]);
        setAnalysis(a as any);
        setSimStats(s as any);
      } catch { /* 静默 */ }
      finally { setLoading(false); }
    };
    load();
  }, []);

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
      </div>
    </Spin>
  );
};

export default Rules;
