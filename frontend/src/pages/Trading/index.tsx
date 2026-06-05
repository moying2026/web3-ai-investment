import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Tabs, Card, Table, Tag, Button, Form, Input, Select, InputNumber, Space, Row, Col, Statistic, Modal, message, Descriptions, Spin } from 'antd';
import {
  RobotOutlined,
  EditOutlined,
  WalletOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  TrophyOutlined,
  PercentageOutlined,
  ClockCircleOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import type { Token } from '../../types';
import { tokenApi, simApi, aiApi } from '../../services/api';
import { formatPrice, formatVolume, formatNumber } from '../../utils/format';

// ===== K 线 mock 数据生成（与 TokenDetail 一致） =====
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

// ===== 类型定义 =====
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
  stop_loss_price: string | null;
  take_profit_price: string | null;
}

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
  portfolio: { totalValue: string; availableBalance: string; lockedBalance: string };
  byStrategy: Array<{ strategy: string; count: number; wins: number; total_pnl: number }>;
  byChain: Array<{ chain_id: string; count: number; wins: number; total_pnl: number }>;
}

interface AIAnalysis {
  id: number;
  chain_id: string;
  contract_address: string;
  symbol: string;
  score: number;
  recommendation: string;
  risk_level: string;
  reasons: any;
  dimensionScores: any;
  analyzed_at: string;
}

const chainMap: Record<string, string> = { '56': 'BSC', 'CT_501': 'SOL', '1': 'ETH', '8453': 'Base' };
const klinePeriods = [
  { key: '1m', label: '1分' }, { key: '5m', label: '5分' }, { key: '1h', label: '1时' },
  { key: '4h', label: '4时' }, { key: '24h', label: '日线' }, { key: '7d', label: '周线' }, { key: '30d', label: '月线' },
];

// ===== 主组件 =====
const Trading: React.FC = () => {
  const [activeTab, setActiveTab] = useState('positions');
  const [orderForm] = Form.useForm();
  const [orderModalVisible, setOrderModalVisible] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AIAnalysis | null>(null);
  const [queryResult, setQueryResult] = useState<Token | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  // 统计数据
  const [stats, setStats] = useState<SimStatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [allTrades, setAllTrades] = useState<SimTrade[]>([]);

  // 持仓数据
  const [positions, setPositions] = useState<SimTrade[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);

  // 持仓表格：分页 / 排序 / 筛选
  const [posPage, setPosPage] = useState(1);
  const [posPageSize, setPosPageSize] = useState(20);
  const [posSortField, setPosSortField] = useState<string>('entry_time');
  const [posSortOrder, setPosSortOrder] = useState<'asc' | 'desc'>('desc');
  const [posFilters, setPosFilters] = useState<Record<string, string>>({});

  // 订单薄：当前选中代币的历史交易 + 挂单
  const [orderBookTrades, setOrderBookTrades] = useState<SimTrade[]>([]);
  const [orderBookLoading, setOrderBookLoading] = useState(false);

  // 历史数据
  const [history, setHistory] = useState<SimTrade[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);

  // AI 推荐
  const [aiList, setAiList] = useState<AIAnalysis[]>([]);
  const [aiLoading, setAiLoading] = useState(true);

  // K 线
  const [selectedPosition, setSelectedPosition] = useState<SimTrade | null>(null);
  const [klinePeriod, setKlinePeriod] = useState('1h');

  // ===== 数据加载 =====
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await simApi.getStats();
      setStats(data as any);
    } catch { /* 静默 */ }
    finally { setStatsLoading(false); }
  }, []);

  const loadPositions = useCallback(async () => {
    setPositionsLoading(true);
    try {
      const res = await simApi.getTrades({ status: 'OPEN', page: 1, pageSize: 100 });
      const data = res as any;
      const list = data?.data || [];
      setPositions(list);
      // 默认选中第一个持仓用于 K 线
      if (list.length > 0 && !selectedPosition) {
        setSelectedPosition(list[0]);
      }
    } catch { /* 静默 */ }
    finally { setPositionsLoading(false); }
  }, [selectedPosition]);

  const loadHistory = useCallback(async (p = 1) => {
    setHistoryLoading(true);
    try {
      const res = await simApi.getTrades({ status: 'CLOSED', page: p, pageSize: 20 });
      const data = res as any;
      setHistory(data?.data || []);
      setHistoryTotal(data?.total || 0);
      setHistoryPage(p);
    } catch { /* 静默 */ }
    finally { setHistoryLoading(false); }
  }, []);

  const loadAllTradesForChart = useCallback(async () => {
    try {
      const res = await simApi.getTrades({ page: 1, pageSize: 500 });
      const data = res as any;
      setAllTrades(data?.data || []);
    } catch { /* 静默 */ }
  }, []);

  const loadAI = useCallback(async () => {
    setAiLoading(true);
    try {
      const res = await aiApi.getRecommendations({ page: 1, pageSize: 50 });
      const data = res as any;
      setAiList(data?.data || []);
    } catch { /* 静默 */ }
    finally { setAiLoading(false); }
  }, []);

  // 加载订单薄：当前选中代币的历史交易 + 挂单
  const loadOrderBook = useCallback(async (trade: SimTrade) => {
    setOrderBookLoading(true);
    try {
      // 获取该代币的所有交易（含历史+挂单）
      const res = await simApi.getTrades({ page: 1, pageSize: 200 });
      const data = res as any;
      const allList: SimTrade[] = data?.data || [];
      // 过滤出同一代币的交易
      const filtered = allList.filter(
        (t) => t.contract_address === trade.contract_address && t.chain_id === trade.chain_id
      );
      setOrderBookTrades(filtered.slice(0, 50));
    } catch { setOrderBookTrades([]); }
    finally { setOrderBookLoading(false); }
  }, []);

  useEffect(() => {
    loadStats();
    loadPositions();
    loadHistory();
    loadAllTradesForChart();
    loadAI();
  }, []);

  // 选中持仓变化时加载订单薄
  useEffect(() => {
    if (selectedPosition) loadOrderBook(selectedPosition);
  }, [selectedPosition]);

  // Tab 切换刷新
  const handleTabChange = (key: string) => {
    setActiveTab(key);
    if (key === 'positions') loadPositions();
    if (key === 'history') loadHistory(historyPage);
    if (key === 'ai') loadAI();
  };

  // 查询代币
  const handleQueryToken = async () => {
    const chain = orderForm.getFieldValue('chain');
    const address = orderForm.getFieldValue('address');
    if (!chain || !address) { message.warning('请先选择链和输入合约地址'); return; }
    setQueryLoading(true);
    try {
      const data = await tokenApi.getDetail(chain, address);
      setQueryResult(data as any);
      message.success('查询成功');
    } catch { message.error('代币未找到'); setQueryResult(null); }
    finally { setQueryLoading(false); }
  };

  // ===== 每日盈亏图表 =====
  const dailyPnl = useMemo(() => {
    const closedTrades = allTrades.filter(t => t.status === 'CLOSED' && t.pnl && t.exit_time);
    const map = new Map<string, number>();
    for (const t of closedTrades) {
      const dateStr = new Date(t.exit_time!).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
      map.set(dateStr, (map.get(dateStr) || 0) + parseFloat(t.pnl!));
    }
    const sorted = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return { dates: sorted.map(d => d[0]), values: sorted.map(d => parseFloat(d[1].toFixed(2))) };
  }, [allTrades]);

  const dailyPnlOption = {
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'category' as const, data: dailyPnl.dates },
    yAxis: { type: 'value' as const },
    series: [{
      data: dailyPnl.values,
      type: 'bar',
      itemStyle: { color: (params: any) => params.value >= 0 ? '#52c41a' : '#ff4d4f' },
    }],
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
  };

  // ===== K 线图表 =====
  const klineData = useMemo(() => {
    if (!selectedPosition) return [];
    const price = parseFloat(selectedPosition.entry_price) || 1;
    return generateKlineData(klinePeriod, price);
  }, [selectedPosition, klinePeriod]);

  const klineTimeLabels = klineData.map(d => {
    const date = new Date(d.time);
    if (['1m', '5m'].includes(klinePeriod)) return date.toLocaleTimeString();
    if (['1h', '4h'].includes(klinePeriod)) return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const klineOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'cross' as const } },
    xAxis: { type: 'category' as const, data: klineTimeLabels, axisLabel: { fontSize: 10 } },
    yAxis: {
      type: 'value' as const, scale: true,
      axisLabel: {
        formatter: (v: number) => {
          if (v === 0) return '0';
          if (Math.abs(v) < 1) {
            const s = Math.abs(v).toFixed(20).replace(/0+$/, '');
            const dec = (s.split('.')[1] || '').length;
            return v.toFixed(Math.min(18, Math.max(8, dec)));
          }
          if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
          if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
          return v.toFixed(2);
        },
      },
    },
    dataZoom: [
      { type: 'inside' as const, start: 60, end: 100 },
      { type: 'slider' as const, start: 60, end: 100, height: 20, bottom: 5 },
    ],
    series: [{
      name: 'K线',
      type: 'candlestick' as const,
      data: klineData.map(d => [d.open, d.close, d.low, d.high]),
      itemStyle: { color: '#ef5350', color0: '#26a69a', borderColor: '#ef5350', borderColor0: '#26a69a' },
    }],
    grid: { left: 60, right: 60, top: 20, bottom: 40 },
  };

  // ===== 持仓表格：筛选+排序+分页 =====
  const POS_FILTER_OPTIONS = useMemo(() => {
    const chains = new Set<string>();
    const sides = new Set<string>();
    const types = new Set<string>();
    const symbols = new Set<string>();
    positions.forEach(p => {
      if (p.chain_id) chains.add(p.chain_id);
      if (p.side) sides.add(p.side);
      if (p.trade_type) types.add(p.trade_type);
      if (p.symbol) symbols.add(p.symbol);
    });
    return { chains, sides, types, symbols };
  }, [positions]);

  const filteredPositions = useMemo(() => {
    let list = [...positions];
    if (posFilters.chain) list = list.filter(p => p.chain_id === posFilters.chain);
    if (posFilters.side) list = list.filter(p => p.side === posFilters.side);
    if (posFilters.trade_type) list = list.filter(p => p.trade_type === posFilters.trade_type);
    if (posFilters.symbol) list = list.filter(p => (p.symbol || '') === posFilters.symbol);
    // 排序
    list.sort((a, b) => {
      let va: any, vb: any;
      switch (posSortField) {
        case 'entry_price': va = parseFloat(a.entry_price); vb = parseFloat(b.entry_price); break;
        case 'entry_amount': va = parseFloat(a.entry_amount || '0'); vb = parseFloat(b.entry_amount || '0'); break;
        case 'entry_quantity': va = parseFloat(a.entry_quantity || '0'); vb = parseFloat(b.entry_quantity || '0'); break;
        case 'entry_time': va = new Date(a.entry_time).getTime(); vb = new Date(b.entry_time).getTime(); break;
        default: va = new Date(a.entry_time).getTime(); vb = new Date(b.entry_time).getTime();
      }
      return posSortOrder === 'asc' ? (va - vb) : (vb - va);
    });
    return list;
  }, [positions, posFilters, posSortField, posSortOrder]);

  const paginatedPositions = useMemo(() => {
    const start = (posPage - 1) * posPageSize;
    return filteredPositions.slice(start, start + posPageSize);
  }, [filteredPositions, posPage, posPageSize]);

  // 表格列：持仓（增加排序 + 筛选下拉）
  const positionColumns = [
    { title: '代币', key: 'symbol', width: 100, filters: Array.from(POS_FILTER_OPTIONS.symbols).map(s => ({ text: s, value: s })),
      onFilter: (value: any, record: SimTrade) => (record.symbol || '') === value,
      render: (_: any, r: SimTrade) => <Tag>{r.symbol || r.contract_address?.slice(0, 8) + '...'}</Tag> },
    { title: '链', dataIndex: 'chain_id', key: 'chain_id', width: 80,
      filters: Array.from(POS_FILTER_OPTIONS.chains).map(c => ({ text: chainMap[c] || c, value: c })),
      onFilter: (value: any, record: SimTrade) => record.chain_id === value,
      render: (v: string) => chainMap[v] || v },
    { title: '方向', dataIndex: 'side', key: 'side', width: 70,
      filters: Array.from(POS_FILTER_OPTIONS.sides).map(s => ({ text: s === 'BUY' ? '买入' : '卖出', value: s })),
      onFilter: (value: any, record: SimTrade) => record.side === value,
      render: (v: string) => <Tag color={v === 'BUY' ? 'green' : 'red'}>{v === 'BUY' ? '买入' : '卖出'}</Tag> },
    { title: '入场价', dataIndex: 'entry_price', key: 'entry_price', width: 110, sorter: true,
      sortOrder: posSortField === 'entry_price' ? (posSortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (v: string) => formatPrice(v) },
    { title: '数量', dataIndex: 'entry_quantity', key: 'entry_quantity', width: 90, sorter: true,
      sortOrder: posSortField === 'entry_quantity' ? (posSortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (v: string | null) => v ? parseFloat(v).toLocaleString() : '-' },
    { title: '金额', dataIndex: 'entry_amount', key: 'entry_amount', width: 100, sorter: true,
      sortOrder: posSortField === 'entry_amount' ? (posSortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (v: string | null) => v ? formatNumber(parseFloat(v), { prefix: '$' }) : '-' },
    { title: '止损', dataIndex: 'stop_loss_price', key: 'stop_loss_price', width: 90, render: (v: string | null) => v ? formatPrice(v) : '-' },
    { title: '止盈', dataIndex: 'take_profit_price', key: 'take_profit_price', width: 90, render: (v: string | null) => v ? formatPrice(v) : '-' },
    { title: '模式', dataIndex: 'trade_type', key: 'trade_type', width: 70,
      filters: Array.from(POS_FILTER_OPTIONS.types).map(t => ({ text: t === 'ai_auto' ? 'AI' : '手动', value: t })),
      onFilter: (value: any, record: SimTrade) => record.trade_type === value,
      render: (v: string) => <Tag color={v === 'ai_auto' ? 'blue' : 'default'}>{v === 'ai_auto' ? 'AI' : '手动'}</Tag> },
    { title: '入场时间', dataIndex: 'entry_time', key: 'entry_time', width: 140, sorter: true,
      sortOrder: posSortField === 'entry_time' ? (posSortOrder === 'asc' ? 'ascend' as const : 'descend' as const) : undefined,
      render: (v: string) => new Date(v).toLocaleString() },
  ];

  // 订单薄表格列
  const orderBookColumns = [
    { title: '时间', dataIndex: 'entry_time', key: 'time', width: 130,
      render: (v: string) => new Date(v).toLocaleString() },
    { title: '方向', dataIndex: 'side', key: 'side', width: 60,
      render: (v: string) => <Tag color={v === 'BUY' ? 'green' : 'red'} style={{ fontSize: 11, padding: '0 4px' }}>{v === 'BUY' ? '买' : '卖'}</Tag> },
    { title: '价格', dataIndex: 'entry_price', key: 'price', width: 100,
      render: (v: string) => formatPrice(v) },
    { title: '数量', dataIndex: 'entry_quantity', key: 'qty', width: 80,
      render: (v: string | null) => v ? parseFloat(v).toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 60,
      render: (v: string) => <Tag color={v === 'OPEN' ? 'blue' : 'default'} style={{ fontSize: 11, padding: '0 4px' }}>{v === 'OPEN' ? '持仓' : '平仓'}</Tag> },
  ];

  // ===== 统计卡片 =====
  const winRateNum = stats ? parseFloat(stats.winRate) : 0;
  const totalPnlNum = stats ? parseFloat(stats.totalPnl) : 0;

  // ===== 渲染 =====

  // 统计概览区
  const renderStatsOverview = () => (
    <Spin spinning={statsLoading}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="总交易次数" value={stats?.total ?? '-'} prefix={<TrophyOutlined />}
              suffix={stats ? `(开 ${stats.open} / 平 ${stats.closed})` : undefined} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="胜率" value={winRateNum} precision={1} suffix="%" prefix={<PercentageOutlined />}
              valueStyle={{ color: winRateNum >= 50 ? '#3f8600' : '#cf1322' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="累计盈亏" value={totalPnlNum} precision={2} prefix="$"
              valueStyle={{ color: totalPnlNum >= 0 ? '#3f8600' : '#cf1322' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="平均持仓" value={stats?.avgHoldingMinutes ?? '-'} suffix={stats ? '分钟' : ''} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
      </Row>
      <Card title="📊 每日盈亏" size="small" style={{ marginBottom: 16 }}>
        {dailyPnl.dates.length > 0 ? (
          <ReactECharts option={dailyPnlOption} style={{ height: 250 }} />
        ) : (
          <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 50 }}>暂无已平仓交易数据</div>
        )}
      </Card>
    </Spin>
  );

  // K 线图区
  const renderKline = () => {
    if (!selectedPosition) return null;
    return (
      <Card
        title={
          <Space>
            📈 K 线图
            <Tag color="blue">{selectedPosition.symbol || selectedPosition.contract_address?.slice(0, 8)}</Tag>
            <Tag>{chainMap[selectedPosition.chain_id] || selectedPosition.chain_id}</Tag>
          </Space>
        }
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Space size={4}>
            {klinePeriods.map(p => (
              <Button key={p.key} size="small" type={klinePeriod === p.key ? 'primary' : 'default'}
                onClick={() => setKlinePeriod(p.key)}>{p.label}</Button>
            ))}
          </Space>
        }
      >
        <ReactECharts option={klineOption} style={{ height: 350 }} />
      </Card>
    );
  };

  // AI 推荐
  const renderAIRecommendations = () => (
    <Spin spinning={aiLoading}>
      {aiList.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 60 }}>暂无 AI 分析数据</div>
      ) : (
        <Row gutter={[16, 16]}>
          {aiList.map(item => (
            <Col span={8} key={item.id}>
              <Card hoverable onClick={() => {
                setSelectedAnalysis(item);
                setOrderModalVisible(true);
                orderForm.setFieldsValue({ chain: item.chain_id, address: item.contract_address, symbol: item.symbol, side: item.recommendation === 'BUY' ? 'buy' : 'sell' });
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Space>
                    <ThunderboltOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                    <span style={{ fontSize: 18, fontWeight: 'bold' }}>{item.symbol || '未知'}</span>
                  </Space>
                  <Tag color={item.recommendation === 'BUY' ? 'green' : item.recommendation === 'SELL' ? 'red' : item.recommendation === 'HOLD' ? 'blue' : 'default'}>
                    {item.recommendation === 'BUY' ? '买入' : item.recommendation === 'SELL' ? '卖出' : item.recommendation === 'HOLD' ? '持有' : item.recommendation}
                  </Tag>
                </div>
                <div style={{ marginBottom: 8, color: '#8c8c8c' }}>{chainMap[item.chain_id] || item.chain_id}</div>
                {item.reasons && <div style={{ marginBottom: 12, fontSize: 12, color: '#595959' }}>{typeof item.reasons === 'string' ? item.reasons : JSON.stringify(item.reasons).slice(0, 100)}</div>}
                <Row gutter={16}>
                  <Col span={8}><Statistic title="评分" value={item.score} valueStyle={{ fontSize: 16 }} /></Col>
                  <Col span={8}><Statistic title="链" value={chainMap[item.chain_id] || item.chain_id} valueStyle={{ fontSize: 16 }} /></Col>
                  <Col span={8}>
                    <Tag color={item.risk_level === 'low' ? 'green' : item.risk_level === 'medium' ? 'orange' : 'red'} style={{ marginTop: 8 }}>
                      {item.risk_level === 'low' ? '低风险' : item.risk_level === 'medium' ? '中风险' : '高风险'}
                    </Tag>
                  </Col>
                </Row>
                <div style={{ marginTop: 8, fontSize: 11, color: '#8c8c8c' }}>{item.analyzed_at ? new Date(item.analyzed_at).toLocaleString() : ''}</div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Spin>
  );

  // 手动下单
  const renderManualOrder = () => (
    <Card>
      <Form form={orderForm} layout="vertical" style={{ maxWidth: 600 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="链" name="chain" rules={[{ required: true }]}>
              <Select placeholder="选择链">
                <Select.Option value="56">BSC</Select.Option>
                <Select.Option value="CT_501">Solana</Select.Option>
                <Select.Option value="1">Ethereum</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="方向" name="side" rules={[{ required: true }]}>
              <Select placeholder="选择方向">
                <Select.Option value="buy">买入</Select.Option>
                <Select.Option value="sell">卖出</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="合约地址" name="address" rules={[{ required: true }]}>
          <Input placeholder="输入代币合约地址" addonAfter={
            <Button type="link" size="small" icon={<SearchOutlined />} loading={queryLoading} onClick={handleQueryToken} style={{ margin: -4 }}>查询</Button>
          } />
        </Form.Item>
        {queryResult && (
          <Card size="small" style={{ marginBottom: 16, background: '#f6ffed' }}>
            <Descriptions column={2} size="small">
              <Descriptions.Item label="代币">{queryResult.symbol}</Descriptions.Item>
              <Descriptions.Item label="价格">{formatPrice(queryResult.price_latest)}</Descriptions.Item>
              <Descriptions.Item label="持有人">{queryResult.holders}</Descriptions.Item>
              <Descriptions.Item label="流动性">{formatVolume(queryResult.liquidity)}</Descriptions.Item>
            </Descriptions>
          </Card>
        )}
        <Row gutter={16}>
          <Col span={8}><Form.Item label="金额(USD)" name="amount" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} placeholder="100" min={1} /></Form.Item></Col>
          <Col span={8}><Form.Item label="限价" name="limitPrice"><InputNumber style={{ width: '100%' }} placeholder="可选" min={0} /></Form.Item></Col>
          <Col span={8}><Form.Item label="止损" name="stopLoss"><InputNumber style={{ width: '100%' }} placeholder="可选" min={0} /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Form.Item label="止盈" name="takeProfit"><InputNumber style={{ width: '100%' }} placeholder="可选" min={0} /></Form.Item></Col>
        </Row>
        <Form.Item><Button type="primary" size="large" block>下单</Button></Form.Item>
      </Form>
    </Card>
  );

  // 历史表格
  const historyColumns = [
    { title: '时间', dataIndex: 'exit_time', key: 'exit_time', width: 140, render: (v: string | null) => v ? new Date(v).toLocaleString() : '-' },
    { title: '代币', key: 'symbol', width: 100, render: (_: any, r: SimTrade) => <Tag>{r.symbol || r.contract_address?.slice(0, 8) + '...'}</Tag> },
    { title: '方向', dataIndex: 'side', key: 'side', width: 70, render: (v: string) => <Tag color={v === 'BUY' ? 'green' : 'red'}>{v === 'BUY' ? '买入' : '卖出'}</Tag> },
    { title: '入场价', dataIndex: 'entry_price', key: 'entry_price', width: 110, render: (v: string) => formatPrice(v) },
    { title: '出场价', dataIndex: 'exit_price', key: 'exit_price', width: 110, render: (v: string | null) => v ? formatPrice(v) : '-' },
    { title: '盈亏', dataIndex: 'pnl', key: 'pnl', width: 120, render: (v: string | null) => {
      if (v == null) return '-';
      const num = parseFloat(v);
      return <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>{formatNumber(num, { prefix: num >= 0 ? '+$' : '$', decimals: 4 })}</span>;
    }},
    { title: '盈亏%', dataIndex: 'pnl_percent', key: 'pnl_percent', width: 90, render: (v: string | null) => {
      if (v == null) return '-';
      const num = parseFloat(v);
      return <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>{num >= 0 ? '+' : ''}{num.toFixed(2)}%</span>;
    }},
    { title: '持仓时长', dataIndex: 'holding_duration_minutes', key: 'holding_duration_minutes', width: 100, render: (v: number | null) => {
      if (v == null) return '-';
      if (v < 60) return `${v}分钟`;
      if (v < 1440) return `${Math.floor(v / 60)}h ${v % 60}m`;
      return `${Math.floor(v / 1440)}天 ${Math.floor((v % 1440) / 60)}h`;
    }},
    { title: '模式', dataIndex: 'trade_type', key: 'trade_type', width: 80, render: (v: string) => <Tag color={v === 'ai_auto' ? 'blue' : 'default'}>{v === 'ai_auto' ? 'AI' : '手动'}</Tag> },
    { title: '平仓原因', dataIndex: 'exit_reason', key: 'exit_reason', width: 100, ellipsis: true, render: (v: string | null) => v || '-' },
  ];

  const tabItems = [
    {
      key: 'positions',
      label: <><WalletOutlined /> 当前持仓</>,
      children: (
        <>
          {/* 筛选区域 */}
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#8c8c8c', fontSize: 12 }}>筛选：</span>
            <Select
              allowClear placeholder="链" style={{ width: 100 }} size="small"
              value={posFilters.chain || undefined}
              onChange={(v) => { setPosFilters(f => ({ ...f, chain: v || '' })); setPosPage(1); }}
            >
              {Array.from(POS_FILTER_OPTIONS.chains).map(c => <Select.Option key={c} value={c}>{chainMap[c] || c}</Select.Option>)}
            </Select>
            <Select
              allowClear placeholder="方向" style={{ width: 90 }} size="small"
              value={posFilters.side || undefined}
              onChange={(v) => { setPosFilters(f => ({ ...f, side: v || '' })); setPosPage(1); }}
            >
              <Select.Option value="BUY">买入</Select.Option>
              <Select.Option value="SELL">卖出</Select.Option>
            </Select>
            <Select
              allowClear placeholder="模式" style={{ width: 90 }} size="small"
              value={posFilters.trade_type || undefined}
              onChange={(v) => { setPosFilters(f => ({ ...f, trade_type: v || '' })); setPosPage(1); }}
            >
              <Select.Option value="ai_auto">AI</Select.Option>
              <Select.Option value="manual">手动</Select.Option>
            </Select>
            <Select
              allowClear placeholder="代币" style={{ width: 120 }} size="small" showSearch
              value={posFilters.symbol || undefined}
              onChange={(v) => { setPosFilters(f => ({ ...f, symbol: v || '' })); setPosPage(1); }}
            >
              {Array.from(POS_FILTER_OPTIONS.symbols).map(s => <Select.Option key={s} value={s}>{s}</Select.Option>)}
            </Select>
            <Button size="small" icon={<ClearOutlined />} onClick={() => { setPosFilters({}); setPosPage(1); }}>
              重置
            </Button>
            <span style={{ marginLeft: 'auto', color: '#8c8c8c', fontSize: 12 }}>
              共 {filteredPositions.length} 条持仓
            </span>
          </div>

          {/* 主体：左侧订单薄 + 右侧持仓表格 */}
          <Row gutter={16}>
            {/* 左侧：订单薄 */}
            <Col span={8}>
              <Card
                title={
                  <Space>
                    📋 订单薄
                    {selectedPosition && (
                      <Tag color="blue" style={{ fontSize: 11 }}>
                        {selectedPosition.symbol || selectedPosition.contract_address?.slice(0, 8)}
                      </Tag>
                    )}
                  </Space>
                }
                size="small"
                bodyStyle={{ padding: 0 }}
              >
                <Spin spinning={orderBookLoading}>
                  <Table
                    dataSource={orderBookTrades}
                    columns={orderBookColumns}
                    rowKey="trade_id"
                    size="small"
                    pagination={false}
                    scroll={{ y: 380 }}
                    locale={{ emptyText: '选择持仓查看订单薄' }}
                    style={{ fontSize: 12 }}
                  />
                </Spin>
              </Card>
            </Col>

            {/* 右侧：当前持仓表格 */}
            <Col span={16}>
              <Card size="small">
                <Table
                  dataSource={paginatedPositions}
                  columns={positionColumns}
                  rowKey="trade_id"
                  size="small"
                  loading={positionsLoading}
                  scroll={{ x: 1000, y: 460 }}
                  pagination={false}
                  locale={{ emptyText: '暂无持仓' }}
                  onChange={(_pg, _flt, sorter: any) => {
                    if (sorter.field) {
                      setPosSortField(sorter.field);
                      setPosSortOrder(sorter.order === 'ascend' ? 'asc' : 'desc');
                    }
                  }}
                  onRow={(record) => ({
                    onClick: () => setSelectedPosition(record),
                    style: { cursor: 'pointer', background: selectedPosition?.trade_id === record.trade_id ? '#e6f7ff' : undefined },
                  })}
                />
                {/* 分页 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: '0 8px' }}>
                  <Space size={8}>
                    {[10, 20, 50, 100].map(size => (
                      <Button
                        key={size} size="small"
                        type={posPageSize === size ? 'primary' : 'default'}
                        onClick={() => { setPosPageSize(size); setPosPage(1); }}
                      >
                        {size}条/页
                      </Button>
                    ))}
                  </Space>
                  <Space size={8}>
                    <Button
                      size="small" disabled={posPage <= 1}
                      onClick={() => setPosPage(p => p - 1)}
                    >
                      上一页
                    </Button>
                    <span style={{ fontSize: 12, color: '#595959' }}>
                      {posPage} / {Math.max(1, Math.ceil(filteredPositions.length / posPageSize))}
                    </span>
                    <Button
                      size="small"
                      disabled={posPage >= Math.ceil(filteredPositions.length / posPageSize)}
                      onClick={() => setPosPage(p => p + 1)}
                    >
                      下一页
                    </Button>
                  </Space>
                </div>
              </Card>
            </Col>
          </Row>
        </>
      ),
    },
    { key: 'ai', label: <><RobotOutlined /> AI 推荐</>, children: renderAIRecommendations() },
    { key: 'manual', label: <><EditOutlined /> 手动下单</>, children: renderManualOrder() },
    {
      key: 'history',
      label: <><HistoryOutlined /> 历史交易</>,
      children: (
        <Table
          dataSource={history} columns={historyColumns} rowKey="trade_id" size="small"
          loading={historyLoading} scroll={{ x: 1100 }}
          pagination={{ current: historyPage, pageSize: 20, total: historyTotal, showTotal: (t) => `共 ${t} 条`, onChange: (p) => loadHistory(p) }}
        />
      ),
    },
  ];

  return (
    <div>
      {/* 1. 统计概览区 */}
      {renderStatsOverview()}

      {/* 2. K 线图区 */}
      {renderKline()}

      {/* 3. Tab 区 */}
      <Card>
        <Tabs activeKey={activeTab} onChange={handleTabChange} items={tabItems} />
      </Card>

      <Modal title="确认下单" open={orderModalVisible} onCancel={() => setOrderModalVisible(false)}
        onOk={() => { message.success('下单成功'); setOrderModalVisible(false); }}>
        {selectedAnalysis && (
          <div>
            <p><strong>代币:</strong> {selectedAnalysis.symbol}</p>
            <p><strong>链:</strong> {chainMap[selectedAnalysis.chain_id] || selectedAnalysis.chain_id}</p>
            <p><strong>合约:</strong> {selectedAnalysis.contract_address}</p>
            <p><strong>AI建议:</strong> {selectedAnalysis.recommendation === 'BUY' ? '买入' : selectedAnalysis.recommendation === 'SELL' ? '卖出' : '持有'}</p>
            <p><strong>评分:</strong> {selectedAnalysis.score}</p>
            <p><strong>风险等级:</strong> {selectedAnalysis.risk_level === 'low' ? '低风险' : selectedAnalysis.risk_level === 'medium' ? '中风险' : '高风险'}</p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Trading;
