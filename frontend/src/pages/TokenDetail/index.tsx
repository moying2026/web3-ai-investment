import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Row, Col, Card, Tag, Descriptions, Button, Space, Table, Divider, Spin, message, Statistic, Progress } from 'antd';
import { ShoppingCartOutlined, ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import type { Token, Snapshot } from '../../types';
import api, { tokenApi } from '../../services/api';

const TokenDetail: React.FC = () => {
  const { chain, address } = useParams<{ chain: string; address: string }>();
  const navigate = useNavigate();
  const [token, setToken] = useState<Token | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [issuer, setIssuer] = useState<any>(null);
  const [klinePeriod, setKlinePeriod] = useState<string>('1h');

  useEffect(() => {
    if (!chain || !address) return;
    setLoading(true);
    Promise.all([
      tokenApi.getDetail(chain, address).catch(() => null),
      tokenApi.getSnapshots(chain, address).catch(() => []),
    ]).then(([tokenData, snapData]) => {
      if (tokenData) setToken(tokenData as any);
      else message.error('代币详情加载失败');
      setSnapshots((snapData as any) || []);
    }).finally(() => setLoading(false));
  }, [chain, address]);

  // 加载发行方数据
  useEffect(() => {
    if (!token?.creator_address) return;
    api.get<any, any>(`/issuers/${token.creator_address}`)
      .then(data => setIssuer(data))
      .catch(() => {});
  }, [token?.creator_address]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!token) return <div style={{ textAlign: 'center', padding: 100 }}>代币未找到</div>;

  // 解析字段
  const price = parseFloat(token.price_latest);
  const change1h = parseFloat(token.percent_change_1h);
  const change24h = parseFloat(token.percent_change_24h);
  const volume24h = parseFloat(token.volume_24h);
  const liquidity = parseFloat(token.liquidity);
  const marketCap = parseFloat(token.market_cap);

  const parseName = (): string => {
    try {
      if (!token.meta_info) return token.symbol;
      const info = JSON.parse(token.meta_info);
      return info.name || info.originName || token.symbol;
    } catch { return token.symbol; }
  };

  const parseTags = (): string[] => {
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

  const parseRisk = (): { label: string; color: string } => {
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

  const parseAuditDetails = (): { contractVerified: string; ownership: string; blacklist: string; honeypot: string } => {
    try {
      if (!token.audit_info) return { contractVerified: '未知', ownership: '未知', blacklist: '未知', honeypot: '未知' };
      const info = JSON.parse(token.audit_info);
      return {
        contractVerified: info.riskCodes?.length > 0 ? (info.riskCodes.includes('unverified') ? '❌ 未验证' : '✅ 已验证') : '✅ 已验证',
        ownership: info.riskCodes?.includes('ownership_renounced') ? '已放弃' : '未放弃',
        blacklist: info.riskCodes?.includes('blacklist') ? '有' : '无',
        honeypot: info.riskCodes?.includes('honeypot') ? '⚠️ 疑似' : '通过',
      };
    } catch { return { contractVerified: '未知', ownership: '未知', blacklist: '未知', honeypot: '未知' }; }
  };

  const parseLinks = (): { label: string; link: string }[] => {
    try {
      if (!token.links) return [];
      const arr = JSON.parse(token.links);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };

  const risk = parseRisk();
  const auditDetails = parseAuditDetails();
  const links = parseLinks();
  const tags = parseTags();

  // K线图数据生成（mock，后端 chart 字段就绪后替换为真实数据）
  const generateKlineData = (period: string, basePrice: number) => {
    const periodConfig: Record<string, { count: number; intervalMs: number; label: string }> = {
      '1m':  { count: 120, intervalMs: 60000, label: '1分钟' },
      '5m':  { count: 100, intervalMs: 300000, label: '5分钟' },
      '1h':  { count: 72,  intervalMs: 3600000, label: '1小时' },
      '4h':  { count: 60,  intervalMs: 14400000, label: '4小时' },
      '24h': { count: 30,  intervalMs: 86400000, label: '24小时' },
      '7d':  { count: 28,  intervalMs: 604800000, label: '7天' },
      '30d': { count: 30,  intervalMs: 2592000000, label: '30天' },
    };
    const cfg = periodConfig[period] || periodConfig['1h'];
    const now = Date.now();
    const data: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> = [];
    let lastClose = basePrice;
    for (let i = 0; i < cfg.count; i++) {
      const time = now - (cfg.count - i) * cfg.intervalMs;
      const volatility = basePrice * 0.03;
      const open = lastClose;
      const change = (Math.random() - 0.48) * volatility;
      const close = Math.max(open + change, basePrice * 0.5);
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.3;
      const volume = Math.random() * 500000 + 50000;
      data.push({ time, open, high, low, close, volume });
      lastClose = close;
    }
    return data;
  };

  // 尝试从 token 的 chart 字段解析真实数据，否则用 mock
  const parseChartData = (period: string): Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> | null => {
    const chartField = `chart_${period}`;
    const raw = (token as any)?.[chartField];
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed.p || !parsed.v) return null;
      const prices = parsed.p as Record<string, number>;
      const volumes = parsed.v as Record<string, number>;
      const timestamps = Object.keys(prices).map(Number).sort((a, b) => a - b);
      return timestamps.map((t, i) => {
        const p = prices[t];
        const nextP = i < timestamps.length - 1 ? prices[timestamps[i + 1]] : p;
        return {
          time: t,
          open: p,
          close: nextP,
          high: Math.max(p, nextP) * (1 + Math.random() * 0.01),
          low: Math.min(p, nextP) * (1 - Math.random() * 0.01),
          volume: volumes[t] || 0,
        };
      });
    } catch { return null; }
  };

  const klineData = parseChartData(klinePeriod) || generateKlineData(klinePeriod, price);

  const klineOption = {
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'cross' as const },
      formatter: (params: any) => {
        if (!params || params.length === 0) return '';
        const d = params[0];
        const time = d.axisValue;
        const ohlc = d.data;
        if (!Array.isArray(ohlc)) return '';
        const [open, close, low, high] = ohlc;
        const volItem = params.find((p: any) => p.seriesName === '成交量');
        const vol = volItem ? volItem.data : '-';
        const color = close >= open ? '#26a69a' : '#ef5350';
        return `
          <div style="font-size:12px">
            <div style="margin-bottom:4px">${time}</div>
            <div>开: <span style="color:${color}">${open?.toFixed(6)}</span></div>
            <div>高: <span style="color:${color}">${high?.toFixed(6)}</span></div>
            <div>低: <span style="color:${color}">${low?.toFixed(6)}</span></div>
            <div>收: <span style="color:${color}">${close?.toFixed(6)}</span></div>
            <div>量: ${typeof vol === 'number' ? vol.toLocaleString() : vol}</div>
          </div>
        `;
      },
    },
    xAxis: {
      type: 'category' as const,
      data: klineData.map(d => {
        const date = new Date(d.time);
        if (['1m', '5m'].includes(klinePeriod)) return date.toLocaleTimeString();
        if (['1h', '4h'].includes(klinePeriod)) return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
        return `${date.getMonth() + 1}/${date.getDate()}`;
      }),
      axisLabel: { fontSize: 10 },
    },
    yAxis: [
      { type: 'value' as const, scale: true, position: 'right' as const, axisLabel: { formatter: (v: number) => v < 0.01 ? v.toExponential(2) : v.toFixed(4) } },
      { type: 'value' as const, scale: true, position: 'right' as const, gridIndex: 1, axisLabel: { show: false } },
    ],
    dataZoom: [
      { type: 'inside' as const, xAxisIndex: 0, start: 60, end: 100 },
      { type: 'slider' as const, xAxisIndex: 0, start: 60, end: 100, height: 20, bottom: 5 },
    ],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: klineData.map(d => [d.open, d.close, d.low, d.high]),
        itemStyle: {
          color: '#ef5350',        // 阴线填充（下跌）
          color0: '#26a69a',       // 阳线填充（上涨）
          borderColor: '#ef5350',  // 阴线边框
          borderColor0: '#26a69a', // 阳线边框
        },
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 0,
        yAxisIndex: 1,
        data: klineData.map((d, i) => ({
          value: d.volume,
          itemStyle: {
            color: i > 0 && d.close >= klineData[i - 1].close ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
          },
        })),
      },
    ],
    grid: [
      { left: 60, right: 60, top: 20, bottom: 60 },
      { left: 60, right: 60, top: '75%', bottom: 30 },
    ],
  };

  const klinePeriods = [
    { key: '1m', label: '1分' },
    { key: '5m', label: '5分' },
    { key: '1h', label: '1时' },
    { key: '4h', label: '4时' },
    { key: '24h', label: '日线' },
    { key: '7d', label: '周线' },
    { key: '30d', label: '月线' },
  ];

  // 快照表格列
  const snapshotColumns = [
    { title: '时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    { title: '价格', dataIndex: 'price', key: 'price', render: (v: string) => `$${parseFloat(v).toFixed(6)}` },
    { title: '成交量', dataIndex: 'volume', key: 'volume', render: (v: string) => `$${(parseFloat(v || '0') / 1000).toFixed(0)}K` },
    { title: '持有人', dataIndex: 'holders', key: 'holders' },
    { title: '流动性', dataIndex: 'liquidity', key: 'liquidity', render: (v: string) => `$${(parseFloat(v || '0') / 1000).toFixed(0)}K` },
    { title: '市值', dataIndex: 'market_cap', key: 'market_cap', render: (v: string) => `$${(parseFloat(v || '0') / 1e6).toFixed(2)}M` },
  ];

  const chainMap: Record<string, string> = { '56': 'BSC', 'CT_501': 'SOL', '1': 'ETH' };

  return (
    <div>
      {/* 返回按钮 */}
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(-1)}
        style={{ marginBottom: 16 }}
      >
        返回
      </Button>

      {/* 顶部信息 */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24} align="middle">
          <Col>
            {token.icon ? (
              <img
                src={`https://www.binance.com${token.icon}`}
                alt=""
                style={{ width: 48, height: 48, borderRadius: '50%' }}
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.style.display = 'none';
                  const fallback = el.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              style={{
                width: 48, height: 48, borderRadius: '50%', background: '#1890ff', color: '#fff',
                display: token.icon ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, fontWeight: 'bold',
              }}
            >
              {token.symbol?.charAt(0) || '?'}
            </div>
          </Col>
          <Col flex="auto">
            <Space size="middle">
              <span style={{ fontSize: 24, fontWeight: 'bold' }}>{parseName()}</span>
              <Tag>{token.symbol}</Tag>
              <Tag>{chainMap[token.chain_id] || token.chain_id}</Tag>
              <Tag color={risk.color}>{risk.label}</Tag>
              {token.blacklist === 1 && <Tag color="red">黑名单</Tag>}
              {token.whitelist === 1 && <Tag color="blue">白名单</Tag>}
            </Space>
            <div style={{ marginTop: 8, color: '#8c8c8c' }}>
              合约: {token.contract_address}
            </div>
            {links.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {links.map((l, i) => (
                  <Tag key={i} color="blue" style={{ cursor: 'pointer' }} onClick={() => window.open(l.link, '_blank')}>
                    {l.label}
                  </Tag>
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
                  } catch {
                    message.error('刷新失败');
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                刷新链上数据
              </Button>
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
              <Button
                key={p.key}
                size="small"
                type={klinePeriod === p.key ? 'primary' : 'default'}
                onClick={() => setKlinePeriod(p.key)}
              >
                {p.label}
              </Button>
            ))}
          </Space>
        }
      >
        <ReactECharts option={klineOption} style={{ height: 450 }} />
      </Card>

      {/* 详细信息 */}
      <Row gutter={16}>
        <Col span={8}>
          <Card title="📋 基础数据" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="当前价格">
                ${price < 0.01 ? price.toFixed(8) : price.toFixed(4)}
              </Descriptions.Item>
              <Descriptions.Item label="首笔价格">
                ${parseFloat(token.price_first).toFixed(6)}
              </Descriptions.Item>
              <Descriptions.Item label="1h涨跌">
                <span style={{ color: change1h >= 0 ? '#52c41a' : '#ff4d4f' }}>
                  {change1h >= 0 ? '+' : ''}{change1h.toFixed(2)}%
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="24h涨跌">
                <span style={{ color: change24h >= 0 ? '#52c41a' : '#ff4d4f' }}>
                  {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="24h成交量">
                ${volume24h >= 1e6 ? `${(volume24h / 1e6).toFixed(2)}M` : `${(volume24h / 1e3).toFixed(0)}K`}
              </Descriptions.Item>
              <Descriptions.Item label="市值">
                ${marketCap >= 1e6 ? `${(marketCap / 1e6).toFixed(2)}M` : `${marketCap.toFixed(0)}`}
              </Descriptions.Item>
              <Descriptions.Item label="流动性">
                ${liquidity >= 1e6 ? `${(liquidity / 1e6).toFixed(2)}M` : `${(liquidity / 1e3).toFixed(0)}K`}
              </Descriptions.Item>
              <Descriptions.Item label="持有人">{token.holders?.toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="总供应量">{(token as any).total_supply ? parseFloat((token as any).total_supply).toLocaleString() : '-'}</Descriptions.Item>
              <Descriptions.Item label="销毁量">{(token as any).burned_amount ? parseFloat((token as any).burned_amount).toLocaleString() : '-'}</Descriptions.Item>
              <Descriptions.Item label="流通量">{(token as any).circulating_supply ? parseFloat((token as any).circulating_supply).toLocaleString() : '-'}</Descriptions.Item>
              <Descriptions.Item label="可增发">{(token as any).is_mintable != null ? ((token as any).is_mintable ? '✅ 是' : '❌ 否') : '-'}</Descriptions.Item>
              <Descriptions.Item label="可升级">{(token as any).is_upgradeable != null ? ((token as any).is_upgradeable ? '✅ 是' : '❌ 否') : '-'}</Descriptions.Item>
              <Descriptions.Item label="开发者代币数">{(token as any).dev_tokens ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="已迁移数">{(token as any).dev_migrated ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="迁移率">
                {(token as any).dev_migrated_percent != null ? (
                  <Progress
                    percent={parseFloat((token as any).dev_migrated_percent)}
                    size="small"
                    style={{ width: 120 }}
                    strokeColor={parseFloat((token as any).dev_migrated_percent) >= 100 ? '#52c41a' : '#faad14'}
                  />
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {token.launch_time ? new Date(token.launch_time).toLocaleString() : token.created_at}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="👥 持有人分析" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="持有人数量">{token.holders?.toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="KYC持有人">{token.kyc_holders ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="前10持仓占比">{token.holders_top10_percent ? `${parseFloat(token.holders_top10_percent).toFixed(1)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="聪明钱持仓">{token.smart_money_holding_percent ? `${token.smart_money_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="KOL持仓">{token.kol_holding_percent ? `${token.kol_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="开发者持仓">{token.dev_holding_percent != null ? `${token.dev_holding_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="专业持有人">{token.pro_holders_percent ? `${token.pro_holders_percent.toFixed(2)}%` : '-'}</Descriptions.Item>
              <Descriptions.Item label="24h搜索量">{token.search_count_24h ?? '-'}</Descriptions.Item>
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

      {/* 快照数据 */}
      <Card title="⏱️ 生命周期快照" size="small" style={{ marginTop: 16 }}>
        {snapshots.length > 0 ? (
          <Table dataSource={snapshots} columns={snapshotColumns} pagination={false} size="small" rowKey="id" />
        ) : (
          <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 40 }}>
            暂无快照数据（后端尚未采集该代币的快照）
          </div>
        )}
      </Card>

      {/* 发行方画像 */}
      {issuer && (
        <Card title="👤 发行方画像" size="small" style={{ marginTop: 16 }}>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={4}>
              <Statistic title="总代币数" value={issuer.total_tokens ?? 0} />
            </Col>
            <Col span={4}>
              <Statistic title="存活" value={issuer.alive_tokens ?? 0} valueStyle={{ color: '#52c41a' }} />
            </Col>
            <Col span={4}>
              <Statistic title="已死亡" value={issuer.dead_tokens ?? 0} valueStyle={{ color: '#ff4d4f' }} />
            </Col>
            <Col span={4}>
              <Statistic title="未迁移" value={(issuer.total_tokens ?? 0) - (issuer.alive_tokens ?? 0) - (issuer.dead_tokens ?? 0)} />
            </Col>
            <Col span={8}>
              <div style={{ color: '#8c8c8c', marginBottom: 8 }}>存活率</div>
              {issuer.survival_rate != null ? (
                <Progress
                  percent={issuer.survival_rate * 100}
                  strokeColor={issuer.survival_rate * 100 >= 80 ? '#52c41a' : '#faad14'}
                  format={() => `${(issuer.survival_rate * 100).toFixed(1)}%`}
                />
              ) : '-'}
            </Col>
          </Row>
          <Descriptions size="small" column={3} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="发行方地址">
              <span
                style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}
                onClick={() => navigate(`/issuer/${token?.creator_address}`)}
              >
                {token?.creator_address}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="首次出现">{issuer.first_seen_at ? new Date(issuer.first_seen_at).toLocaleString() : '-'}</Descriptions.Item>
            <Descriptions.Item label="最近活动">{issuer.last_seen_at ? new Date(issuer.last_seen_at).toLocaleString() : '-'}</Descriptions.Item>
          </Descriptions>
          {issuer.tokens && issuer.tokens.length > 0 && (
            <>
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>📋 历史代币（最近 10 个）</div>
              <Table
                dataSource={issuer.tokens.slice(0, 10)}
                rowKey="id"
                size="small"
                pagination={false}
                onRow={(record) => ({
                  onClick: () => navigate(`/token/${record.chain_id}/${record.contract_address}`),
                  style: { cursor: 'pointer' },
                })}
                columns={[
                  {
                    title: '代币', key: 'symbol',
                    render: (_: any, r: any) => <Tag>{r.symbol}</Tag>,
                  },
                  {
                    title: '市值', key: 'market_cap',
                    render: (_: any, r: any) => {
                      const v = parseFloat(r.market_cap || '0');
                      return v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
                    },
                  },
                  { title: '持有人', dataIndex: 'holders', key: 'holders' },
                  {
                    title: '迁移状态', key: 'migration',
                    render: (_: any, r: any) => {
                      const pct = r.dev_migrated_percent;
                      if (pct == null) return '-';
                      const val = parseFloat(pct) * 100;
                      return <Progress percent={val} size="small" strokeColor={val >= 80 ? '#52c41a' : '#faad14'} format={() => `${val.toFixed(1)}%`} />;
                    },
                  },
                  {
                    title: '风险', key: 'risk',
                    render: (_: any, r: any) => {
                      try {
                        const info = JSON.parse(r.audit_info || '{}');
                        const map: Record<number, { l: string; c: string }> = { 1: { l: '低', c: 'green' }, 2: { l: '中', c: 'orange' }, 3: { l: '高', c: 'red' } };
                        const m = map[info.riskLevel] || { l: '未知', c: 'default' };
                        return <Tag color={m.c}>{m.l}</Tag>;
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
