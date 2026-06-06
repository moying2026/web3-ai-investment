import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Tabs, Card, Table, Tag, Button, Form, Input, Select, InputNumber, Space, Row, Col, Statistic, Modal, message, Descriptions, Spin, Checkbox, Popover } from 'antd';
import {
  RobotOutlined,
  EditOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  ClearOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import type { Token } from '../../types';
import { tokenApi, simApi, aiApi } from '../../services/api';
import { formatPrice, formatVolume, formatNumber } from '../../utils/format';

// ===== K 线 mock 数据生成 =====
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
  id: number;
  trade_id: string;
  tx_hash: string | null;
  parent_trade_id: string | null;
  trade_type: string;
  strategy: string | null;
  chain_id: string;
  contract_address: string;
  symbol: string | null;
  side: string;
  order_type: string | null;
  is_simulated: number;
  payment_token: string | null;
  payment_amount: string | null;
  from_token: string | null;
  from_amount: string | null;
  from_contract: string | null;
  to_token: string | null;
  to_amount: string | null;
  to_contract: string | null;
  price: string;
  price_impact: string | null;
  gas_fee: string | null;
  gas_token: string | null;
  fee_amount: string | null;
  fee_token: string | null;
  stop_loss_price: string | null;
  stop_loss_percent: number | null;
  take_profit_price: string | null;
  take_profit_percent: number | null;
  trigger_reason: string | null;
  trigger_scores: string | null;
  status: string;
  swap_status: string | null;
  pnl: string | null;
  pnl_percent: string | null;
  holding_duration_minutes: number | null;
  created_at: string;
  updated_at: string | null;
  closed_at: string | null;
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

// ===== 全部列定义（中文名） =====
interface ColumnDef {
  key: string;
  title: string;
  width: number;
  dataIndex: string;
  defaultVisible: boolean;
  sorter?: boolean;
  render?: (v: any, r: SimTrade) => React.ReactNode;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'symbol', title: '代币', width: 120, dataIndex: 'symbol', defaultVisible: true,
    render: (v: string | null, r: SimTrade) => <Tag>{v || r.contract_address?.slice(0, 8) + '...'}</Tag> },
  { key: 'chain_id', title: '链', width: 80, dataIndex: 'chain_id', defaultVisible: true,
    render: (v: string) => chainMap[v] || v },
  { key: 'side', title: '方向', width: 70, dataIndex: 'side', defaultVisible: true,
    render: (v: string) => <Tag color={v === 'BUY' ? 'green' : 'red'}>{v === 'BUY' ? '买入' : '卖出'}</Tag> },
  { key: 'status', title: '状态', width: 80, dataIndex: 'status', defaultVisible: true,
    render: (v: string) => <Tag color={v === 'PENDING' ? 'processing' : 'success'}>{v === 'PENDING' ? '持仓' : '已平仓'}</Tag> },
  { key: 'price', title: '价格', width: 120, dataIndex: 'price', defaultVisible: true, sorter: true,
    render: (v: string) => formatPrice(v) },
  { key: 'from_amount', title: '支付金额', width: 100, dataIndex: 'from_amount', defaultVisible: true, sorter: true,
    render: (v: string | null) => v ? formatNumber(parseFloat(v), { prefix: '$' }) : '-' },
  { key: 'to_amount', title: '获得数量', width: 100, dataIndex: 'to_amount', defaultVisible: true, sorter: true,
    render: (v: string | null) => v ? parseFloat(v).toLocaleString() : '-' },
  { key: 'from_token', title: '支付代币', width: 90, dataIndex: 'from_token', defaultVisible: true,
    render: (v: string | null) => v || '-' },
  { key: 'to_token', title: '获得代币', width: 90, dataIndex: 'to_token', defaultVisible: true,
    render: (v: string | null) => v || '-' },
  { key: 'order_type', title: '订单类型', width: 90, dataIndex: 'order_type', defaultVisible: true,
    render: (v: string | null) => <Tag>{v || '-'}</Tag> },
  { key: 'trade_type', title: '交易模式', width: 90, dataIndex: 'trade_type', defaultVisible: true,
    render: (v: string) => <Tag color={v === 'ai_auto' ? 'blue' : 'default'}>{v === 'ai_auto' ? 'AI自动' : '手动'}</Tag> },
  { key: 'is_simulated', title: '模拟/实盘', width: 100, dataIndex: 'is_simulated', defaultVisible: true,
    render: (v: number) => <Tag color={v ? 'orange' : 'green'}>{v ? '模拟' : '实盘'}</Tag> },
  { key: 'strategy', title: '策略', width: 100, dataIndex: 'strategy', defaultVisible: true,
    render: (v: string | null) => v || '-' },
  { key: 'pnl', title: '盈亏', width: 110, dataIndex: 'pnl', defaultVisible: true, sorter: true,
    render: (v: string | null) => {
      if (v == null) return '-';
      const num = parseFloat(v);
      return <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>{formatNumber(num, { prefix: num >= 0 ? '+$' : '$', decimals: 4 })}</span>;
    }},
  { key: 'pnl_percent', title: '盈亏%', width: 90, dataIndex: 'pnl_percent', defaultVisible: true, sorter: true,
    render: (v: string | null) => {
      if (v == null) return '-';
      const num = parseFloat(v);
      return <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>{num >= 0 ? '+' : ''}{num.toFixed(2)}%</span>;
    }},
  { key: 'holding_duration_minutes', title: '持仓时长', width: 100, dataIndex: 'holding_duration_minutes', defaultVisible: true,
    render: (v: number | null) => {
      if (v == null) return '-';
      if (v < 60) return `${v}分钟`;
      if (v < 1440) return `${Math.floor(v / 60)}h ${v % 60}m`;
      return `${Math.floor(v / 1440)}天 ${Math.floor((v % 1440) / 60)}h`;
    }},
  { key: 'stop_loss_price', title: '止损价', width: 110, dataIndex: 'stop_loss_price', defaultVisible: true,
    render: (v: string | null) => v ? formatPrice(v) : '-' },
  { key: 'take_profit_price', title: '止盈价', width: 110, dataIndex: 'take_profit_price', defaultVisible: true,
    render: (v: string | null) => v ? formatPrice(v) : '-' },
  { key: 'stop_loss_percent', title: '止损%', width: 80, dataIndex: 'stop_loss_percent', defaultVisible: false,
    render: (v: number | null) => v != null ? `${v}%` : '-' },
  { key: 'take_profit_percent', title: '止盈%', width: 80, dataIndex: 'take_profit_percent', defaultVisible: false,
    render: (v: number | null) => v != null ? `${v}%` : '-' },
  { key: 'trigger_reason', title: '触发原因', width: 150, dataIndex: 'trigger_reason', defaultVisible: true,
    render: (v: string | null) => <span title={v || ''} style={{ fontSize: 12, color: '#595959' }}>{v ? (v.length > 20 ? v.slice(0, 20) + '...' : v) : '-'}</span> },
  { key: 'gas_fee', title: 'Gas费', width: 90, dataIndex: 'gas_fee', defaultVisible: false,
    render: (v: string | null) => v || '-' },
  { key: 'gas_token', title: 'Gas代币', width: 90, dataIndex: 'gas_token', defaultVisible: false,
    render: (v: string | null) => v || '-' },
  { key: 'trade_id', title: '交易ID', width: 130, dataIndex: 'trade_id', defaultVisible: false,
    render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.slice(0, 12)}...</span> },
  { key: 'tx_hash', title: '交易哈希', width: 130, dataIndex: 'tx_hash', defaultVisible: false,
    render: (v: string | null) => v ? <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.slice(0, 12)}...</span> : '-' },
  { key: 'parent_trade_id', title: '父交易ID', width: 130, dataIndex: 'parent_trade_id', defaultVisible: false,
    render: (v: string | null) => v ? <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.slice(0, 12)}...</span> : '-' },
  { key: 'contract_address', title: '合约地址', width: 140, dataIndex: 'contract_address', defaultVisible: false,
    render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.slice(0, 10)}...{v.slice(-6)}</span> },
  { key: 'price_impact', title: '价格影响', width: 90, dataIndex: 'price_impact', defaultVisible: false,
    render: (v: string | null) => v || '-' },
  { key: 'payment_token', title: '支付代币类型', width: 110, dataIndex: 'payment_token', defaultVisible: false,
    render: (v: string | null) => v || '-' },
  { key: 'payment_amount', title: '支付金额(原始)', width: 120, dataIndex: 'payment_amount', defaultVisible: false,
    render: (v: string | null) => v || '-' },
  { key: 'fee_amount', title: '手续费', width: 90, dataIndex: 'fee_amount', defaultVisible: false,
    render: (v: string | null) => v || '-' },
  { key: 'fee_token', title: '手续费代币', width: 100, dataIndex: 'fee_token', defaultVisible: false,
    render: (v: string | null) => v || '-' },
  { key: 'swap_status', title: 'Swap状态', width: 100, dataIndex: 'swap_status', defaultVisible: false,
    render: (v: string | null) => v || '-' },
  { key: 'trigger_scores', title: '触发评分', width: 130, dataIndex: 'trigger_scores', defaultVisible: false,
    render: (v: string | null) => <span title={v || ''} style={{ fontSize: 11, color: '#595959' }}>{v ? (v.length > 15 ? v.slice(0, 15) + '...' : v) : '-'}</span> },
  { key: 'created_at', title: '创建时间', width: 140, dataIndex: 'created_at', defaultVisible: true, sorter: true,
    render: (v: string) => new Date(v).toLocaleString() },
  { key: 'closed_at', title: '平仓时间', width: 140, dataIndex: 'closed_at', defaultVisible: true,
    render: (v: string | null) => v ? new Date(v).toLocaleString() : '-' },
  { key: 'updated_at', title: '更新时间', width: 140, dataIndex: 'updated_at', defaultVisible: false,
    render: (v: string | null) => v ? new Date(v).toLocaleString() : '-' },
];

// 默认可见列 key 集合
const DEFAULT_VISIBLE_KEYS = new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

// ===== 主组件 =====
const Trading: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [orderForm] = Form.useForm();
  const [orderModalVisible, setOrderModalVisible] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AIAnalysis | null>(null);
  const [queryResult, setQueryResult] = useState<Token | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  // 统计数据
  const [stats, setStats] = useState<SimStatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [allTrades, setAllTrades] = useState<SimTrade[]>([]);

  // 交易概况：合并持仓+历史
  const [trades, setTrades] = useState<SimTrade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesTotal, setTradesTotal] = useState(0);
  const [tradesPage, setTradesPage] = useState(1);
  const [tradesPageSize, setTradesPageSize] = useState(20);
  const [tradesSortField, setTradesSortField] = useState<string>('created_at');
  const [tradesSortOrder, setTradesSortOrder] = useState<'asc' | 'desc'>('desc');

  // 交易概况筛选
  const [filterStatus, setFilterStatus] = useState<string>('all'); // all / PENDING / SUCCESS
  const [filterSimType, setFilterSimType] = useState<string>('all'); // all / simulated / real
  const [filterChain, setFilterChain] = useState<string>('');
  const [filterSide, setFilterSide] = useState<string>('');
  const [filterSymbol, setFilterSymbol] = useState<string>('');

  // 列显示控制
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set(DEFAULT_VISIBLE_KEYS));

  // 订单薄
  const [selectedTrade, setSelectedTrade] = useState<SimTrade | null>(null);
  const [orderBookTrades, setOrderBookTrades] = useState<SimTrade[]>([]);
  const [orderBookLoading, setOrderBookLoading] = useState(false);

  // AI 推荐
  const [aiList, setAiList] = useState<AIAnalysis[]>([]);
  const [aiLoading, setAiLoading] = useState(true);

  // K 线
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

  const loadTrades = useCallback(async (page = 1, pageSize = 20) => {
    setTradesLoading(true);
    try {
      const params: any = { page, pageSize };
      if (filterStatus !== 'all') params.status = filterStatus;
      const res = await simApi.getTrades(params);
      const data = res as any;
      setTrades(data?.data || []);
      setTradesTotal(data?.total || 0);
      setTradesPage(page);
      // 默认选中第一条
      if (data?.data?.length > 0 && !selectedTrade) {
        setSelectedTrade(data.data[0]);
      }
    } catch { /* 静默 */ }
    finally { setTradesLoading(false); }
  }, [filterStatus, selectedTrade]);

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

  const loadOrderBook = useCallback(async (trade: SimTrade) => {
    setOrderBookLoading(true);
    try {
      const res = await simApi.getTrades({ page: 1, pageSize: 200 });
      const data = res as any;
      const allList: SimTrade[] = data?.data || [];
      const filtered = allList.filter(
        (t) => t.contract_address === trade.contract_address && t.chain_id === trade.chain_id
      );
      setOrderBookTrades(filtered.slice(0, 50));
    } catch { setOrderBookTrades([]); }
    finally { setOrderBookLoading(false); }
  }, []);

  useEffect(() => {
    loadStats();
    loadTrades();
    loadAllTradesForChart();
    loadAI();
  }, []);

  useEffect(() => {
    if (selectedTrade) loadOrderBook(selectedTrade);
  }, [selectedTrade]);

  // 筛选条件变化时重新加载
  useEffect(() => {
    loadTrades(1, tradesPageSize);
  }, [filterStatus]);

  // Tab 切换
  const handleTabChange = (key: string) => {
    setActiveTab(key);
    if (key === 'overview') loadTrades(tradesPage, tradesPageSize);
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

  // ===== 客户端筛选+排序 =====
  const filteredTrades = useMemo(() => {
    let list = [...trades];
    if (filterSimType === 'simulated') list = list.filter(t => t.is_simulated === 1);
    if (filterSimType === 'real') list = list.filter(t => t.is_simulated === 0);
    if (filterChain) list = list.filter(t => t.chain_id === filterChain);
    if (filterSide) list = list.filter(t => t.side === filterSide);
    if (filterSymbol) list = list.filter(t => (t.symbol || '').toLowerCase().includes(filterSymbol.toLowerCase()));
    // 排序
    list.sort((a, b) => {
      let va: any, vb: any;
      switch (tradesSortField) {
        case 'price': va = parseFloat(a.price); vb = parseFloat(b.price); break;
        case 'from_amount': va = parseFloat(a.from_amount || '0'); vb = parseFloat(b.from_amount || '0'); break;
        case 'to_amount': va = parseFloat(a.to_amount || '0'); vb = parseFloat(b.to_amount || '0'); break;
        case 'pnl': va = parseFloat(a.pnl || '0'); vb = parseFloat(b.pnl || '0'); break;
        case 'pnl_percent': va = parseFloat(a.pnl_percent || '0'); vb = parseFloat(b.pnl_percent || '0'); break;
        case 'created_at': default: va = new Date(a.created_at).getTime(); vb = new Date(b.created_at).getTime();
      }
      return tradesSortOrder === 'asc' ? (va - vb) : (vb - va);
    });
    return list;
  }, [trades, filterSimType, filterChain, filterSide, filterSymbol, tradesSortField, tradesSortOrder]);

  // 筛选选项
  const filterOptions = useMemo(() => {
    const chains = new Set<string>();
    const symbols = new Set<string>();
    trades.forEach(t => {
      if (t.chain_id) chains.add(t.chain_id);
      if (t.symbol) symbols.add(t.symbol);
    });
    return { chains, symbols };
  }, [trades]);

  // ===== 每日盈亏图表 =====
  const dailyPnl = useMemo(() => {
    const closedTrades = allTrades.filter(t => t.status === 'SUCCESS' && t.pnl && t.closed_at);
    const map = new Map<string, number>();
    for (const t of closedTrades) {
      const dateStr = new Date(t.closed_at!).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
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
    if (!selectedTrade) return [];
    const price = parseFloat(selectedTrade.price) || 1;
    return generateKlineData(klinePeriod, price);
  }, [selectedTrade, klinePeriod]);

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

  // ===== 统计卡片 =====
  const winRateNum = stats ? parseFloat(stats.winRate) : 0;
  const totalPnlNum = stats ? parseFloat(stats.totalPnl) : 0;

  // ===== 动态列 =====
  const visibleColumns = useMemo(() => {
    return ALL_COLUMNS.filter(c => visibleKeys.has(c.key));
  }, [visibleKeys]);

  // 列显示/隐藏 Popover
  const columnSettingContent = (
    <div style={{ maxHeight: 400, overflow: 'auto', width: 280 }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Button size="small" type="link" onClick={() => setVisibleKeys(new Set(ALL_COLUMNS.map(c => c.key)))}>全选</Button>
        <Button size="small" type="link" onClick={() => setVisibleKeys(new Set())}>全不选</Button>
        <Button size="small" type="link" onClick={() => setVisibleKeys(new Set(DEFAULT_VISIBLE_KEYS))}>恢复默认</Button>
      </div>
      <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
        {ALL_COLUMNS.map(col => (
          <div key={col.key} style={{ padding: '2px 0' }}>
            <Checkbox
              checked={visibleKeys.has(col.key)}
              onChange={(e) => {
                const next = new Set(visibleKeys);
                if (e.target.checked) next.add(col.key); else next.delete(col.key);
                setVisibleKeys(next);
              }}
            >
              {col.title}
            </Checkbox>
          </div>
        ))}
      </div>
    </div>
  );

  // 订单薄列
  const orderBookColumns = [
    { title: '时间', dataIndex: 'created_at', key: 'time', width: 130,
      render: (v: string) => new Date(v).toLocaleString() },
    { title: '方向', dataIndex: 'side', key: 'side', width: 60,
      render: (v: string) => <Tag color={v === 'BUY' ? 'green' : 'red'} style={{ fontSize: 11, padding: '0 4px' }}>{v === 'BUY' ? '买' : '卖'}</Tag> },
    { title: '价格', dataIndex: 'price', key: 'price', width: 100,
      render: (v: string) => formatPrice(v) },
    { title: '数量', dataIndex: 'to_amount', key: 'qty', width: 80,
      render: (v: string | null) => v ? parseFloat(v).toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 60,
      render: (v: string) => <Tag color={v === 'PENDING' ? 'blue' : 'default'} style={{ fontSize: 11, padding: '0 4px' }}>{v === 'PENDING' ? '持仓' : '平仓'}</Tag> },
  ];

  // ===== 渲染 =====

  const renderStatsAndKline = () => (
    <Spin spinning={statsLoading}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'stretch' }}>
        {/* 左侧：统计指标 + 每日盈亏，垂直排列 */}
        <div style={{ width: 390, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 第一行：交易概况 */}
          <Card size="small" bodyStyle={{ padding: '6px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: '#262626' }}>交易概况</span>
              <span>总交易次数: <strong>{stats?.total ?? '-'}</strong></span>
              <span>开仓: <strong>{stats?.open ?? '-'}</strong></span>
              <span>平仓: <strong>{stats?.closed ?? '-'}</strong></span>
              <span>胜率: <strong style={{ color: winRateNum >= 50 ? '#3f8600' : '#cf1322' }}>{winRateNum.toFixed(1)}%</strong></span>
              <span>盈亏: <strong style={{ color: totalPnlNum >= 0 ? '#3f8600' : '#cf1322' }}>{totalPnlNum >= 0 ? '+' : ''}{totalPnlNum.toFixed(3)}</strong></span>
              {dailyPnl.values.length > 0 && (
                <span>日盈亏: <strong style={{ color: dailyPnl.values[dailyPnl.values.length - 1] >= 0 ? '#3f8600' : '#cf1322' }}>
                  {dailyPnl.values[dailyPnl.values.length - 1] >= 0 ? '+' : ''}{dailyPnl.values[dailyPnl.values.length - 1].toFixed(2)}
                </strong></span>
              )}
            </div>
          </Card>
          {/* 第三行：每日盈亏迷你图 */}
          <Card title="📊 每日盈亏" size="small" style={{ flex: 1, minHeight: 0 }} bodyStyle={{ padding: '4px 8px' }}>
            {dailyPnl.dates.length > 0 ? (
              <ReactECharts option={dailyPnlOption} style={{ height: 120 }} />
            ) : (
              <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 16 }}>暂无已平仓交易数据</div>
            )}
          </Card>
        </div>

        {/* 右侧：K线图 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedTrade ? (
            <Card
              title={
                <Space>
                  📈 K 线图
                  <Tag color="blue">{selectedTrade.symbol || selectedTrade.contract_address?.slice(0, 8)}</Tag>
                  <Tag>{chainMap[selectedTrade.chain_id] || selectedTrade.chain_id}</Tag>
                </Space>
              }
              size="small"
              style={{ height: '100%' }}
              bodyStyle={{ height: 'calc(100% - 46px)', display: 'flex', flexDirection: 'column', padding: '8px 12px' }}
              extra={
                <Space size={4}>
                  {klinePeriods.map(p => (
                    <Button key={p.key} size="small" type={klinePeriod === p.key ? 'primary' : 'default'}
                      onClick={() => setKlinePeriod(p.key)}>{p.label}</Button>
                  ))}
                </Space>
              }
            >
              <ReactECharts option={klineOption} style={{ flex: 1, minHeight: 120 }} />
            </Card>
          ) : (
            <Card size="small" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 30 }}>选择交易查看 K 线图</div>
            </Card>
          )}
        </div>
      </div>
    </Spin>
  );



  // 交易概况 Tab
  const renderOverview = () => (
    <>
      {/* 筛选区域 */}
      <div style={{ marginBottom: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>筛选：</span>
        <Select
          style={{ width: 110 }} size="small"
          value={filterStatus}
          onChange={(v) => setFilterStatus(v)}
        >
          <Select.Option value="all">全部状态</Select.Option>
          <Select.Option value="PENDING">当前持仓</Select.Option>
          <Select.Option value="SUCCESS">历史交易</Select.Option>
        </Select>
        <Select
          style={{ width: 110 }} size="small"
          value={filterSimType}
          onChange={(v) => setFilterSimType(v)}
        >
          <Select.Option value="all">全部类型</Select.Option>
          <Select.Option value="simulated">模拟交易</Select.Option>
          <Select.Option value="real">实盘交易</Select.Option>
        </Select>
        <Select
          allowClear placeholder="链" style={{ width: 100 }} size="small"
          value={filterChain || undefined}
          onChange={(v) => setFilterChain(v || '')}
        >
          {Array.from(filterOptions.chains).map(c => <Select.Option key={c} value={c}>{chainMap[c] || c}</Select.Option>)}
        </Select>
        <Select
          allowClear placeholder="方向" style={{ width: 90 }} size="small"
          value={filterSide || undefined}
          onChange={(v) => setFilterSide(v || '')}
        >
          <Select.Option value="BUY">买入</Select.Option>
          <Select.Option value="SELL">卖出</Select.Option>
        </Select>
        <Input
          placeholder="代币名" style={{ width: 100 }} size="small" allowClear
          value={filterSymbol || undefined}
          onChange={(e) => setFilterSymbol(e.target.value || '')}
        />
        <Button size="small" icon={<ClearOutlined />} onClick={() => {
          setFilterStatus('all'); setFilterSimType('all'); setFilterChain(''); setFilterSide(''); setFilterSymbol('');
        }}>
          重置
        </Button>
        <Popover content={columnSettingContent} title="显示列" trigger="click" placement="bottomRight">
          <Button size="small" icon={<SettingOutlined />}>列设置</Button>
        </Popover>
        <span style={{ marginLeft: 'auto', color: '#8c8c8c', fontSize: 12 }}>
          共 {filteredTrades.length} 条
        </span>
      </div>

      {/* 主体：左侧表格 + 右侧订单薄 */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        <div style={{ flex: 2, minWidth: 0 }}>
          <Card size="small" className="compact-table" style={{ height: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', flex: 1 }}>
            <Table
              dataSource={filteredTrades}
              columns={visibleColumns}
              rowKey="trade_id"
              size="small"
              loading={tradesLoading}
              scroll={{ x: 1200, y: 410 }}
              pagination={false}
              locale={{ emptyText: '暂无交易数据' }}
              onChange={(_pg, _flt, sorter: any) => {
                if (sorter.field) {
                  setTradesSortField(sorter.field);
                  setTradesSortOrder(sorter.order === 'ascend' ? 'asc' : 'desc');
                }
              }}
              onRow={(record) => ({
                onClick: () => setSelectedTrade(record),
                style: { cursor: 'pointer', background: selectedTrade?.trade_id === record.trade_id ? '#e6f7ff' : undefined },
              })}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, padding: '0 8px' }}>
              <Space size={8}>
                {[10, 20, 50, 100].map(size => (
                  <Button
                    key={size} size="small"
                    type={tradesPageSize === size ? 'primary' : 'default'}
                    onClick={() => { setTradesPageSize(size); loadTrades(1, size); }}
                  >
                    {size}条/页
                  </Button>
                ))}
              </Space>
              <Space size={8}>
                <Button size="small" disabled={tradesPage <= 1}
                  onClick={() => loadTrades(tradesPage - 1, tradesPageSize)}>上一页</Button>
                <span style={{ fontSize: 12, color: '#595959' }}>
                  {tradesPage} / {Math.max(1, Math.ceil(tradesTotal / tradesPageSize))}
                </span>
                <Button size="small" disabled={tradesPage >= Math.ceil(tradesTotal / tradesPageSize)}
                  onClick={() => loadTrades(tradesPage + 1, tradesPageSize)}>下一页</Button>
              </Space>
            </div>
          </Card>
        </div>

        {/* 右侧：订单薄 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Card
            title={
              <Space>
                📋 订单薄
                {selectedTrade && (
                  <Tag color="blue" style={{ fontSize: 11 }}>
                    {selectedTrade.symbol || selectedTrade.contract_address?.slice(0, 8)}
                  </Tag>
                )}
              </Space>
            }
            size="small"
            bodyStyle={{ padding: 0 }}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          >
            <Spin spinning={orderBookLoading}>
              <Table
                dataSource={orderBookTrades}
                columns={orderBookColumns}
                rowKey="trade_id"
                size="small"
                pagination={false}
                scroll={{ y: 410 }}
                locale={{ emptyText: '选择交易查看订单薄' }}
                style={{ fontSize: 12, flex: 1 }}
              />
            </Spin>
          </Card>
        </div>
      </div>
    </>
  );

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

  const tabItems = [
    {
      key: 'overview',
      label: <><HistoryOutlined /> 交易概况</>,
      children: renderOverview(),
    },
    { key: 'ai', label: <><RobotOutlined /> AI 推荐</>, children: renderAIRecommendations() },
    { key: 'manual', label: <><EditOutlined /> 手动下单</>, children: renderManualOrder() },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0 }}>
        {renderStatsAndKline()}
      </div>
      <Card size="small" bodyStyle={{ padding: '8px 16px' }} style={{ flex: 1, minHeight: 0, overflow: 'auto', marginTop: 12 }}>
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
