import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Table, Tag, Space, Statistic, Button, Tooltip, Spin } from 'antd';
import {
  FundOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  MinusOutlined,
} from '@ant-design/icons';
import { simApi } from '../services/api';
import { formatPrice, formatPercent } from '../utils/format';

interface Position {
  trade_id: string;
  chain_id: string;
  contract_address: string;
  symbol: string;
  dex: string;
  entry_price: number;
  buy_amount: number;
  buy_token: string;
  token_quantity: number;
  current_price: number;
  current_value: number;
  holders: number;
  liquidity: number;
  market_cap: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  holding_duration_minutes: number;
  stop_loss_price: number;
  stop_loss_percent: number;
  take_profit_price: number;
  take_profit_percent: number;
  pending_orders: any[];
  strategy: string;
  trigger_reason: string;
  created_at: string;
}

interface Summary {
  count: number;
  total_invested: number;
  total_current_value: number;
  total_unrealized_pnl: number;
  avg_pnl_percent: number;
}

const chainMap: Record<string, string> = { '56': 'BSC', 'CT_501': 'SOL', '1': 'ETH', '8453': 'Base' };

const PositionMonitor: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPositions = useCallback(async () => {
    try {
      const res = await simApi.getOpenPositions();
      const data = (res as any)?.data;
      setPositions(data?.positions || []);
      setSummary(data?.summary || null);
    } catch { /* 静默 */ }
    finally { setLoading(false); }
  }, []);

  // 初始加载
  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  // 自动轮询
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoRefresh) {
      timerRef.current = setInterval(loadPositions, 15000);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [autoRefresh, loadPositions]);

  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes}分`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}时${minutes % 60}分`;
    return `${Math.floor(minutes / 1440)}天${Math.floor((minutes % 1440) / 60)}时`;
  };

  const getPnlColor = (pnl: number): string => {
    if (pnl > 0) return '#52c41a';
    if (pnl < 0) return '#ff4d4f';
    return '#8c8c8c';
  };

  const getPnlIcon = (pnl: number) => {
    if (pnl > 0) return <ArrowUpOutlined style={{ color: '#52c41a', fontSize: 10 }} />;
    if (pnl < 0) return <ArrowDownOutlined style={{ color: '#ff4d4f', fontSize: 10 }} />;
    return <MinusOutlined style={{ color: '#8c8c8c', fontSize: 10 }} />;
  };

  const getDistancePercent = (current: number, target: number, entry: number): number => {
    if (!entry || !target) return 0;
    return ((target - current) / entry) * 100;
  };

  const columns = [
    {
      title: '代币',
      key: 'symbol',
      width: 130,
      render: (_: any, record: Position) => (
        <Space size={4}>
          <span style={{ fontWeight: 'bold', fontSize: 12 }}>{record.symbol}</span>
          <Tag style={{ fontSize: 10, padding: '0 2px', margin: 0 }}>{chainMap[record.chain_id] || record.chain_id}</Tag>
        </Space>
      ),
    },
    {
      title: '买入价',
      key: 'entry_price',
      width: 90,
      render: (_: any, record: Position) => (
        <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{formatPrice(record.entry_price)}</span>
      ),
    },
    {
      title: '当前价',
      key: 'current_price',
      width: 90,
      render: (_: any, record: Position) => (
        <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{formatPrice(record.current_price)}</span>
      ),
    },
    {
      title: '投入',
      key: 'buy_amount',
      width: 70,
      render: (_: any, record: Position) => (
        <span style={{ fontSize: 11 }}>${record.buy_amount?.toFixed(0)}</span>
      ),
    },
    {
      title: '当前值',
      key: 'current_value',
      width: 80,
      render: (_: any, record: Position) => (
        <span style={{ fontSize: 11, fontWeight: 'bold' }}>${record.current_value?.toFixed(2)}</span>
      ),
    },
    {
      title: '盈亏',
      key: 'pnl',
      width: 100,
      sorter: (a: Position, b: Position) => a.unrealized_pnl_percent - b.unrealized_pnl_percent,
      render: (_: any, record: Position) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {getPnlIcon(record.unrealized_pnl)}
          <span style={{ color: getPnlColor(record.unrealized_pnl), fontWeight: 'bold', fontSize: 12 }}>
            {record.unrealized_pnl >= 0 ? '+' : ''}{record.unrealized_pnl?.toFixed(2)}
          </span>
          <span style={{ color: getPnlColor(record.unrealized_pnl_percent), fontSize: 10 }}>
            ({formatPercent(record.unrealized_pnl_percent)})
          </span>
        </div>
      ),
    },
    {
      title: '止损',
      key: 'stop_loss',
      width: 90,
      render: (_: any, record: Position) => {
        const dist = getDistancePercent(record.current_price, record.stop_loss_price, record.entry_price);
        const near = Math.abs(dist) < 5;
        return (
          <Tooltip title={`止损价: ${formatPrice(record.stop_loss_price)} | 距离: ${dist.toFixed(1)}%`}>
            <Tag color={near ? 'red' : 'default'} style={{ fontSize: 10, padding: '0 3px', margin: 0 }}>
              {record.stop_loss_percent ?? '-20'}%
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '止盈',
      key: 'take_profit',
      width: 90,
      render: (_: any, record: Position) => {
        const dist = getDistancePercent(record.current_price, record.take_profit_price, record.entry_price);
        const near = Math.abs(dist) < 10;
        return (
          <Tooltip title={`止盈价: ${formatPrice(record.take_profit_price)} | 距离: ${dist.toFixed(1)}%`}>
            <Tag color={near ? 'green' : 'default'} style={{ fontSize: 10, padding: '0 3px', margin: 0 }}>
              +{record.take_profit_percent ?? '+50'}%
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '持仓时长',
      key: 'duration',
      width: 80,
      render: (_: any, record: Position) => (
        <span style={{ fontSize: 11, color: '#8c8c8c' }}>{formatDuration(record.holding_duration_minutes)}</span>
      ),
    },
    {
      title: '持有人',
      key: 'holders',
      width: 70,
      render: (_: any, record: Position) => (
        <span style={{ fontSize: 11 }}>{record.holders?.toLocaleString() ?? '-'}</span>
      ),
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 4 }}
      bodyStyle={{ padding: '4px 8px' }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FundOutlined style={{ fontSize: 13, color: '#1890ff' }} />
          <span style={{ fontWeight: 'bold', fontSize: 13 }}>持仓监控</span>
          {summary && (
            <Tag style={{ fontSize: 10, padding: '0 4px', margin: 0 }}>{summary.count} 笔</Tag>
          )}
        </div>
      }
      extra={
        <Space size={4}>
          {summary && (
            <span style={{ fontSize: 11, color: getPnlColor(summary.total_unrealized_pnl), fontWeight: 'bold' }}>
              {summary.total_unrealized_pnl >= 0 ? '+' : ''}${summary.total_unrealized_pnl?.toFixed(2)}
            </span>
          )}
          <Button
            size="small"
            icon={autoRefresh ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => setAutoRefresh(!autoRefresh)}
            type={autoRefresh ? 'primary' : 'default'}
            ghost={autoRefresh}
            style={{ fontSize: 10, height: 20, padding: '0 4px' }}
          >
            {autoRefresh ? '15s' : '已暂停'}
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadPositions}
            style={{ fontSize: 10, height: 20, padding: '0 4px' }}
          >
            刷新
          </Button>
        </Space>
      }
    >
      {/* 汇总统计 */}
      {summary && summary.count > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <Card size="small" style={{ flex: 1 }} bodyStyle={{ padding: '2px 6px' }}>
            <Statistic
              title={<span style={{ fontSize: 10 }}>总投入</span>}
              value={summary.total_invested}
              prefix="$"
              valueStyle={{ fontSize: 14 }}
            />
          </Card>
          <Card size="small" style={{ flex: 1 }} bodyStyle={{ padding: '2px 6px' }}>
            <Statistic
              title={<span style={{ fontSize: 10 }}>当前总值</span>}
              value={summary.total_current_value}
              prefix="$"
              valueStyle={{ fontSize: 14 }}
            />
          </Card>
          <Card size="small" style={{ flex: 1 }} bodyStyle={{ padding: '2px 6px' }}>
            <Statistic
              title={<span style={{ fontSize: 10 }}>未实现盈亏</span>}
              value={summary.total_unrealized_pnl}
              prefix={summary.total_unrealized_pnl >= 0 ? '+$' : '-$'}
              valueStyle={{ fontSize: 14, color: getPnlColor(summary.total_unrealized_pnl) }}
            />
          </Card>
          <Card size="small" style={{ flex: 1 }} bodyStyle={{ padding: '2px 6px' }}>
            <div style={{ fontSize: 10, color: '#8c8c8c', marginBottom: 2 }}>平均盈亏</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {getPnlIcon(summary.avg_pnl_percent)}
              <span style={{ fontSize: 14, fontWeight: 'bold', color: getPnlColor(summary.avg_pnl_percent) }}>
                {formatPercent(summary.avg_pnl_percent)}
              </span>
            </div>
          </Card>
        </div>
      )}

      {/* 持仓列表 */}
      <Spin spinning={loading}>
        {positions.length > 0 ? (
          <Table
            dataSource={positions}
            columns={columns}
            rowKey="trade_id"
            size="small"
            pagination={false}
            scroll={{ y: 200 }}
            className="ultra-compact-table"
            rowClassName={(record) => {
              if (record.unrealized_pnl_percent <= (record.stop_loss_percent ?? -20) + 5) return 'row-near-stop-loss';
              if (record.unrealized_pnl_percent >= (record.take_profit_percent ?? 50) - 10) return 'row-near-take-profit';
              return '';
            }}
          />
        ) : (
          !loading && (
            <div style={{ textAlign: 'center', padding: 20, color: '#8c8c8c' }}>
              暂无未平仓持仓
            </div>
          )
        )}
      </Spin>
    </Card>
  );
};

export default PositionMonitor;
