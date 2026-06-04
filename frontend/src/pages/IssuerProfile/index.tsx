import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Descriptions, Row, Col, Statistic, Progress, Spin, Button, Space, message } from 'antd';
import { ArrowLeftOutlined, UserOutlined, WarningOutlined } from '@ant-design/icons';
import api from '../../services/api';
import { formatPrice, formatVolume } from '../../utils/format';

interface IssuerDetail {
  issuerAddress: string;
  totalTokens: number;
  aliveTokens: number;
  deadTokens: number;
  migratedCount: number;
  unmigratedCount: number;
  survivalRate: number | null;
  migrationRate: number;
  firstSeenAt: string;
  lastSeenAt: string;
  riskLevel: string;
  riskReasons: string[];
}

interface TokenItem {
  id: number;
  chain_id: string;
  contract_address: string;
  symbol: string;
  icon?: string;
  price_latest?: string;
  market_cap?: string;
  holders?: number;
  dev_migrated_percent?: number;
  audit_info?: string;
  launch_time?: number;
  create_time?: number;
}

const IssuerProfile: React.FC = () => {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const [issuer, setIssuer] = useState<IssuerDetail | null>(null);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [tokensTotal, setTokensTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    api.get<any, IssuerDetail>(`/issuer/${address}`)
      .then(data => setIssuer(data as any))
      .catch(() => message.error('发行方信息加载失败'))
      .finally(() => setLoading(false));
  }, [address]);

  const loadTokens = useCallback(async (p = 1, ps = 50) => {
    if (!address) return;
    setTokensLoading(true);
    try {
      const res = await api.get<any, any>(`/issuer/${address}/tokens`, { params: { page: p, pageSize: ps } });
      setTokens(res?.data || []);
      setTokensTotal(res?.total || 0);
      setPage(p);
      setPageSize(ps);
    } catch {
      message.error('代币列表加载失败');
    } finally {
      setTokensLoading(false);
    }
  }, [address]);

  useEffect(() => {
    loadTokens();
  }, [address]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!issuer) return <div style={{ textAlign: 'center', padding: 100, fontSize: 16 }}>发行方未找到</div>;

  const survivalRate = issuer.survivalRate != null ? issuer.survivalRate * 100 : null;
  const migrationRate = issuer.migrationRate * 100;
  const riskColor = issuer.riskLevel === 'high' ? 'red' : issuer.riskLevel === 'medium' ? 'orange' : 'green';
  const riskLabel = issuer.riskLevel === 'high' ? '高风险' : issuer.riskLevel === 'medium' ? '中风险' : '低风险';

  const tokenColumns = [
    {
      title: '代币',
      key: 'symbol',
      width: 180,
      render: (_: any, record: TokenItem) => (
        <Space>
          {record.icon ? (
            <img src={`https://www.binance.com${record.icon}`} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : '🪙'}
          <span style={{ fontWeight: 'bold' }}>{record.symbol || '-'}</span>
        </Space>
      ),
    },
    {
      title: '价格',
      key: 'price',
      width: 120,
      render: (_: any, record: TokenItem) => formatPrice(record.price_latest),
    },
    {
      title: '市值',
      key: 'market_cap',
      width: 120,
      render: (_: any, record: TokenItem) => formatVolume(record.market_cap),
    },
    { title: '持有人', dataIndex: 'holders', key: 'holders', width: 80 },
    {
      title: '迁移状态',
      key: 'migration',
      width: 120,
      render: (_: any, record: TokenItem) => {
        const pct = record.dev_migrated_percent;
        if (pct == null) return '-';
        const val = parseFloat(String(pct)) * 100;
        const color = val >= 80 ? '#52c41a' : val >= 50 ? '#faad14' : '#ff4d4f';
        return <Progress percent={val} size="small" strokeColor={color} format={() => `${val.toFixed(1)}%`} />;
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_: any, record: TokenItem) => {
        const riskMap: Record<number, { label: string; color: string }> = {
          0: { label: '低风险', color: 'green' },
          1: { label: '低风险', color: 'green' },
          2: { label: '中风险', color: 'orange' },
          3: { label: '高风险', color: 'red' },
        };
        try {
          const info = JSON.parse(record.audit_info || '{}');
          const r = riskMap[info.riskLevel] || { label: '未知', color: 'default' };
          return <Tag color={r.color}>{r.label}</Tag>;
        } catch { return <Tag>未知</Tag>; }
      },
    },
    {
      title: '发行时间',
      key: 'launch_time',
      width: 120,
      render: (_: any, record: TokenItem) => {
        const ts = record.launch_time || record.create_time;
        if (!ts) return '-';
        const diff = Date.now() - ts;
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
        return new Date(ts).toLocaleDateString();
      },
    },
  ];

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>返回</Button>

      {/* 发行方概览 */}
      <Card title={<><UserOutlined /> 发行方画像</>} style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          <Col span={6}>
            <Statistic title="发行方地址" value={issuer.issuerAddress} valueStyle={{ fontSize: 13, fontFamily: 'monospace' }} />
          </Col>
          <Col span={3}>
            <Statistic title="总代币数" value={issuer.totalTokens} />
          </Col>
          <Col span={3}>
            <Statistic title="存活" value={issuer.aliveTokens} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col span={3}>
            <Statistic title="已死亡" value={issuer.deadTokens} valueStyle={{ color: '#ff4d4f' }} />
          </Col>
          <Col span={4}>
            <div style={{ color: '#8c8c8c', marginBottom: 8 }}>存活率</div>
            {survivalRate != null ? (
              <Progress
                percent={parseFloat(survivalRate.toFixed(1))}
                strokeColor={survivalRate >= 80 ? '#52c41a' : survivalRate >= 50 ? '#faad14' : '#ff4d4f'}
                format={() => `${survivalRate.toFixed(1)}%`}
              />
            ) : (
              <span style={{ fontSize: 24 }}>-</span>
            )}
          </Col>
          <Col span={5}>
            <div style={{ color: '#8c8c8c', marginBottom: 8 }}>风险等级</div>
            <Tag color={riskColor} icon={<WarningOutlined />} style={{ fontSize: 16, padding: '4px 12px' }}>
              {riskLabel}
            </Tag>
          </Col>
        </Row>

        {/* 迁移与风险详情 */}
        <Row gutter={24} style={{ marginTop: 16 }}>
          <Col span={6}>
            <Statistic title="已迁移" value={issuer.migratedCount} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col span={6}>
            <Statistic title="未迁移" value={issuer.unmigratedCount} valueStyle={{ color: '#ff4d4f' }} />
          </Col>
          <Col span={6}>
            <div style={{ color: '#8c8c8c', marginBottom: 8 }}>迁移率</div>
            <Progress
              percent={parseFloat(migrationRate.toFixed(1))}
              strokeColor={migrationRate >= 50 ? '#52c41a' : migrationRate >= 20 ? '#faad14' : '#ff4d4f'}
              format={() => `${migrationRate.toFixed(1)}%`}
            />
          </Col>
          <Col span={6}>
            <div style={{ color: '#8c8c8c', marginBottom: 8 }}>风险原因</div>
            {issuer.riskReasons?.map((r, i) => (
              <div key={i} style={{ fontSize: 12, color: issuer.riskLevel === 'high' ? '#ff4d4f' : '#faad14' }}>
                • {r}
              </div>
            ))}
          </Col>
        </Row>

        <Descriptions size="small" style={{ marginTop: 16 }}>
          <Descriptions.Item label="首次出现">{issuer.firstSeenAt ? new Date(issuer.firstSeenAt).toLocaleString() : '-'}</Descriptions.Item>
          <Descriptions.Item label="最近活动">{issuer.lastSeenAt ? new Date(issuer.lastSeenAt).toLocaleString() : '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 历史代币列表 */}
      <Card title={`📋 历史代币（${tokensTotal}）`}>
        <Table
          dataSource={tokens}
          columns={tokenColumns}
          rowKey="id"
          size="small"
          loading={tokensLoading}
          scroll={{ x: 800 }}
          pagination={{
            current: page,
            pageSize,
            total: tokensTotal,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个代币`,
            onChange: (p, ps) => loadTokens(p, ps),
          }}
          onRow={(record) => ({
            onClick: () => navigate(`/token/${record.chain_id}/${record.contract_address}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>
    </div>
  );
};

export default IssuerProfile;
