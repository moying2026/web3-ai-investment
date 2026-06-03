import React from 'react';
import { Row, Col, Card, Statistic, Table, Tag } from 'antd';
import { TrophyOutlined, PercentageOutlined, ClockCircleOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { mockSimStats, mockTrades } from '../../mock/data';

const SimStats: React.FC = () => {
  const chartOption = {
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'category' as const, data: mockSimStats.dailyPnl.map((d: { date: string; pnl: number }) => d.date) },
    yAxis: { type: 'value' as const },
    series: [{
      data: mockSimStats.dailyPnl.map((d: { date: string; pnl: number }) => d.pnl),
      type: 'bar',
      itemStyle: {
        color: (params: any) => params.value >= 0 ? '#52c41a' : '#ff4d4f',
      },
    }],
  };

  const columns = [
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
    { title: '代币', dataIndex: 'symbol', key: 'symbol' },
    { title: '方向', dataIndex: 'side', key: 'side', render: (v: string) => <Tag color={v === 'buy' ? 'green' : 'red'}>{v === 'buy' ? '买入' : '卖出'}</Tag> },
    { title: '价格', dataIndex: 'price', key: 'price', render: (v: number) => `$${v.toFixed(6)}` },
    { title: '盈亏', dataIndex: 'pnl', key: 'pnl', render: (v?: number) => v !== undefined ? (
      <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</span>
    ) : '-' },
    { title: '模式', dataIndex: 'mode', key: 'mode', render: (v: string) => <Tag>{v === 'ai' ? 'AI' : '手动'}</Tag> },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card><Statistic title="总交易次数" value={mockSimStats.totalTrades} prefix={<TrophyOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="胜率" value={mockSimStats.winRate} suffix="%" prefix={<PercentageOutlined />} valueStyle={{ color: '#3f8600' }} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="累计盈亏" value={mockSimStats.totalPnl} prefix="$" valueStyle={{ color: mockSimStats.totalPnl >= 0 ? '#3f8600' : '#cf1322' }} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="平均持仓" value={mockSimStats.avgHoldTime} prefix={<ClockCircleOutlined />} /></Card>
        </Col>
      </Row>

      <Card title="📊 每日盈亏" style={{ marginBottom: 16 }}>
        <ReactECharts option={chartOption} style={{ height: 300 }} />
      </Card>

      <Card title="📋 交易历史">
        <Table dataSource={mockTrades} columns={columns} rowKey="id" pagination={{ pageSize: 10 }} />
      </Card>
    </div>
  );
};

export default SimStats;
