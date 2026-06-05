import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Space, Spin } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { smartMoneyApi } from '../../services/api';

const SmartMoneySignals: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });

  const loadSignals = async (page = 1, pageSize = 20) => {
    setLoading(true);
    try {
      const res = await smartMoneyApi.getSignals({ page, pageSize });
      const r = res as any;
      setData(r?.data || []);
      setPagination({ page, pageSize, total: r?.total || 0 });
    } catch {
      // API 不可用时静默
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSignals(); }, []);

  const columns = [
    {
      title: '代币',
      key: 'symbol',
      width: 120,
      render: (_: any, r: any) => (
        <Space>
          {r.icon ? (
            <img src={r.icon} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : <span>🪙</span>}
          <span style={{ fontWeight: 'bold' }}>{r.symbol || '-'}</span>
        </Space>
      ),
    },
    {
      title: '链',
      dataIndex: 'chain_id',
      key: 'chain_id',
      width: 80,
      render: (v: string) => {
        const m: Record<string, string> = { '56': 'BSC', 'CT_501': 'SOL', '1': 'ETH' };
        return <Tag>{m[v] || v}</Tag>;
      },
    },
    {
      title: '信号',
      key: 'action',
      width: 80,
      render: (_: any, r: any) => {
        const action = r.action || r.signal_type || r.side;
        const isBuy = action === 'buy' || action === 'BUY';
        return <Tag color={isBuy ? 'green' : 'red'}>{isBuy ? '买入' : '卖出'}</Tag>;
      },
    },
    {
      title: '数量',
      key: 'amount',
      width: 100,
      render: (_: any, r: any) => {
        const v = parseFloat(r.amount || r.quantity || '0');
        if (isNaN(v)) return '-';
        if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
        return v.toFixed(2);
      },
    },
    {
      title: '触发价格',
      key: 'trigger_price',
      width: 120,
      render: (_: any, r: any) => {
        const v = parseFloat(r.trigger_price || r.price || '0');
        if (isNaN(v) || v === 0) return '-';
        return v < 0.01 ? `$${v.toFixed(8)}` : `$${v.toFixed(4)}`;
      },
    },
    {
      title: 'Smart Money',
      key: 'wallet',
      width: 160,
      ellipsis: true,
      render: (_: any, r: any) => {
        const addr = r.wallet_address || r.smart_money_address || r.address;
        if (!addr) return '-';
        return <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{`${addr.slice(0, 6)}...${addr.slice(-4)}`}</span>;
      },
    },
    {
      title: '时间',
      key: 'created_at',
      width: 140,
      render: (_: any, r: any) => {
        const t = r.created_at || r.timestamp;
        if (!t) return '-';
        const d = new Date(t);
        const diff = Date.now() - d.getTime();
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        return d.toLocaleDateString();
      },
    },
  ];

  return (
    <div>
      <Card
        title={<><ThunderboltOutlined /> Smart Money 信号</>}
        size="small"
      >
        <Spin spinning={loading}>
          {data.length === 0 && !loading ? (
            <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 60 }}>
              暂无 Smart Money 信号数据（后端数据采集就绪后自动展示）
            </div>
          ) : (
            <Table
              dataSource={data}
              columns={columns}
              rowKey={(r) => r.id || r.signal_id || `${r.wallet_address}-${r.created_at}`}
              size="small"
              pagination={{
                current: pagination.page,
                pageSize: pagination.pageSize,
                total: pagination.total,
                showSizeChanger: true,
                showTotal: (t) => `共 ${t} 条`,
                onChange: (p, ps) => loadSignals(p, ps),
              }}
              onRow={(record) => ({
                onClick: () => {
                  const chain = record.chain_id;
                  const addr = record.contract_address;
                  if (chain && addr) navigate(`/token/${chain}/${addr}`);
                },
                style: { cursor: 'pointer' },
              })}
              scroll={{ x: 800 }}
            />
          )}
        </Spin>
      </Card>
    </div>
  );
};

export default SmartMoneySignals;
