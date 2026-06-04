import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Card, Statistic, Tag, Table, Badge, Switch, Space, message, Spin, Select, Input, InputNumber, Button, Form, Segmented, Progress } from 'antd';
import {
  WalletOutlined,
  FundOutlined,
  ThunderboltOutlined,
  SyncOutlined,
  FilterOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import type { Token, Stats } from '../../types';
import { tokenApi, statsApi, createNewTokenSSE } from '../../services/api';
import { mockPortfolioCurve } from '../../mock/data';
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

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
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

  // SSE + 初始加载
  useEffect(() => {
    loadStats();
    loadTokens();

    let es: EventSource | null = null;
    try {
      es = createNewTokenSSE();
      es.onopen = () => setSseConnected(true);
      es.onerror = () => setSseConnected(false);
      es.onmessage = (e) => {
        try {
          JSON.parse(e.data);
          // SSE 新币推送时，如果无筛选条件则刷新列表
          if (Object.keys(filters).length === 0) {
            loadTokens(pagination.page, pagination.pageSize, filters);
          }
          loadStats();
        } catch { /* ignore */ }
      };
    } catch { /* SSE 不可用 */ }

    return () => { es?.close(); };
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

  // 收益曲线（Mock）
  const curveOption = {
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'category' as const, data: mockPortfolioCurve.map(d => d.date) },
    yAxis: { type: 'value' as const },
    series: [{
      data: mockPortfolioCurve.map(d => d.value),
      type: 'line',
      smooth: true,
      areaStyle: { opacity: 0.3 },
      itemStyle: { color: '#1890ff' },
    }],
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
  };

  // 表格列
  const tokenColumns = [
    {
      title: '代币',
      key: 'symbol',
      width: 200,
      render: (_: any, record: Token) => (
        <Space>
          {record.icon ? (
            <img
              src={`https://www.binance.com${record.icon}`}
              alt=""
              style={{ width: 24, height: 24, borderRadius: '50%' }}
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
                const fb = el.nextElementSibling as HTMLElement;
                if (fb) fb.style.display = 'flex';
              }}
            />
          ) : null}
          <span
            style={{
              width: 24, height: 24, borderRadius: '50%', background: '#1890ff', color: '#fff',
              display: record.icon ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 'bold',
            }}
          >
            {record.symbol?.charAt(0) || '?'}
          </span>
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
      width: 150,
      render: (_: any, record: Token) => (
        <Space size={2} wrap>
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
      {/* 顶部统计栏 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="代币总数" value={stats?.totalTokens ?? '-'} prefix={<WalletOutlined />} loading={!stats} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="今日新增" value={stats?.todayNewTokens ?? '-'} prefix={<FundOutlined />} valueStyle={{ color: '#1890ff' }} loading={!stats} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="社交话题" value={stats?.totalSocialTopics ?? '-'} prefix={<ThunderboltOutlined />} loading={!stats} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#8c8c8c', marginBottom: 8 }}>交易模式</div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{autoMode ? '🤖 AI全自动' : '👤 AI辅助'}</div>
              </div>
              <Switch checked={autoMode} onChange={setAutoMode} checkedChildren="自动" unCheckedChildren="手动" />
            </div>
          </Card>
        </Col>
      </Row>

      {/* 收益曲线（Mock） */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={24}>
          <Card title="📈 组合收益曲线（模拟）" size="small">
            <ReactECharts option={curveOption} style={{ height: 300 }} />
          </Card>
        </Col>
      </Row>

      {/* 快速分类切换 */}
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={coinType}
          onChange={(val) => handleCoinTypeChange(val as string)}
          options={[
            { label: '全部', value: 'all' },
            { label: '🆕 新币', value: 'new' },
            { label: '🔥 热门', value: 'trending' },
          ]}
        />
      </div>

      {/* 筛选区域 */}
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={<><FilterOutlined /> 筛选条件</>}
        extra={
          <Space>
            <Button type="primary" size="small" icon={<FilterOutlined />} onClick={handleFilter}>查询</Button>
            <Button size="small" icon={<ClearOutlined />} onClick={handleReset}>重置</Button>
          </Space>
        }
      >
        <Form form={filterForm} layout="inline" style={{ flexWrap: 'wrap', gap: '8px 0' }}>
          <Form.Item label="所属链" name="chain" initialValue="all">
            <Select style={{ width: 120 }}>
              <Select.Option value="all">全部</Select.Option>
              <Select.Option value="56">BSC</Select.Option>
              <Select.Option value="CT_501">Solana</Select.Option>
              <Select.Option value="8453">Base</Select.Option>
              <Select.Option value="1">ETH</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="发行时间" name="launch_within" initialValue="all">
            <Select style={{ width: 130 }}>
              <Select.Option value="all">全部</Select.Option>
              <Select.Option value="1h">最近1小时</Select.Option>
              <Select.Option value="6h">最近6小时</Select.Option>
              <Select.Option value="24h">最近24小时</Select.Option>
              <Select.Option value="3d">最近3天</Select.Option>
              <Select.Option value="7d">最近7天</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="风险等级" name="risk_level" initialValue="all">
            <Select style={{ width: 120 }}>
              <Select.Option value="all">全部</Select.Option>
              <Select.Option value="low">低风险</Select.Option>
              <Select.Option value="medium">中风险</Select.Option>
              <Select.Option value="high">高风险</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="审计风险" name="audit_risk" initialValue="all">
            <Select style={{ width: 120 }}>
              <Select.Option value="all">全部</Select.Option>
              <Select.Option value="safe">安全</Select.Option>
              <Select.Option value="warning">警告</Select.Option>
              <Select.Option value="danger">危险</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="发行方" name="creator">
            <Input placeholder="合约地址" style={{ width: 200 }} allowClear />
          </Form.Item>
          <Form.Item label="持有人" style={{ marginBottom: 0 }}>
            <Space size={4}>
              <Form.Item name="holders_min" noStyle>
                <InputNumber placeholder="最小" style={{ width: 80 }} min={0} />
              </Form.Item>
              <span>~</span>
              <Form.Item name="holders_max" noStyle>
                <InputNumber placeholder="最大" style={{ width: 80 }} min={0} />
              </Form.Item>
            </Space>
          </Form.Item>
          <Form.Item label="流动性($)" style={{ marginBottom: 0 }}>
            <Space size={4}>
              <Form.Item name="liquidity_min" noStyle>
                <InputNumber placeholder="最小" style={{ width: 100 }} min={0} />
              </Form.Item>
              <span>~</span>
              <Form.Item name="liquidity_max" noStyle>
                <InputNumber placeholder="最大" style={{ width: 100 }} min={0} />
              </Form.Item>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 新币表格 */}
      <Row gutter={16}>
        <Col span={24}>
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
          >
            <Spin spinning={loading}>
              <Table
                dataSource={tokens}
                columns={tokenColumns}
                rowKey="id"
                size="small"
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
                  onClick: () => navigate(`/token/${record.chain_id}/${record.contract_address}`),
                  style: { cursor: 'pointer' },
                })}
                scroll={{ x: 1300 }}
              />
            </Spin>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
