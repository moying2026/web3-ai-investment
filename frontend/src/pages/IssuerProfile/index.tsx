import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Descriptions, Row, Col, Statistic, Progress, Spin, Button, Space, message } from 'antd';
import { ArrowLeftOutlined, UserOutlined } from '@ant-design/icons';
import api from '../../services/api';
import { formatPrice, formatVolume } from '../../utils/format';

interface IssuerData {
  id: number;
  issuer_address: string;
  total_tokens: number;
  alive_tokens: number;
  dead_tokens: number;
  survival_rate: number | null;
  first_seen_at: string;
  last_seen_at: string;
  tokens: any[];
}

const IssuerProfile: React.FC = () => {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const [issuer, setIssuer] = useState<IssuerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    api.get<any, IssuerData>(`/issuers/${address}`)
      .then(data => setIssuer(data as any))
      .catch(() => message.error('发行方信息加载失败'))
      .finally(() => setLoading(false));
  }, [address]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!issuer) return <div style={{ textAlign: 'center', padding: 100 }}>发行方未找到</div>;

  const survivalRate = issuer.survival_rate != null ? issuer.survival_rate * 100 : null;

  const tokenColumns = [
    {
      title: '代币',
      key: 'symbol',
      render: (_: any, record: any) => (
        <Space>
          {record.icon ? (
            <img src={`https://www.binance.com${record.icon}`} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : '🪙'}
          <span style={{ fontWeight: 'bold' }}>{record.symbol}</span>
        </Space>
      ),
    },
    {
      title: '价格',
      key: 'price',
      render: (_: any, record: any) => formatPrice(record.price_latest),
    },
    {
      title: '市值',
      key: 'market_cap',
      render: (_: any, record: any) => formatVolume(record.market_cap),
    },
    { title: '持有人', dataIndex: 'holders', key: 'holders' },
    {
      title: '迁移状态',
      key: 'migration',
      render: (_: any, record: any) => {
        const pct = record.dev_migrated_percent;
        if (pct == null) return '-';
        const val = parseFloat(pct) * 100;
        const color = val >= 80 ? '#52c41a' : val >= 50 ? '#faad14' : '#ff4d4f';
        return <Progress percent={val} size="small" strokeColor={color} format={() => `${val.toFixed(1)}%`} />;
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, record: any) => {
        const riskMap: Record<number, { label: string; color: string }> = {
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
      render: (_: any, record: any) => {
        if (!record.launch_time) return '-';
        const diff = Date.now() - record.launch_time;
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        return `${Math.floor(diff / 86400000)}天前`;
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
            <Statistic title="发行方地址" value={issuer.issuer_address} valueStyle={{ fontSize: 14, fontFamily: 'monospace' }} />
          </Col>
          <Col span={4}>
            <Statistic title="总代币数" value={issuer.total_tokens} />
          </Col>
          <Col span={4}>
            <Statistic title="存活代币" value={issuer.alive_tokens} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col span={4}>
            <Statistic title="已死亡" value={issuer.dead_tokens} valueStyle={{ color: '#ff4d4f' }} />
          </Col>
          <Col span={6}>
            <div style={{ color: '#8c8c8c', marginBottom: 8 }}>存活率</div>
            {survivalRate != null ? (
              <Progress
                percent={survivalRate}
                strokeColor={survivalRate >= 80 ? '#52c41a' : survivalRate >= 50 ? '#faad14' : '#ff4d4f'}
                format={() => `${survivalRate.toFixed(1)}%`}
              />
            ) : (
              <span style={{ fontSize: 24 }}>-</span>
            )}
          </Col>
        </Row>
        <Descriptions size="small" style={{ marginTop: 16 }}>
          <Descriptions.Item label="首次出现">{issuer.first_seen_at ? new Date(issuer.first_seen_at).toLocaleString() : '-'}</Descriptions.Item>
          <Descriptions.Item label="最近活动">{issuer.last_seen_at ? new Date(issuer.last_seen_at).toLocaleString() : '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 历史代币列表 */}
      <Card title={`📋 历史代币（${issuer.tokens?.length ?? 0}）`}>
        <Table
          dataSource={issuer.tokens || []}
          columns={tokenColumns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 20 }}
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
