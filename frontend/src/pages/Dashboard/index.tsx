import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Card, Statistic, Tag, Table, Badge, Switch, Space, message, Spin, Select, Input, InputNumber, Button, Form, Segmented, Progress, Tabs, Divider, Alert, Descriptions } from 'antd';
import {
  WalletOutlined,
  FundOutlined,
  ThunderboltOutlined,
  SyncOutlined,
  FilterOutlined,
  ClearOutlined,
  WarningOutlined,
  SafetyOutlined,
  ReloadOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import type { Token, Stats } from '../../types';
import api, { tokenApi, statsApi, simApi, auditApi, dynamicApi, tokenAnalyzerApi, issuerRiskApi, createNewTokenSSE } from '../../services/api';
import { formatPrice, formatVolume, formatSupply, formatPercent } from '../../utils/format';

// 筛选参数类型
interface FilterParams {
  chain?: string;
  launch_within?: string;
  creator?: string;
  risk_level?: string;
  holders_min?: number;
  holders_max?: number;
  liquidity_min?: number;
  liquidity_max?: number;
  is_new_coin?: number;
}

// 代币图标组件：后端代理获取，失败显示首字母占位符
const TokenIcon: React.FC<{
  chain: string;
  address: string;
  iconPath?: string;
  symbol: string;
}> = ({ chain, address, iconPath, symbol }) => {
  const [showImg, setShowImg] = useState(true);
  const firstChar = (symbol || '?').charAt(0).toUpperCase();

  if (!showImg || !iconPath) {
    return (
      <span
        style={{
          width: 24, height: 24, borderRadius: '50%', background: '#1890ff', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 'bold', flexShrink: 0,
        }}
      >
        {firstChar}
      </span>
    );
  }

  return (
    <img
      src={`/api/token-icon/${chain}/${address}?icon=${encodeURIComponent(iconPath)}`}
      alt=""
      style={{ width: 24, height: 24, borderRadius: '50%' }}
      onError={() => setShowImg(false)}
    />
  );
};

// 发行方画像组件（用于Tab1）
const IssuerProfile: React.FC<{ creatorAddress: string }> = ({ creatorAddress }) => {
  const [issuer, setIssuer] = useState<any>(null);
  const [issuerRisk, setIssuerRisk] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setIssuer(null);
    setIssuerRisk(null);
    Promise.all([
      api.get(`/issuers/${creatorAddress}`).catch(() => null),
      issuerRiskApi.getRisk(creatorAddress).catch(() => null),
    ]).then(([issuerData, riskData]) => {
      setIssuer(issuerData);
      setIssuerRisk(riskData);
    }).finally(() => setLoading(false));
  }, [creatorAddress]);

  if (loading) return <Spin size="small" style={{ display: 'block', margin: '20px auto' }} />;
  if (!issuer) return <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 20 }}>暂无发行方数据</div>;

  return (
    <>
      {/* 发行方风险 */}
      {issuerRisk && (
        <Card title="📊 发行方风险" size="small" bodyStyle={{ padding: '4px 8px' }} style={{ marginBottom: 8 }}>
          <Row gutter={8} style={{ marginBottom: 8 }}>
            <Col span={4}>
              <div style={{ color: '#8c8c8c', fontSize: 11 }}>等级</div>
              <Tag color={issuerRisk.riskLevel === 'high' ? 'red' : issuerRisk.riskLevel === 'medium' ? 'orange' : 'green'}
                icon={issuerRisk.riskLevel === 'high' ? <WarningOutlined /> : <SafetyOutlined />}
                style={{ fontSize: 12, padding: '2px 6px' }}>
                {issuerRisk.riskLevel === 'high' ? '高' : issuerRisk.riskLevel === 'medium' ? '中' : '低'}
              </Tag>
            </Col>
            <Col span={4}><Statistic title="代币数" value={issuerRisk.totalTokens ?? 0} valueStyle={{ fontSize: 16 }} /></Col>
            <Col span={4}><Statistic title="7天" value={issuerRisk.recentTokens7d ?? 0} valueStyle={{ color: (issuerRisk.recentTokens7d ?? 0) > 3 ? '#ff4d4f' : undefined, fontSize: 16 }} /></Col>
            <Col span={4}><Statistic title="30天" value={issuerRisk.recentTokens30d ?? 0} valueStyle={{ fontSize: 16 }} /></Col>
            <Col span={4}>
              <div style={{ color: '#8c8c8c', fontSize: 11 }}>迁移率</div>
              <Progress
                percent={parseFloat(((issuerRisk.migrationRate ?? 0) * 100).toFixed(1))}
                strokeColor={(issuerRisk.migrationRate ?? 0) >= 0.5 ? '#52c41a' : (issuerRisk.migrationRate ?? 0) >= 0.2 ? '#faad14' : '#ff4d4f'}
                format={(pct) => `${pct}%`}
                size="small"
              />
            </Col>
            <Col span={4}>
              <div style={{ color: '#8c8c8c', fontSize: 11 }}>置信度</div>
              <span style={{ fontSize: 16, fontWeight: 'bold' }}>{((issuerRisk.confidence ?? 0) * 100).toFixed(0)}%</span>
            </Col>
          </Row>
          {issuerRisk.riskReasons?.length > 0 && (
            <Alert message="风险原因" description={issuerRisk.riskReasons.join('；')} type={issuerRisk.riskLevel === 'high' ? 'error' : 'warning'} showIcon style={{ fontSize: 11 }} />
          )}
        </Card>
      )}
      <Card title="👤 发行方画像" size="small" bodyStyle={{ padding: '4px 8px' }}>
      <Row gutter={8} style={{ marginBottom: 8 }}>
        <Col span={6}><Statistic title="总代币" value={issuer.total_tokens ?? 0} valueStyle={{ fontSize: 16 }} /></Col>
        <Col span={6}><Statistic title="存活" value={issuer.alive_tokens ?? 0} valueStyle={{ color: '#52c41a', fontSize: 16 }} /></Col>
        <Col span={6}><Statistic title="死亡" value={issuer.dead_tokens ?? 0} valueStyle={{ color: '#ff4d4f', fontSize: 16 }} /></Col>
        <Col span={6}>
          <div style={{ color: '#8c8c8c', fontSize: 11, marginBottom: 4 }}>存活率</div>
          {issuer.survival_rate != null ? (
            <Progress percent={Math.round(issuer.survival_rate * 100)} strokeColor={issuer.survival_rate >= 0.8 ? '#52c41a' : '#faad14'} size="small" />
          ) : '-'}
        </Col>
      </Row>
      <Descriptions size="small" column={2}>
        <Descriptions.Item label="地址">
          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{creatorAddress?.slice(0, 10)}...{creatorAddress?.slice(-6)}</span>
        </Descriptions.Item>
        <Descriptions.Item label="首次">{issuer.first_seen_at ? new Date(issuer.first_seen_at).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="最近">{issuer.last_seen_at ? new Date(issuer.last_seen_at).toLocaleString() : '-'}</Descriptions.Item>
      </Descriptions>
      {issuer.tokens?.length > 0 && (
        <>
          <div style={{ fontWeight: 'bold', marginTop: 4, marginBottom: 2, fontSize: 11 }}>📋 历史代币（{issuer.tokens.length}）</div>
          <Table
            dataSource={issuer.tokens}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10, size: 'small', showSizeChanger: true, pageSizeOptions: ['10', '20', '50'], showTotal: (t) => `共 ${t} 个` }}
            scroll={{ y: 240 }}
            className="ultra-compact-table"
            columns={[
              { title: '代币', key: 'symbol', render: (_: any, r: any) => <Tag style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>{r.symbol}</Tag> },
              { title: '持有人', dataIndex: 'holders', key: 'holders', render: (v: any) => <span style={{ fontSize: 11 }}>{v ?? '-'}</span> },
              { title: '风险', key: 'risk', render: (_: any, r: any) => {
                try {
                  const info = JSON.parse(r.audit_info || '{}');
                  const m: Record<number, { l: string; c: string }> = { 0: { l: '低', c: 'green' }, 1: { l: '低', c: 'green' }, 2: { l: '中', c: 'orange' }, 3: { l: '高', c: 'red' } };
                  return <Tag color={(m[info.riskLevel] || { c: 'default' }).c} style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>{(m[info.riskLevel] || { l: '未知' }).l}</Tag>;
                } catch { return <Tag style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>未知</Tag>; }
              }},
            ]}
          />
        </>
      )}
    </Card>
    </>
  );
};

// 多智能体综合评分组件（用于Tab2）
const AgentScorePanel: React.FC<{ chain: string; address: string }> = ({ chain, address }) => {
  const [agentScore, setAgentScore] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setAgentScore(null);
    tokenAnalyzerApi.getAgentScore(chain, address)
      .then(data => setAgentScore(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [chain, address]);

  if (loading) return <Spin size="small" style={{ display: 'block', margin: '20px auto' }} />;
  if (!agentScore) return <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 20 }}>暂无评分数据</div>;

  const score = agentScore.score || 0;

  return (
    <Card title="🤖 多智能体综合评分" size="small" bodyStyle={{ padding: '4px 8px' }}>
      <Row gutter={8} align="middle">
        <Col span={6} style={{ textAlign: 'center' }}>
          <Progress
            type="circle"
            percent={score}
            strokeColor={score >= 70 ? '#52c41a' : score >= 40 ? '#faad14' : '#ff4d4f'}
            format={(pct) => `${pct}`}
            size={60}
          />
          <div style={{ marginTop: 4 }}>
            {agentScore.recommendation === 'BUY' ? <Tag color="green">买入</Tag> :
             agentScore.recommendation === 'HOLD' ? <Tag color="blue">持有</Tag> :
             agentScore.recommendation === 'WATCH' ? <Tag color="orange">观望</Tag> :
             <Tag color="red">回避</Tag>}
          </div>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>置信度: {((agentScore.confidence || 0) * 100).toFixed(0)}%</div>
        </Col>
        <Col span={18}>
          {agentScore.details?.scores && (
            <ReactECharts
              option={{
                radar: {
                  indicator: [
                    { name: '合约安全', max: 20 },
                    { name: '市场热度', max: 15 },
                    { name: '发行方信誉', max: 15 },
                    { name: '链上数据', max: 25 },
                    { name: '流动性', max: 25 },
                  ],
                  radius: '60%',
                },
                series: [{
                  type: 'radar' as const,
                  data: [{
                    value: [
                      agentScore.details.scores.risk || 0,
                      agentScore.details.scores.market || 0,
                      agentScore.details.scores.issuer || 0,
                      agentScore.details.scores.onchain || 0,
                      agentScore.details.scores.liquidity || 0,
                    ],
                    areaStyle: { opacity: 0.2 },
                    lineStyle: { color: '#1890ff' },
                    itemStyle: { color: '#1890ff' },
                  }],
                }],
              }}
              style={{ height: 150 }}
            />
          )}
        </Col>
      </Row>
      {(agentScore.riskFlags?.length > 0 || agentScore.highlights?.length > 0) && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <Row gutter={8}>
            {agentScore.riskFlags?.length > 0 && (
              <Col span={12}>
                <div style={{ fontWeight: 'bold', color: '#ff4d4f', marginBottom: 2, fontSize: 12 }}>⚠️ 风险</div>
                {agentScore.riskFlags.map((f: string, i: number) => (
                  <div key={i} style={{ fontSize: 11, color: '#ff4d4f' }}>{f}</div>
                ))}
              </Col>
            )}
            {agentScore.highlights?.length > 0 && (
              <Col span={12}>
                <div style={{ fontWeight: 'bold', color: '#52c41a', marginBottom: 2, fontSize: 12 }}>✅ 亮点</div>
                {agentScore.highlights.map((h: string, i: number) => (
                  <div key={i} style={{ fontSize: 11, color: '#52c41a' }}>{h}</div>
                ))}
              </Col>
            )}
          </Row>
        </>
      )}
    </Card>
  );
};

// 生成 mock K线数据
function generateKlineData(period: string, basePrice: number) {
  const cfg: Record<string, { count: number; intervalMs: number }> = {
    '1m':  { count: 120, intervalMs: 60000 },
    '5m':  { count: 100, intervalMs: 300000 },
    '1h':  { count: 72,  intervalMs: 3600000 },
    '4h':  { count: 60,  intervalMs: 14400000 },
    '24h': { count: 30,  intervalMs: 86400000 },
    '7d':  { count: 28,  intervalMs: 604800000 },
    '30d': { count: 30,  intervalMs: 2592000000 },
  };
  const c = cfg[period] || cfg['1h'];
  const now = Date.now();
  const data: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> = [];
  let last = basePrice > 0 ? basePrice : 1;
  for (let i = 0; i < c.count; i++) {
    const time = now - (c.count - i) * c.intervalMs;
    const vol = basePrice * 0.03;
    const open = last;
    const change = (Math.random() - 0.48) * vol;
    const close = Math.max(open + change, basePrice * 0.5);
    const high = Math.max(open, close) + Math.random() * vol * 0.5;
    const low = Math.min(open, close) - Math.random() * vol * 0.3;
    const volume = Math.random() * 500000 + 50000;
    data.push({ time, open, high, low, close, volume });
    last = close;
  }
  return data;
}

// 代币快速查看组件（嵌入Tab4，完整迁移自TokenDetail）
const TokenQuickView: React.FC<{ chain: string; address: string }> = ({ chain, address }) => {
  const [token, setToken] = useState<Token | null>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [klinePeriod, setKlinePeriod] = useState<string>('1h');
  const [auditData, setAuditData] = useState<any>(null);
  const [dynamicData, setDynamicData] = useState<any>(null);
  const [similarData, setSimilarData] = useState<any>(null);
  const [addressRisk, setAddressRisk] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    setToken(null);
    setSnapshots([]);
    setAuditData(null);
    setDynamicData(null);
    setSimilarData(null);
    setAddressRisk(null);

    Promise.all([
      tokenApi.getDetail(chain, address).catch(() => null),
      tokenApi.getSnapshots(chain, address).catch(() => []),
      auditApi.get(chain, address).catch(() => null),
      dynamicApi.get(chain, address).catch(() => null),
      tokenAnalyzerApi.getSimilar(chain, address).catch(() => null),
      tokenAnalyzerApi.getAddressRisk(chain, address).catch(() => null),
    ]).then(([tokenData, snapData, audit, dynamic, similar, addrRisk]) => {
      if (tokenData) setToken(tokenData as any);
      setSnapshots((snapData as any) || []);
      setAuditData(audit);
      setDynamicData(dynamic);
      setSimilarData(similar);
      setAddressRisk(addrRisk);

    }).finally(() => setLoading(false));
  }, [chain, address]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />;
  if (!token) return <div style={{ textAlign: 'center', padding: 40, color: '#8c8c8c' }}>代币未找到</div>;

  const t = token as any;
  const price = parseFloat(t.price_latest) || 0;
  const change1h = parseFloat(t.percent_change_1h) || 0;
  const change24h = parseFloat(t.percent_change_24h) || 0;
  const volume24h = parseFloat(t.volume_24h) || 0;
  const liquidity = parseFloat(t.liquidity) || 0;
  const marketCap = parseFloat(t.market_cap) || 0;
  const chainMap: Record<string, string> = { '56': 'BSC', 'CT_501': 'SOL', '1': 'ETH', '8453': 'Base' };

  const parseName = (): string => {
    try {
      if (!t.meta_info) return token.symbol;
      const info = JSON.parse(t.meta_info);
      return info.name || info.originName || token.symbol;
    } catch { return token.symbol; }
  };

  const parseTags = (): string[] => {
    try {
      if (!t.token_tag) return [];
      const obj = JSON.parse(t.token_tag);
      const tags: string[] = [];
      Object.values(obj).forEach((arr: any) => { if (Array.isArray(arr)) arr.forEach((item: any) => tags.push(item.tagName)); });
      return tags;
    } catch { return []; }
  };

  const parseRisk = (): { label: string; color: string } => {
    try {
      if (!t.audit_info) return { label: '未知', color: 'default' };
      const info = JSON.parse(t.audit_info);
      const m: Record<number, { label: string; color: string }> = { 0: { label: '低风险', color: 'green' }, 1: { label: '低风险', color: 'green' }, 2: { label: '中风险', color: 'orange' }, 3: { label: '高风险', color: 'red' } };
      return m[info.riskLevel] ?? { label: '未知', color: 'default' };
    } catch { return { label: '未知', color: 'default' }; }
  };

  const parseAuditDetails = () => {
    try {
      if (!t.audit_info) return { contractVerified: '未知', ownership: '未知', blacklist: '未知', honeypot: '未知' };
      const info = JSON.parse(t.audit_info);
      const codes = info.riskCodes || [];
      return {
        contractVerified: codes.includes('unverified') ? '❌ 未验证' : '✅ 已验证',
        ownership: codes.includes('ownership_renounced') ? '已放弃' : '未放弃',
        blacklist: codes.includes('blacklist') ? '有' : '无',
        honeypot: codes.includes('honeypot') ? '⚠️ 疑似' : '通过',
      };
    } catch { return { contractVerified: '未知', ownership: '未知', blacklist: '未知', honeypot: '未知' }; }
  };

  const parseLinks = (): { label: string; link: string }[] => {
    try {
      if (!t.links) return [];
      const arr = JSON.parse(t.links);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };

  const risk = parseRisk();
  const auditDetails = parseAuditDetails();
  const links = parseLinks();
  const tags = parseTags();

  // K线图数据
  const klineData = generateKlineData(klinePeriod, price);
  const timeLabels = klineData.map(d => {
    const date = new Date(d.time);
    if (['1m', '5m'].includes(klinePeriod)) return date.toLocaleTimeString();
    if (['1h', '4h'].includes(klinePeriod)) return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const klineOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'cross' as const } },
    xAxis: { type: 'category' as const, data: timeLabels, axisLabel: { fontSize: 10 } },
    yAxis: {
      type: 'value' as const, scale: true,
      axisLabel: { formatter: (v: number) => {
        if (v === 0) return '0';
        if (Math.abs(v) < 1) { const s = Math.abs(v).toFixed(20).replace(/0+$/, ''); return v.toFixed(Math.min(18, Math.max(8, (s.split('.')[1] || '').length))); }
        if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
        return v.toFixed(2);
      } },
    },
    dataZoom: [{ type: 'inside' as const, start: 60, end: 100 }, { type: 'slider' as const, start: 60, end: 100, height: 20, bottom: 5 }],
    series: [{
      name: 'K线', type: 'candlestick' as const,
      data: klineData.map(d => [d.open, d.close, d.low, d.high]),
      itemStyle: { color: '#ef5350', color0: '#26a69a', borderColor: '#ef5350', borderColor0: '#26a69a' },
    }],
    grid: { left: 60, right: 60, top: 20, bottom: 40 },
  };

  const klinePeriods = [
    { key: '1m', label: '1分' }, { key: '5m', label: '5分' }, { key: '1h', label: '1时' },
    { key: '4h', label: '4时' }, { key: '24h', label: '日线' }, { key: '7d', label: '周线' }, { key: '30d', label: '月线' },
  ];

  const snapshotColumns = [
    { title: '时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    { title: '价格', dataIndex: 'price', key: 'price', render: (v: string) => formatPrice(v) },
    { title: '成交量', dataIndex: 'volume', key: 'volume', render: (v: string) => formatVolume(v) },
    { title: '持有人', dataIndex: 'holders', key: 'holders' },
    { title: '流动性', dataIndex: 'liquidity', key: 'liquidity', render: (v: string) => formatVolume(v) },
    { title: '市值', dataIndex: 'market_cap', key: 'market_cap', render: (v: string) => formatVolume(v) },
  ];

  return (
    <div style={{ overflowY: 'auto', height: 460 }}>
      {/* 顶部信息 */}
      <Card size="small" bodyStyle={{ padding: '8px 12px' }} style={{ marginBottom: 8 }}>
        <Row gutter={12} align="middle">
          <Col>
            <TokenIcon chain={chain} address={address} iconPath={t.icon} symbol={token.symbol} />
          </Col>
          <Col flex="auto">
            <Space size={4}>
              <span style={{ fontSize: 16, fontWeight: 'bold' }}>{parseName()}</span>
              <Tag>{token.symbol}</Tag>
              <Tag>{chainMap[t.chain_id] || t.chain_id}</Tag>
              <Tag color={risk.color}>{risk.label}</Tag>
            </Space>
            <div style={{ marginTop: 4, color: '#8c8c8c', fontSize: 11 }}>合约: {t.contract_address}</div>
            {links.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {links.map((l: any, i: number) => (
                  <Tag key={i} color="blue" style={{ cursor: 'pointer', fontSize: 11 }} onClick={() => window.open(l.link, '_blank')}>{l.label}</Tag>
                ))}
              </div>
            )}
          </Col>
          <Col>
            <Space size={4}>
              <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={async () => {
                setRefreshing(true);
                try {
                  const fresh = await api.get(`/tokens/${chain}/${address}/refresh-onchain`);
                  if (fresh) setToken(fresh as any);
                  message.success('链上数据已刷新');
                } catch { message.error('刷新失败'); }
                finally { setRefreshing(false); }
              }}>刷新</Button>
              <Button type="primary" size="small" icon={<ShoppingCartOutlined />}>买入</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* K线图 */}
      <Card
        title={<span style={{ fontSize: 13 }}>📊 K线图</span>}
        size="small"
        style={{ marginBottom: 8 }}
        bodyStyle={{ padding: '4px 8px' }}
        extra={
          <Space size={2}>
            {klinePeriods.map(p => (
              <Button key={p.key} size="small" type={klinePeriod === p.key ? 'primary' : 'default'} onClick={() => setKlinePeriod(p.key)} style={{ fontSize: 11, padding: '0 4px' }}>{p.label}</Button>
            ))}
          </Space>
        }
      >
        <ReactECharts option={klineOption} style={{ height: 200 }} />
      </Card>

      {/* 基础数据 + 持有人 + 标签审计 */}
      <Row gutter={8} style={{ marginBottom: 8 }}>
        <Col span={8}>
          <Card title="📋 基础" size="small" bodyStyle={{ padding: '4px 8px' }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="价格">{formatPrice(price)}</Descriptions.Item>
              <Descriptions.Item label="1h涨跌">
                <span style={{ color: change1h >= 0 ? '#52c41a' : '#ff4d4f' }}>{formatPercent(change1h)}</span>
              </Descriptions.Item>
              <Descriptions.Item label="24h涨跌">
                <span style={{ color: change24h >= 0 ? '#52c41a' : '#ff4d4f' }}>{formatPercent(change24h)}</span>
              </Descriptions.Item>
              <Descriptions.Item label="成交量">{formatVolume(volume24h)}</Descriptions.Item>
              <Descriptions.Item label="市值">{formatVolume(marketCap)}</Descriptions.Item>
              <Descriptions.Item label="流动性">{formatVolume(liquidity)}</Descriptions.Item>
              <Descriptions.Item label="持有人">{token.holders?.toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="供应量">{formatSupply(t.total_supply)}</Descriptions.Item>
              <Descriptions.Item label="可增发">{t.is_mintable != null ? (t.is_mintable ? '✅' : '❌') : '-'}</Descriptions.Item>
              <Descriptions.Item label="可升级">{t.is_upgradeable != null ? (t.is_upgradeable ? '✅' : '❌') : '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="👥 持有人" size="small" bodyStyle={{ padding: '4px 8px' }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="持有人">{token.holders?.toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="KYC">{t.kyc_holders ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="前10占比">{t.holders_top10_percent ? `${parseFloat(t.holders_top10_percent).toFixed(1)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="聪明钱">{t.smart_money_holding_percent != null ? `${t.smart_money_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="KOL">{t.kol_holding_percent != null ? `${t.kol_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="开发者">{t.dev_holding_percent != null ? `${t.dev_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="24h搜索">{t.search_count_24h ?? '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="🏷️ 标签" size="small" bodyStyle={{ padding: '4px 8px' }}>
            <div style={{ marginBottom: 8 }}>
              {tags.map(tag => <Tag key={tag} style={{ marginBottom: 2, fontSize: 11 }}>{tag}</Tag>)}
              {tags.length === 0 && <span style={{ color: '#8c8c8c' }}>暂无标签</span>}
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <Descriptions column={1} size="small">
              <Descriptions.Item label="验证">{auditDetails.contractVerified}</Descriptions.Item>
              <Descriptions.Item label="所有权">{auditDetails.ownership}</Descriptions.Item>
              <Descriptions.Item label="黑名单">{auditDetails.blacklist}</Descriptions.Item>
              <Descriptions.Item label="貔貅">{auditDetails.honeypot}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* 合约审计 + Smart Money */}
      <Row gutter={8} style={{ marginBottom: 8 }}>
        <Col span={12}>
          <Card title="🔒 合约审计" size="small" bodyStyle={{ padding: '4px 8px' }}>
            {auditData ? (
              <Descriptions column={1} size="small">
                <Descriptions.Item label="风险">
                  <Tag color={auditData.risk_level === 'high' ? 'red' : auditData.risk_level === 'medium' ? 'orange' : 'green'}>{auditData.risk_level || '-'}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="买入税">{auditData.buy_tax != null ? `${auditData.buy_tax}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="卖出税">{auditData.sell_tax != null ? `${auditData.sell_tax}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="蜜罐">{auditData.is_honeypot ? '⚠️ 疑似' : '✅ 安全'}</Descriptions.Item>
                <Descriptions.Item label="恶意函数">{auditData.has_malicious_code ? '⚠️ 检测到' : '✅ 未检测到'}</Descriptions.Item>
                <Descriptions.Item label="验证">{auditData.is_verified ? '✅ 已验证' : '❌ 未验证'}</Descriptions.Item>
                <Descriptions.Item label="所有权放弃">{auditData.is_ownership_renounced ? '✅ 已放弃' : '❌ 未放弃'}</Descriptions.Item>
              </Descriptions>
            ) : (
              <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 20 }}>暂无审计数据</div>
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="🧠 Smart Money" size="small" bodyStyle={{ padding: '4px 8px' }}>
            {dynamicData ? (
              <Descriptions column={1} size="small">
                <Descriptions.Item label="SM持仓">{dynamicData.smart_money_holding_percent != null ? `${dynamicData.smart_money_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="SM数量">{dynamicData.smart_money_count ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="Dev持仓">{dynamicData.dev_holding_percent != null ? `${dynamicData.dev_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="KOL持仓">{dynamicData.kol_holding_percent != null ? `${dynamicData.kol_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="前10占比">{dynamicData.holders_top10_percent != null ? `${parseFloat(dynamicData.holders_top10_percent).toFixed(1)}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="24h交易">{dynamicData.count_24h ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="24h交易者">{dynamicData.unique_trader_24h ?? '-'}</Descriptions.Item>
              </Descriptions>
            ) : (
              <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 20 }}>暂无动态数据</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 快照数据 */}
      <Card title="⏱️ 生命周期快照" size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: '4px 8px' }}>
        {snapshots.length > 0 ? (
          <Table dataSource={snapshots} columns={snapshotColumns} pagination={false} size="small" rowKey="id" />
        ) : (
          <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 20 }}>暂无快照数据</div>
        )}
      </Card>



      {/* 同名检测 */}
      {similarData && (
        <Card title="🔍 同名/跨链检测" size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: '4px 8px' }}>
          <Row gutter={8} style={{ marginBottom: 8 }}>
            <Col span={6}><Statistic title="同名" value={similarData.duplicateCount ?? 0} valueStyle={{ fontSize: 16 }} /></Col>
            <Col span={6}><Statistic title="跨链" value={similarData.crossChain?.length ?? 0} valueStyle={{ fontSize: 16 }} /></Col>
            <Col span={6}>
              <div style={{ color: '#8c8c8c', fontSize: 11 }}>风险</div>
              <Tag color={similarData.riskLevel === 'high' ? 'red' : similarData.riskLevel === 'medium' ? 'orange' : 'green'}>
                {similarData.riskLevel === 'high' ? '高' : similarData.riskLevel === 'medium' ? '中' : '低'}
              </Tag>
            </Col>
            <Col span={6}>
              <div style={{ color: '#8c8c8c', fontSize: 11 }}>跨链项目</div>
              {similarData.isCrossChainProject ? <Tag color="blue">是</Tag> : <Tag>否</Tag>}
            </Col>
          </Row>
          {similarData.riskReasons?.length > 0 && (
            <Alert message={similarData.riskReasons.join('；')} type={similarData.riskLevel === 'high' ? 'error' : similarData.riskLevel === 'medium' ? 'warning' : 'success'} showIcon style={{ marginBottom: 8, fontSize: 11 }} />
          )}
          {similarData.sameName?.length > 0 && (
            <>
              <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 12 }}>同名代币</div>
              <Table
                dataSource={similarData.sameName}
                rowKey={(r: any) => `${r.chain_id}_${r.contract_address}`}
                size="small"
                pagination={false}
                columns={[
                  { title: '链', dataIndex: 'chain_id', key: 'chain_id', render: (v: string) => <Tag>{chainMap[v] || v}</Tag> },
                  { title: '地址', dataIndex: 'contract_address', key: 'contract_address', render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v?.slice(0, 8)}...{v?.slice(-4)}</span> },
                  { title: '首次', dataIndex: 'first_seen_at', key: 'first_seen_at', render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
                ]}
              />
            </>
          )}
          {similarData.sameName?.length === 0 && (
            <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 10 }}>无同名代币</div>
          )}
        </Card>
      )}

      {/* 地址风险 */}
      {addressRisk && (
        <Card title="🏦 地址风险" size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: '4px 8px' }}>
          <Row gutter={8}>
            <Col span={6}>
              <div style={{ color: '#8c8c8c', fontSize: 11 }}>评分</div>
              <Progress
                percent={Math.max(0, Math.min(100, ((addressRisk.score || 0) + 10) * 4))}
                strokeColor={(addressRisk.score || 0) >= 8 ? '#52c41a' : (addressRisk.score || 0) >= 4 ? '#faad14' : '#ff4d4f'}
                format={() => `${addressRisk.score ?? 0}`}
                size="small"
              />
            </Col>
            <Col span={6}><Statistic title="数据点" value={addressRisk.dataPoints ?? 0} suffix="/5" valueStyle={{ fontSize: 16 }} /></Col>
            <Col span={6}>
              <div style={{ color: '#8c8c8c', fontSize: 11 }}>风险</div>
              <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>{addressRisk.riskFlags?.length ?? 0}</span>
            </Col>
            <Col span={6}>
              <div style={{ color: '#8c8c8c', fontSize: 11 }}>亮点</div>
              <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{addressRisk.highlights?.length ?? 0}</span>
            </Col>
          </Row>
          <Row gutter={8} style={{ marginTop: 8 }}>
            {addressRisk.riskFlags?.length > 0 && (
              <Col span={12}>
                <div style={{ fontWeight: 'bold', color: '#ff4d4f', marginBottom: 2, fontSize: 12 }}>⚠️ 风险</div>
                {addressRisk.riskFlags.map((f: string, i: number) => <Tag key={i} color="red" style={{ marginBottom: 2, fontSize: 11 }}>{f}</Tag>)}
              </Col>
            )}
            {addressRisk.highlights?.length > 0 && (
              <Col span={12}>
                <div style={{ fontWeight: 'bold', color: '#52c41a', marginBottom: 2, fontSize: 12 }}>✅ 亮点</div>
                {addressRisk.highlights.map((h: string, i: number) => <Tag key={i} color="green" style={{ marginBottom: 2, fontSize: 11 }}>{h}</Tag>)}
              </Col>
            )}
          </Row>
        </Card>
      )}

    </div>
  );
};

const Dashboard: React.FC = () => {
  const [autoMode, setAutoMode] = useState(false);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [filters, setFilters] = useState<FilterParams>({});
  const [filterForm] = Form.useForm();
  const [sortField, setSortField] = useState<string>('first_seen_at');
  const [sortOrder, setSortOrder] = useState<string>('desc');
  const [coinType, setCoinType] = useState<string>('all');
  const [pnlCurveData, setPnlCurveData] = useState<{ date: string; value: number }[]>([]);
  const [selectedToken, setSelectedToken] = useState<{ chain: string; address: string; symbol: string; creatorAddress?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Tab1');

  // 加载统计数据
  const loadStats = useCallback(async () => {
    try {
      const data = await statsApi.get();
      setStats(data as any);
    } catch { /* 静默 */ }
  }, []);

  // 加载代币列表（带筛选+排序）
  const loadTokens = useCallback(async (page = 1, pageSize = 20, filterParams?: FilterParams, sortBy?: string, sortOrd?: string) => {
    setLoading(true);
    try {
      const params: any = { page, pageSize, ...filterParams, sortBy: sortBy || sortField, sortOrder: sortOrd || sortOrder };
      // 清理空值
      Object.keys(params).forEach(k => {
        if (params[k] === undefined || params[k] === '' || params[k] === null) delete params[k];
      });
      const res = await tokenApi.getList(params);
      const data = res as any;
      setTokens(data?.data || []);
      setPagination({ page, pageSize, total: data?.total || 0 });
    } catch {
      message.error('加载代币列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 排序字段映射：前端列key → 后端sortBy
  const SORT_FIELD_MAP: Record<string, string> = {
    price: 'price_latest',
    change_1h: 'percent_change_1h',
    volume_24h: 'volume_24h',
    liquidity: 'liquidity',
    holders: 'holders',
    launch_time: 'launch_time',
    dev_migrated_percent: 'dev_migrated_percent',
  };

  // 应用筛选
  const handleFilter = () => {
    const values = filterForm.getFieldsValue();
    const params: FilterParams = {};
    if (values.chain && values.chain !== 'all') params.chain = values.chain;
    if (values.launch_within && values.launch_within !== 'all') params.launch_within = values.launch_within;
    if (values.creator?.trim()) params.creator = values.creator.trim();
    if (values.risk_level && values.risk_level !== 'all') params.risk_level = values.risk_level;
    if (values.holders_min != null) params.holders_min = values.holders_min;
    if (values.holders_max != null) params.holders_max = values.holders_max;
    if (values.liquidity_min != null) params.liquidity_min = values.liquidity_min;
    if (values.liquidity_max != null) params.liquidity_max = values.liquidity_max;
    if (coinType === 'new') params.is_new_coin = 1;
    setFilters(params);
    loadTokens(1, pagination.pageSize, params);
  };

  // 重置筛选+排序
  const handleReset = () => {
    filterForm.resetFields();
    setFilters({});
    setCoinType('all');
    setSortField('first_seen_at');
    setSortOrder('desc');
    loadTokens(1, pagination.pageSize, {}, 'first_seen_at', 'desc');
  };

  // 快速切换 新币/热门/全部
  const handleCoinTypeChange = (val: string) => {
    setCoinType(val);
    const values = filterForm.getFieldsValue();
    const params: FilterParams = {};
    if (values.chain && values.chain !== 'all') params.chain = values.chain;
    if (values.launch_within && values.launch_within !== 'all') params.launch_within = values.launch_within;
    if (values.creator?.trim()) params.creator = values.creator.trim();
    if (values.risk_level && values.risk_level !== 'all') params.risk_level = values.risk_level;
    if (values.holders_min != null) params.holders_min = values.holders_min;
    if (values.holders_max != null) params.holders_max = values.holders_max;
    if (values.liquidity_min != null) params.liquidity_min = values.liquidity_min;
    if (values.liquidity_max != null) params.liquidity_max = values.liquidity_max;
    if (val === 'new') params.is_new_coin = 1;
    setFilters(params);
    loadTokens(1, pagination.pageSize, params);
  };

  // 表格排序变化
  const handleTableChange = (_pagination: any, _filters: any, sorter: any) => {
    if (sorter.field && SORT_FIELD_MAP[sorter.field]) {
      const field = SORT_FIELD_MAP[sorter.field];
      const order = sorter.order === 'ascend' ? 'asc' : sorter.order === 'descend' ? 'desc' : 'desc';
      setSortField(field);
      setSortOrder(order);
      loadTokens(pagination.page, pagination.pageSize, filters, field, order);
    } else {
      // 取消排序，回到默认
      setSortField('first_seen_at');
      setSortOrder('desc');
      loadTokens(pagination.page, pagination.pageSize, filters, 'first_seen_at', 'desc');
    }
  };

  // 加载收益曲线数据
  const loadPnlCurve = useCallback(async () => {
    try {
      const res = await simApi.getDailyPnl(30);
      const data = (res as any) || [];
      setPnlCurveData(data.map((d: any) => ({ date: d.date, value: d.totalValue })));
    } catch { /* 静默 */ }
  }, []);

  // SSE + 初始加载 + 自动重连 + 轮询兜底
  useEffect(() => {
    loadStats();
    loadTokens();
    loadPnlCurve();

    let es: EventSource | null = null;
    let retryDelay = 2000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        es = createNewTokenSSE();
        es.onopen = () => {
          setSseConnected(true);
          retryDelay = 2000; // 连接成功，重置退避
        };
        es.onerror = () => {
          setSseConnected(false);
          es?.close();
          // 指数退避重连：2s → 4s → 8s → 16s，最大 30s
          if (!closed) {
            retryTimer = setTimeout(() => {
              connect();
            }, Math.min(retryDelay, 30000));
            retryDelay = Math.min(retryDelay * 2, 30000);
          }
        };
        es.onmessage = (e) => {
          try {
            JSON.parse(e.data);
            if (Object.keys(filters).length === 0) {
              loadTokens(pagination.page, pagination.pageSize, filters);
            }
            loadStats();
          } catch { /* ignore */ }
        };
      } catch { /* SSE 不可用 */ }
    };

    connect();

    // 兜底轮询：每 30 秒刷新统计数据
    pollTimer = setInterval(() => {
      loadStats();
    }, 30000);

    return () => {
      closed = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 解析 token_tag
  const parseTags = (token: Token): string[] => {
    try {
      if (!token.token_tag) return [];
      const obj = JSON.parse(token.token_tag);
      const tags: string[] = [];
      Object.values(obj).forEach((arr: any) => {
        if (Array.isArray(arr)) arr.forEach((t: any) => tags.push(t.tagName));
      });
      return tags;
    } catch { return []; }
  };

  // 解析 audit_info
  const parseRisk = (token: Token): { label: string; color: string } => {
    try {
      if (!token.audit_info) return { label: '未知', color: 'default' };
      const info = JSON.parse(token.audit_info);
      const map: Record<number, { label: string; color: string }> = {
        0: { label: '低风险', color: 'green' },
        1: { label: '低风险', color: 'green' },
        2: { label: '中风险', color: 'orange' },
        3: { label: '高风险', color: 'red' },
      };
      return map[info.riskLevel] ?? { label: '未知', color: 'default' };
    } catch { return { label: '未知', color: 'default' }; }
  };

  // 解析 meta_info
  const parseName = (token: Token): string => {
    try {
      if (!token.meta_info) return token.symbol;
      const info = JSON.parse(token.meta_info);
      return info.name || info.originName || token.symbol;
    } catch { return token.symbol; }
  };

  // 收益曲线（真实数据）
  const curveOption = {
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: any) => {
        const d = params[0];
        return `${d.axisValue}<br/>组合价值: $${d.value?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      },
    },
    xAxis: { type: 'category' as const, data: pnlCurveData.map(d => d.date) },
    yAxis: { type: 'value' as const, axisLabel: { formatter: '${value}' } },
    series: [{
      data: pnlCurveData.map(d => d.value),
      type: 'line',
      smooth: true,
      areaStyle: { opacity: 0.3 },
      itemStyle: { color: '#1890ff' },
    }],
    grid: { left: 80, right: 20, top: 20, bottom: 30 },
  };

  // 表格列
  const tokenColumns = [
    {
      title: '代币',
      key: 'symbol',
      width: 200,
      render: (_: any, record: Token) => (
        <Space>
          <TokenIcon
            chain={record.chain_id}
            address={record.contract_address}
            iconPath={record.icon}
            symbol={record.symbol}
          />
          <span style={{ fontWeight: 'bold' }}>{record.symbol}</span>
          <span style={{ color: '#8c8c8c', fontSize: 12, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{parseName(record)}</span>
        </Space>
      ),
    },
    {
      title: '链',
      dataIndex: 'chain_id',
      key: 'chain_id',
      width: 80,
      render: (v: string) => {
        const chainMap: Record<string, string> = { '56': 'BSC', 'CT_501': 'SOL', '1': 'ETH', '8453': 'Base' };
        return <Tag>{chainMap[v] || v}</Tag>;
      },
    },
    {
      title: '价格',
      key: 'price',
      dataIndex: 'price_latest',
      width: 120,
      sorter: true,
      sortOrder: sortField === 'price_latest' ? (sortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (_: any, record: Token) => formatPrice(record.price_latest),
    },
    {
      title: '1h涨跌',
      key: 'change_1h',
      dataIndex: 'percent_change_1h',
      width: 100,
      sorter: true,
      defaultSortOrder: 'descend' as const,
      sortOrder: sortField === 'percent_change_1h' ? (sortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (_: any, record: Token) => {
        const v = parseFloat(record.percent_change_1h);
        return (
          <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {formatPercent(v)}
          </span>
        );
      },
    },
    {
      title: '24h成交量',
      key: 'volume_24h',
      dataIndex: 'volume_24h',
      width: 120,
      sorter: true,
      sortOrder: sortField === 'volume_24h' ? (sortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (_: any, record: Token) => formatVolume(record.volume_24h),
    },
    {
      title: '流动性',
      key: 'liquidity',
      dataIndex: 'liquidity',
      width: 100,
      sorter: true,
      sortOrder: sortField === 'liquidity' ? (sortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (_: any, record: Token) => formatVolume(record.liquidity),
    },
    {
      title: '持有人',
      dataIndex: 'holders',
      key: 'holders',
      width: 80,
      sorter: true,
      sortOrder: sortField === 'holders' ? (sortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
    },
    {
      title: '总供应量',
      key: 'total_supply',
      width: 120,
      hidden: true,
      render: (_: any, record: Token) => formatSupply((record as any).total_supply),
    },
    {
      title: '销毁量',
      key: 'burned_amount',
      width: 100,
      hidden: true,
      render: (_: any, record: Token) => formatSupply((record as any).burned_amount),
    },
    {
      title: '流通量',
      key: 'circulating_supply',
      width: 120,
      hidden: true,
      render: (_: any, record: Token) => formatSupply((record as any).circulating_supply),
    },
    {
      title: '标签',
      key: 'tags',
      width: 200,
      render: (_: any, record: Token) => (
        <Space size={2} style={{ whiteSpace: 'nowrap' }}>
          {parseTags(record).slice(0, 3).map(tag => (
            <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '发行方',
      key: 'creator_address',
      dataIndex: 'creator_address',
      width: 130,
      ellipsis: true,
      render: (v: string) => {
        if (!v) return '-';
        const short = `${v.slice(0, 6)}...${v.slice(-4)}`;
        return (
          <span
            title={v}
            style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(v);
              message.success('已复制地址');
            }}
          >
            {short}
          </span>
        );
      },
    },
    {
      title: '迁移状态',
      key: 'dev_migrated_percent',
      width: 130,
      sorter: true,
      sortOrder: sortField === 'dev_migrated_percent' ? (sortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (_: any, record: Token) => {
        const r = record as any;
        const pct = r.dev_migrated_percent != null ? parseFloat(r.dev_migrated_percent) : null;
        const total = r.dev_tokens;
        const migrated = r.dev_migrated;
        if (pct == null && !total) return '-';
        const val = pct ?? 0;
        const color = val >= 100 ? '#52c41a' : val >= 50 ? '#faad14' : '#ff4d4f';
        return (
          <div>
            <Progress
              percent={val}
              size="small"
              strokeColor={color}
              format={() => `${val.toFixed(0)}%`}
            />
            {total != null && (
              <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                {migrated ?? 0}/{total} 已迁移
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '风险',
      key: 'risk',
      width: 80,
      render: (_: any, record: Token) => {
        const r = parseRisk(record);
        return <Tag color={r.color}>{r.label}</Tag>;
      },
    },
    {
      title: '发行时间',
      key: 'launch_time',
      dataIndex: 'launch_time',
      width: 140,
      sorter: true,
      defaultSortOrder: 'descend' as const,
      sortOrder: sortField === 'launch_time' ? (sortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (_: any, record: Token) => {
        if (!record.launch_time) return '-';
        const d = new Date(record.launch_time);
        const now = Date.now();
        const diff = now - record.launch_time;
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
        return d.toLocaleDateString();
      },
    },
  ];

  return (
    <div>
      {/* 统计 + 收益曲线：左右布局 */}
      <Row gutter={16} style={{ marginBottom: 4 }}>
        <Col span={6}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 上方三个统计卡片水平排列，总宽度与下方AI辅助一致 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <Card size="small" style={{ flex: 1, minWidth: 0 }} bodyStyle={{ padding: '8px 10px' }}>
                <Statistic title="代币" value={stats?.totalTokens ?? '-'} prefix={<WalletOutlined />} loading={!stats} valueStyle={{ fontSize: 14 }} />
              </Card>
              <Card size="small" style={{ flex: 1, minWidth: 0 }} bodyStyle={{ padding: '8px 10px' }}>
                <Statistic title="新增" value={stats?.todayNewTokens ?? '-'} prefix={<FundOutlined />} valueStyle={{ color: '#1890ff', fontSize: 14 }} loading={!stats} />
              </Card>
              <Card size="small" style={{ flex: 1, minWidth: 0 }} bodyStyle={{ padding: '8px 10px' }}>
                <Statistic title="话题" value={stats?.totalSocialTopics ?? '-'} prefix={<ThunderboltOutlined />} valueStyle={{ fontSize: 14 }} loading={!stats} />
              </Card>
            </div>
            {/* 下方AI辅助单独一行 */}
            <Card size="small" bodyStyle={{ padding: '8px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: '#8c8c8c', marginBottom: 4, fontSize: 12 }}>交易模式</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold' }}>{autoMode ? '🤖 AI全自动' : '👤 AI辅助'}</div>
                </div>
                <Switch checked={autoMode} onChange={setAutoMode} checkedChildren="自动" unCheckedChildren="手动" size="small" />
              </div>
            </Card>
          </div>
        </Col>
        <Col span={18}>
          <Card title="📈 组合收益曲线" size="small" style={{ height: '100%' }}>
            <ReactECharts option={curveOption} style={{ height: 160 }} />
          </Card>
        </Col>
      </Row>

      {/* 筛选区域 */}
      <Card
        size="small"
        style={{ marginBottom: 4 }}
        bodyStyle={{ padding: '4px 8px' }}
      >
        <div style={{ fontSize: 10, whiteSpace: 'nowrap', lineHeight: 1 }}>
          <Form form={filterForm} layout="inline" size="small" style={{ flexWrap: 'wrap', gap: '1px 2px' }}>
            <Form.Item style={{ marginBottom: 0 }}>
              <Segmented
                value={coinType}
                onChange={(val) => handleCoinTypeChange(val as string)}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '🆕 新币', value: 'new' },
                  { label: '🔥 热门', value: 'trending' },
                ]}
              />
            </Form.Item>
            <Form.Item label="所属链" name="chain" initialValue="all" style={{ marginBottom: 0 }}>
              <Select size="small" style={{ width: 80 }}>
                <Select.Option value="all">全部</Select.Option>
                <Select.Option value="56">BSC</Select.Option>
                <Select.Option value="CT_501">SOL</Select.Option>
                <Select.Option value="8453">Base</Select.Option>
                <Select.Option value="1">ETH</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item label="发行" name="launch_within" initialValue="all" style={{ marginBottom: 0 }}>
              <Select size="small" style={{ width: 90 }}>
                <Select.Option value="all">全部</Select.Option>
                <Select.Option value="1h">1小时</Select.Option>
                <Select.Option value="6h">6小时</Select.Option>
                <Select.Option value="24h">24小时</Select.Option>
                <Select.Option value="3d">3天</Select.Option>
                <Select.Option value="7d">7天</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item label="风险" name="risk_level" initialValue="all" style={{ marginBottom: 0 }}>
              <Select size="small" style={{ width: 70 }}>
                <Select.Option value="all">全部</Select.Option>
                <Select.Option value="low">低</Select.Option>
                <Select.Option value="medium">中</Select.Option>
                <Select.Option value="high">高</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item label="审计" name="audit_risk" initialValue="all" style={{ marginBottom: 0 }}>
              <Select size="small" style={{ width: 70 }}>
                <Select.Option value="all">全部</Select.Option>
                <Select.Option value="safe">安全</Select.Option>
                <Select.Option value="warning">警告</Select.Option>
                <Select.Option value="danger">危险</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item label="发行方" name="creator" style={{ marginBottom: 0 }}>
              <Input size="small" placeholder="地址" style={{ width: 120 }} allowClear />
            </Form.Item>
            <Form.Item label="持有人" style={{ marginBottom: 0 }}>
              <Space size={2}>
                <Form.Item name="holders_min" noStyle>
                  <InputNumber size="small" placeholder="最小" style={{ width: 60 }} min={0} />
                </Form.Item>
                <span>~</span>
                <Form.Item name="holders_max" noStyle>
                  <InputNumber size="small" placeholder="最大" style={{ width: 60 }} min={0} />
                </Form.Item>
              </Space>
            </Form.Item>
            <Form.Item label="流动性" style={{ marginBottom: 0 }}>
              <Space size={2}>
                <Form.Item name="liquidity_min" noStyle>
                  <InputNumber size="small" placeholder="最小" style={{ width: 70 }} min={0} />
                </Form.Item>
                <span>~</span>
                <Form.Item name="liquidity_max" noStyle>
                  <InputNumber size="small" placeholder="最大" style={{ width: 70 }} min={0} />
                </Form.Item>
              </Space>
            </Form.Item>
            <Form.Item style={{ marginBottom: 0, marginLeft: 'auto' }}>
              <Space size={4}>
                <Button type="primary" size="small" icon={<FilterOutlined />} onClick={handleFilter}>查询</Button>
                <Button size="small" icon={<ClearOutlined />} onClick={handleReset}>重置</Button>
              </Space>
            </Form.Item>
          </Form>
        </div>
      </Card>

      {/* 代币表格 + 右侧标签页 */}
      <Row gutter={16}>
        <Col span={16}>
          <Card
            title={
              <Space>
                <ThunderboltOutlined />
                Web3 代币信息
                {sseConnected && <Badge status="processing" text="SSE 已连接" />}
                {!sseConnected && <Badge status="default" text="SSE 未连接" />}
                {Object.keys(filters).length > 0 && (
                  <Tag color="blue">已筛选</Tag>
                )}
              </Space>
            }
            size="small"
            extra={
              <Space>
                <span style={{ color: '#8c8c8c', fontSize: 12 }}>共 {pagination.total} 个代币</span>
                <SyncOutlined spin={loading} style={{ cursor: 'pointer' }} onClick={() => { loadTokens(pagination.page, pagination.pageSize, filters); loadStats(); }} />
              </Space>
            }
            bodyStyle={{ padding: '2px 4px' }}
          >
            <Spin spinning={loading}>
              <Table
                dataSource={tokens}
                columns={tokenColumns}
                rowKey="id"
                size="small"
                className="ultra-compact-table"
                onChange={handleTableChange}
                pagination={{
                  current: pagination.page,
                  pageSize: pagination.pageSize,
                  total: pagination.total,
                  showSizeChanger: true,
                  showTotal: (t) => `共 ${t} 个`,
                  onChange: (page, pageSize) => loadTokens(page, pageSize, filters),
                }}
                onRow={(record) => ({
                  onClick: () => {
                    setSelectedToken({ chain: record.chain_id, address: record.contract_address, symbol: record.symbol, creatorAddress: record.creator_address });
                  },
                  style: { cursor: 'pointer' },
                })}
                scroll={{ x: 1300, y: 420 }}
              />
            </Spin>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '8px 12px' }} style={{ height: '100%' }}>
            <Tabs
              size="small"
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'Tab1',
                  label: '发行方',
                  children: <div style={{ overflowY: 'auto', height: 460 }}>
                    {selectedToken?.creatorAddress
                      ? <IssuerProfile creatorAddress={selectedToken.creatorAddress} />
                      : <div style={{ padding: '40px 0', color: '#8c8c8c', textAlign: 'center' }}>请点击左侧代币查看发行方画像</div>}
                  </div>,
                },
                {
                  key: 'Tab2',
                  label: '综合评分',
                  children: <div style={{ overflowY: 'auto', height: 460 }}>
                    {selectedToken
                      ? <AgentScorePanel chain={selectedToken.chain} address={selectedToken.address} />
                      : <div style={{ padding: '40px 0', color: '#8c8c8c', textAlign: 'center' }}>请点击左侧代币查看综合评分</div>}
                  </div>,
                },
                {
                  key: 'Tab3',
                  label: 'Tab3',
                  children: <div style={{ padding: '8px 0', color: '#8c8c8c', textAlign: 'center' }}>待陈哥指定内容</div>,
                },
                {
                  key: 'Tab4',
                  label: `代币详情${selectedToken ? ` (${selectedToken.symbol})` : ''}`,
                  children: selectedToken
                    ? <TokenQuickView chain={selectedToken.chain} address={selectedToken.address} />
                    : <div style={{ padding: '40px 0', color: '#8c8c8c', textAlign: 'center' }}>请点击左侧代币查看详情</div>,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
