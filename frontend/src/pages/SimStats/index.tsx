import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Spin, message } from 'antd';
import { TrophyOutlined, PercentageOutlined, ClockCircleOutlined, FireOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { simApi } from '../../services/api';
import { formatPrice, formatNumber } from '../../utils/format';

interface SimStatsData {
  total: number;
  open: number;
  closed: number;
  winCount: number;
  lossCount: number;
  winRate: string;
  totalPnl: string;
  avgHoldingMinutes: number;
  maxDrawdown: string;
  portfolio: {
    totalValue: string;
    availableBalance: string;
    lockedBalance: string;
  };
  byStrategy: Array<{ strategy: string; count: number; wins: number; total_pnl: number }>;
  byChain: Array<{ chain_id: string; count: number; wins: number; total_pnl: number }>;
}

interface SimTrade {
  trade_id: string;
  trade_type: string;
  strategy: string | null;
  chain_id: string;
  contract_address: string;
  symbol: string | null;
  side: string;
  entry_price: string;
  entry_amount: string | null;
  entry_quantity: string | null;
  exit_price: string | null;
  exit_amount: string | null;
  pnl: string | null;
  pnl_percent: string | null;
  holding_duration_minutes: number | null;
  status: string;
  entry_time: string;
  exit_time: string | null;
  exit_reason: string | null;
  trigger_reason: string | null;
}

const SimStatsPage: React.FC = () => {
  const [stats, setStats] = useState<SimStatsData | null>(null);
  const [trades, setTrades] = useState<SimTrade[]>([]);
  const [tradesTotal, setTradesTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await simApi.getStats();
      setStats(data as any);
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrades = useCallback(async (p = 1, ps = 20) => {
    setTradesLoading(true);
    try {
      const res = await simApi.getTrades({ page: p, pageSize: ps });
      const data = res as any;
      setTrades(data?.data || []);
      setTradesTotal(data?.total || 0);
      setPage(p);
      setPageSize(ps);
    } catch {
      message.error('加载交易记录失败');
    } finally {
      setTradesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadTrades();
  }, []);

  // 每日盈亏：从已平仓交易按日期聚合
  const dailyPnl = React.useMemo(() => {
    if (!trades.length) return { dates: [], values: [] };
    const map = new Map<string, number>();
    for (const t of trades) {
      if (t.status !== 'CLOSED' || !t.pnl || !t.exit_time) continue;
      const dateStr = new Date(t.exit_time).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
      map.set(dateStr, (map.get(dateStr) || 0) + parseFloat(t.pnl));
    }
    const sorted = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      dates: sorted.map(d => d[0]),
      values: sorted.map(d => parseFloat(d[1].toFixed(2))),
    };
  }, [trades]);

  const chartOption = {
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'category' as const, data: dailyPnl.dates },
    yAxis: { type: 'value' as const },
    series: [{
      data: dailyPnl.values,
      type: 'bar',
      itemStyle: {
        color: (params: any) => params.value >= 0 ? '#52c41a' : '#ff4d4f',
      },
    }],
  };

  // 统计卡片
  const winRateNum = stats ? parseFloat(stats.winRate) : 0;
  const totalPnlNum = stats ? parseFloat(stats.totalPnl) : 0;

  // 交易历史列
  const columns = [
    {
      title: '时间',
      dataIndex: 'entry_time',
      key: 'entry_time',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: '代币',
      key: 'symbol',
      width: 100,
      render: (_: any, record: SimTrade) => record.symbol || record.contract_address?.slice(0, 8) + '...',
    },
    {
      title: '方向',
      dataIndex: 'side',
      key: 'side',
      width: 70,
      render: (v: string) => <Tag color={v === 'BUY' ? 'green' : 'red'}>{v === 'BUY' ? '买入' : '卖出'}</Tag>,
    },
    {
      title: '入场价',
      dataIndex: 'entry_price',
      key: 'entry_price',
      width: 120,
      render: (v: string) => formatPrice(v),
    },
    {
      title: '出场价',
      dataIndex: 'exit_price',
      key: 'exit_price',
      width: 120,
      render: (v: string | null) => v ? formatPrice(v) : '-',
    },
    {
      title: '盈亏',
      dataIndex: 'pnl',
      key: 'pnl',
      width: 120,
      render: (v: string | null, record: SimTrade) => {
        if (record.status !== 'CLOSED' || v == null) return <Tag color="blue">持仓中</Tag>;
        const num = parseFloat(v);
        return (
          <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {formatNumber(num, { prefix: num >= 0 ? '+' : '', decimals: 4 })}
          </span>
        );
      },
    },
    {
      title: '盈亏%',
      dataIndex: 'pnl_percent',
      key: 'pnl_percent',
      width: 90,
      render: (v: string | null) => {
        if (v == null) return '-';
        const num = parseFloat(v);
        return (
          <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {num >= 0 ? '+' : ''}{num.toFixed(2)}%
          </span>
        );
      },
    },
    {
      title: '持仓时长',
      dataIndex: 'holding_duration_minutes',
      key: 'holding_duration_minutes',
      width: 100,
      render: (v: number | null) => {
        if (v == null) return '-';
        if (v < 60) return `${v}分钟`;
        if (v < 1440) return `${Math.floor(v / 60)}h ${v % 60}m`;
        return `${Math.floor(v / 1440)}天 ${Math.floor((v % 1440) / 60)}h`;
      },
    },
    {
      title: '模式',
      dataIndex: 'trade_type',
      key: 'trade_type',
      width: 80,
      render: (v: string) => (
        <Tag color={v === 'ai_auto' ? 'blue' : 'default'}>
          {v === 'ai_auto' ? 'AI' : '手动'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (v: string) => (
        <Tag color={v === 'OPEN' ? 'processing' : v === 'CLOSED' ? 'default' : 'warning'}>
          {v === 'OPEN' ? '持仓中' : v === 'CLOSED' ? '已平仓' : v}
        </Tag>
      ),
    },
  ];

  return (
    <div>
      <Spin spinning={loading}>
        {/* 顶部统计卡片 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card>
              <Statistic
                title="总交易次数"
                value={stats?.total ?? '-'}
                prefix={<TrophyOutlined />}
                suffix={stats ? `(开 ${stats.open} / 平 ${stats.closed})` : undefined}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="胜率"
                value={winRateNum}
                precision={1}
                suffix="%"
                prefix={<PercentageOutlined />}
                valueStyle={{ color: winRateNum >= 50 ? '#3f8600' : '#cf1322' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="累计盈亏"
                value={totalPnlNum}
                precision={2}
                prefix="$"
                valueStyle={{ color: totalPnlNum >= 0 ? '#3f8600' : '#cf1322' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="平均持仓"
                value={stats?.avgHoldingMinutes ?? '-'}
                suffix={stats ? '分钟' : ''}
                prefix={<ClockCircleOutlined />}
              />
            </Card>
          </Col>
        </Row>

        {/* 组合信息 */}
        {stats?.portfolio && (
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="组合总值" value={parseFloat(stats.portfolio.totalValue)} precision={2} prefix="$" />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="可用余额" value={parseFloat(stats.portfolio.availableBalance)} precision={2} prefix="$" />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="最大回撤"
                  value={stats.maxDrawdown}
                  prefix={<FireOutlined />}
                  valueStyle={{ color: '#cf1322' }}
                />
              </Card>
            </Col>
          </Row>
        )}
      </Spin>

      {/* 每日盈亏图表 */}
      <Card title="📊 每日盈亏" style={{ marginBottom: 16 }}>
        {dailyPnl.dates.length > 0 ? (
          <ReactECharts option={chartOption} style={{ height: 300 }} />
        ) : (
          <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 60 }}>暂无已平仓交易数据</div>
        )}
      </Card>

      {/* 策略分布 */}
      {stats?.byStrategy && stats.byStrategy.length > 0 && (
        <Card title="📈 策略分布" style={{ marginBottom: 16 }} size="small">
          <Table
            dataSource={stats.byStrategy}
            rowKey="strategy"
            size="small"
            pagination={false}
            columns={[
              { title: '策略', dataIndex: 'strategy', render: (v: string) => v || '未指定' },
              { title: '交易次数', dataIndex: 'count' },
              { title: '胜场', dataIndex: 'wins' },
              {
                title: '盈亏',
                dataIndex: 'total_pnl',
                render: (v: number) => (
                  <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>
                    {formatNumber(v, { prefix: '$', decimals: 2 })}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}

      {/* 交易历史 */}
      <Card title={`📋 交易历史（${tradesTotal}）`}>
        <Table
          dataSource={trades}
          columns={columns}
          rowKey="trade_id"
          size="small"
          loading={tradesLoading}
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize,
            total: tradesTotal,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => loadTrades(p, ps),
          }}
        />
      </Card>
    </div>
  );
};

export default SimStatsPage;
