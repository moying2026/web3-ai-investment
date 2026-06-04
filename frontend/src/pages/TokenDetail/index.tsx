import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Row, Col, Card, Tag, Descriptions, Button, Space, Table, Divider, Spin, message, Statistic, Progress } from 'antd';
import { ShoppingCartOutlined, ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import type { Token, Snapshot } from '../../types';
import api, { tokenApi, auditApi, dynamicApi } from '../../services/api';
import { formatPrice, formatVolume, formatSupply, formatPercent } from '../../utils/format';

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

const TokenDetail: React.FC = () => {
  const { chain, address } = useParams<{ chain: string; address: string }>();
  const navigate = useNavigate();
  const [token, setToken] = useState<Token | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [issuer, setIssuer] = useState<any>(null);
  const [klinePeriod, setKlinePeriod] = useState<string>('1h');
  const [auditData, setAuditData] = useState<any>(null);
  const [dynamicData, setDynamicData] = useState<any>(null);

  useEffect(() => {
    if (!chain || !address) return;
    setLoading(true);
    setIssuer(null);
    Promise.all([
      tokenApi.getDetail(chain, address).catch(() => null),
      tokenApi.getSnapshots(chain, address).catch(() => []),
    ]).then(([tokenData, snapData]) => {
      if (tokenData) setToken(tokenData as any);
      setSnapshots((snapData as any) || []);
    }).finally(() => setLoading(false));
  }, [chain, address]);

  // 加载发行方数据
  useEffect(() => {
    const creatorAddr = (token as any)?.creator_address;
    if (!creatorAddr) return;
    api.get(`/issuers/${creatorAddr}`)
      .then(data => setIssuer(data))
      .catch(() => {});
  }, [(token as any)?.creator_address]);

  // 加载审计和动态数据
  useEffect(() => {
    if (!chain || !address) return;
    auditApi.get(chain, address).then(data => setAuditData(data)).catch(() => {});
    dynamicApi.get(chain, address).then(data => setDynamicData(data)).catch(() => {});
  }, [chain, address]);

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  if (!token) {
    return <div style={{ textAlign: 'center', padding: 100, fontSize: 16 }}>代币未找到</div>;
  }

  // 解析价格和数据
  const price = parseFloat(token.price_latest) || 0;
  const change1h = parseFloat(token.percent_change_1h) || 0;
  const change24h = parseFloat(token.percent_change_24h) || 0;
  const volume24h = parseFloat(token.volume_24h) || 0;
  const liquidity = parseFloat(token.liquidity) || 0;
  const marketCap = parseFloat(token.market_cap) || 0;
  const t = token as any;

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
      Object.values(obj).forEach((arr: any) => {
        if (Array.isArray(arr)) arr.forEach((item: any) => tags.push(item.tagName));
      });
      return tags;
    } catch { return []; }
  };

  const parseRisk = (): { label: string; color: string } => {
    try {
      if (!t.audit_info) return { label: '未知', color: 'default' };
      const info = JSON.parse(t.audit_info);
      const map: Record<number, { label: string; color: string }> = {
        0: { label: '低风险', color: 'green' },
        1: { label: '低风险', color: 'green' },
        2: { label: '中风险', color: 'orange' },
        3: { label: '高风险', color: 'red' },
      };
      return map[info.riskLevel] ?? { label: '未知', color: 'default' };
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

  // K线图 mock 数据
  const klineData = generateKlineData(klinePeriod, price);
  const timeLabels = klineData.map(d => {
    const date = new Date(d.time);
    if (['1m', '5m'].includes(klinePeriod)) return date.toLocaleTimeString();
    if (['1h', '4h'].includes(klinePeriod)) return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const klineOption = {
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'cross' as const },
    },
    xAxis: {
      type: 'category' as const,
      data: timeLabels,
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'value' as const,
      scale: true,
      axisLabel: { formatter: (v: number) => {
        if (v === 0) return '0';
        if (Math.abs(v) < 1) {
          const s = Math.abs(v).toFixed(20).replace(/0+$/, '');
          const dec = (s.split('.')[1] || '').length;
          return v.toFixed(Math.min(18, Math.max(8, dec)));
        }
        if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
        return v.toFixed(2);
      } },
    },
    dataZoom: [
      { type: 'inside' as const, start: 60, end: 100 },
      { type: 'slider' as const, start: 60, end: 100, height: 20, bottom: 5 },
    ],
    series: [{
      name: 'K线',
      type: 'candlestick' as const,
      data: klineData.map(d => [d.open, d.close, d.low, d.high]),
      itemStyle: {
        color: '#ef5350',
        color0: '#26a69a',
        borderColor: '#ef5350',
        borderColor0: '#26a69a',
      },
    }],
    grid: { left: 60, right: 60, top: 20, bottom: 40 },
  };

  // 快照表格列
  const snapshotColumns = [
    { title: '时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    { title: '价格', dataIndex: 'price', key: 'price', render: (v: string) => formatPrice(v) },
    { title: '成交量', dataIndex: 'volume', key: 'volume', render: (v: string) => formatVolume(v) },
    { title: '持有人', dataIndex: 'holders', key: 'holders' },
    { title: '流动性', dataIndex: 'liquidity', key: 'liquidity', render: (v: string) => formatVolume(v) },
    { title: '市值', dataIndex: 'market_cap', key: 'market_cap', render: (v: string) => formatVolume(v) },
  ];

  const chainMap: Record<string, string> = { '56': 'BSC', 'CT_501': 'SOL', '1': 'ETH', '8453': 'Base' };
  const klinePeriods = [
    { key: '1m', label: '1分' }, { key: '5m', label: '5分' }, { key: '1h', label: '1时' },
    { key: '4h', label: '4时' }, { key: '24h', label: '日线' }, { key: '7d', label: '周线' }, { key: '30d', label: '月线' },
  ];

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>返回</Button>

      {/* 顶部信息 */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24} align="middle">
          <Col>
            <div style={{ position: 'relative', width: 48, height: 48 }}>
              {t.icon && (
                <img
                  src={`https://www.binance.com${t.icon}`}
                  alt=""
                  style={{ width: 48, height: 48, borderRadius: '50%', position: 'absolute' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div style={{
                width: 48, height: 48, borderRadius: '50%', background: '#1890ff', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, fontWeight: 'bold',
              }}>
                {token.symbol?.charAt(0) || '?'}
              </div>
            </div>
          </Col>
          <Col flex="auto">
            <Space size="middle">
              <span style={{ fontSize: 24, fontWeight: 'bold' }}>{parseName()}</span>
              <Tag>{token.symbol}</Tag>
              <Tag>{chainMap[t.chain_id] || t.chain_id}</Tag>
              <Tag color={risk.color}>{risk.label}</Tag>
            </Space>
            <div style={{ marginTop: 8, color: '#8c8c8c' }}>合约: {t.contract_address}</div>
            {links.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {links.map((l: any, i: number) => (
                  <Tag key={i} color="blue" style={{ cursor: 'pointer' }} onClick={() => window.open(l.link, '_blank')}>{l.label}</Tag>
                ))}
              </div>
            )}
          </Col>
          <Col>
            <Space>
              <Button
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={async () => {
                  if (!chain || !address) return;
                  setRefreshing(true);
                  try {
                    const fresh = await api.get(`/tokens/${chain}/${address}/refresh-onchain`);
                    if (fresh) setToken(fresh as any);
                    message.success('链上数据已刷新');
                  } catch { message.error('刷新失败'); }
                  finally { setRefreshing(false); }
                }}
              >刷新链上数据</Button>
              <Button type="primary" icon={<ShoppingCartOutlined />} size="large">买入</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* K线图 */}
      <Card
        title="📊 K线图"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Space size={4}>
            {klinePeriods.map(p => (
              <Button key={p.key} size="small" type={klinePeriod === p.key ? 'primary' : 'default'} onClick={() => setKlinePeriod(p.key)}>
                {p.label}
              </Button>
            ))}
          </Space>
        }
      >
        <ReactECharts option={klineOption} style={{ height: 400 }} />
      </Card>

      {/* 详细信息 */}
      <Row gutter={16}>
        <Col span={8}>
          <Card title="📋 基础数据" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="当前价格">{formatPrice(price)}</Descriptions.Item>
              <Descriptions.Item label="首笔价格">{formatPrice(t.price_first)}</Descriptions.Item>
              <Descriptions.Item label="1h涨跌">
                <span style={{ color: change1h >= 0 ? '#52c41a' : '#ff4d4f' }}>{formatPercent(change1h)}</span>
              </Descriptions.Item>
              <Descriptions.Item label="24h涨跌">
                <span style={{ color: change24h >= 0 ? '#52c41a' : '#ff4d4f' }}>{formatPercent(change24h)}</span>
              </Descriptions.Item>
              <Descriptions.Item label="24h成交量">{formatVolume(volume24h)}</Descriptions.Item>
              <Descriptions.Item label="市值">{formatVolume(marketCap)}</Descriptions.Item>
              <Descriptions.Item label="流动性">{formatVolume(liquidity)}</Descriptions.Item>
              <Descriptions.Item label="持有人">{token.holders?.toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="总供应量">{formatSupply(t.total_supply)}</Descriptions.Item>
              <Descriptions.Item label="销毁量">{formatSupply(t.burned_amount)}</Descriptions.Item>
              <Descriptions.Item label="流通量">{formatSupply(t.circulating_supply)}</Descriptions.Item>
              <Descriptions.Item label="最大供应量">{formatSupply(t.max_supply)}</Descriptions.Item>
              <Descriptions.Item label="可增发">{t.is_mintable != null ? (t.is_mintable ? '✅ 是' : '❌ 否') : '-'}</Descriptions.Item>
              <Descriptions.Item label="可升级">{t.is_upgradeable != null ? (t.is_upgradeable ? '✅ 是' : '❌ 否') : '-'}</Descriptions.Item>
              <Descriptions.Item label="合约分析">{t.contract_analysis || '-'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{t.launch_time ? new Date(t.launch_time).toLocaleString() : t.created_at}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="👥 持有人分析" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="持有人数量">{token.holders?.toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="KYC持有人">{t.kyc_holders ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="前10持仓占比">{t.holders_top10_percent ? `${parseFloat(t.holders_top10_percent).toFixed(1)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="聪明钱持仓">{t.smart_money_holding_percent != null ? `${t.smart_money_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="KOL持仓">{t.kol_holding_percent != null ? `${t.kol_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="开发者持仓">{t.dev_holding_percent != null ? `${t.dev_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="24h搜索量">{t.search_count_24h ?? '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="🏷️ 标签审计" size="small">
            <div style={{ marginBottom: 12 }}>
              {tags.map(tag => <Tag key={tag} style={{ marginBottom: 4 }}>{tag}</Tag>)}
              {tags.length === 0 && <span style={{ color: '#8c8c8c' }}>暂无标签</span>}
            </div>
            <Divider style={{ margin: '12px 0' }} />
            <Descriptions column={1} size="small">
              <Descriptions.Item label="合约验证">{auditDetails.contractVerified}</Descriptions.Item>
              <Descriptions.Item label="所有权">{auditDetails.ownership}</Descriptions.Item>
              <Descriptions.Item label="黑名单">{auditDetails.blacklist}</Descriptions.Item>
              <Descriptions.Item label="貔貅检测">{auditDetails.honeypot}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* 合约审计 + Smart Money */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card title="🔒 合约审计" size="small">
            {auditData ? (
              <Descriptions column={1} size="small">
                <Descriptions.Item label="风险等级">
                  <Tag color={auditData.risk_level === 'high' ? 'red' : auditData.risk_level === 'medium' ? 'orange' : 'green'}>
                    {auditData.risk_level || auditData.riskLevel || '-'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="买入税率">{auditData.buy_tax != null ? `${auditData.buy_tax}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="卖出税率">{auditData.sell_tax != null ? `${auditData.sell_tax}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="蜜罐检测">{auditData.is_honeypot ? '⚠️ 疑似蜜罐' : '✅ 安全'}</Descriptions.Item>
                <Descriptions.Item label="恶意函数">{auditData.has_malicious_code ? '⚠️ 检测到' : '✅ 未检测到'}</Descriptions.Item>
                <Descriptions.Item label="合约验证">{auditData.is_verified ? '✅ 已验证' : '❌ 未验证'}</Descriptions.Item>
                <Descriptions.Item label="所有权放弃">{auditData.is_ownership_renounced ? '✅ 已放弃' : '❌ 未放弃'}</Descriptions.Item>
              </Descriptions>
            ) : (
              <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 30 }}>暂无审计数据</div>
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="🧠 Smart Money / Dev 持仓" size="small">
            {dynamicData ? (
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Smart Money 持仓">{dynamicData.smart_money_holding_percent != null ? `${dynamicData.smart_money_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="Smart Money 数量">{dynamicData.smart_money_count ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="Dev 持仓">{dynamicData.dev_holding_percent != null ? `${dynamicData.dev_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="KOL 持仓">{dynamicData.kol_holding_percent != null ? `${dynamicData.kol_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="前10持仓占比">{dynamicData.holders_top10_percent != null ? `${parseFloat(dynamicData.holders_top10_percent).toFixed(1)}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="24h交易笔数">{dynamicData.count_24h ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="24h独立交易者">{dynamicData.unique_trader_24h ?? '-'}</Descriptions.Item>
              </Descriptions>
            ) : (
              <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 30 }}>暂无动态数据</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 快照数据 */}
      <Card title="⏱️ 生命周期快照" size="small" style={{ marginTop: 16 }}>
        {snapshots.length > 0 ? (
          <Table dataSource={snapshots} columns={snapshotColumns} pagination={false} size="small" rowKey="id" />
        ) : (
          <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 40 }}>暂无快照数据</div>
        )}
      </Card>

      {/* 发行方画像 */}
      {issuer && (
        <Card title="👤 发行方画像" size="small" style={{ marginTop: 16 }}>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}><Statistic title="总代币数" value={issuer.total_tokens ?? 0} /></Col>
            <Col span={6}><Statistic title="存活" value={issuer.alive_tokens ?? 0} valueStyle={{ color: '#52c41a' }} /></Col>
            <Col span={6}><Statistic title="已死亡" value={issuer.dead_tokens ?? 0} valueStyle={{ color: '#ff4d4f' }} /></Col>
            <Col span={6}>
              <div style={{ color: '#8c8c8c', marginBottom: 8 }}>存活率</div>
              {issuer.survival_rate != null ? (
                <Progress percent={Math.round(issuer.survival_rate * 100)} strokeColor={issuer.survival_rate >= 0.8 ? '#52c41a' : '#faad14'} />
              ) : '-'}
            </Col>
          </Row>
          <Descriptions size="small" column={3}>
            <Descriptions.Item label="发行方地址">
              <span style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }} onClick={() => navigate(`/issuer/${t.creator_address}`)}>
                {t.creator_address}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="首次出现">{issuer.first_seen_at ? new Date(issuer.first_seen_at).toLocaleString() : '-'}</Descriptions.Item>
            <Descriptions.Item label="最近活动">{issuer.last_seen_at ? new Date(issuer.last_seen_at).toLocaleString() : '-'}</Descriptions.Item>
          </Descriptions>
          {issuer.tokens?.length > 0 && (
            <>
              <div style={{ fontWeight: 'bold', marginTop: 16, marginBottom: 8 }}>📋 历史代币（最近 10 个）</div>
              <Table
                dataSource={issuer.tokens.slice(0, 10)}
                rowKey="id"
                size="small"
                pagination={false}
                onRow={(record: any) => ({
                  onClick: () => navigate(`/token/${record.chain_id}/${record.contract_address}`),
                  style: { cursor: 'pointer' },
                })}
                columns={[
                  { title: '代币', key: 'symbol', render: (_: any, r: any) => <Tag>{r.symbol}</Tag> },
                  { title: '持有人', dataIndex: 'holders', key: 'holders' },
                  {
                    title: '风险', key: 'risk',
                    render: (_: any, r: any) => {
                      try {
                        const info = JSON.parse(r.audit_info || '{}');
                        const m: Record<number, { l: string; c: string }> = { 0: { l: '低', c: 'green' }, 1: { l: '低', c: 'green' }, 2: { l: '中', c: 'orange' }, 3: { l: '高', c: 'red' } };
                        const v = m[info.riskLevel] || { l: '未知', c: 'default' };
                        return <Tag color={v.c}>{v.l}</Tag>;
                      } catch { return <Tag>未知</Tag>; }
                    },
                  },
                ]}
              />
            </>
          )}
        </Card>
      )}
    </div>
  );
};

export default TokenDetail;
