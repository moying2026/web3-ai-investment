import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, Card, Table, Tag, Button, Form, Input, Select, InputNumber, Space, Row, Col, Statistic, Modal, message, Descriptions, Spin } from 'antd';
import {
  RobotOutlined,
  EditOutlined,
  WalletOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { Token } from '../../types';
import { tokenApi, simApi, aiApi } from '../../services/api';
import { formatPrice, formatVolume, formatNumber } from '../../utils/format';

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

const Trading: React.FC = () => {
  const [activeTab, setActiveTab] = useState('positions');
  const [orderForm] = Form.useForm();
  const [orderModalVisible, setOrderModalVisible] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AIAnalysis | null>(null);
  const [queryResult, setQueryResult] = useState<Token | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  // 持仓数据
  const [positions, setPositions] = useState<SimTrade[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);

  // 历史数据
  const [history, setHistory] = useState<SimTrade[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);

  // AI 推荐数据
  const [aiList, setAiList] = useState<AIAnalysis[]>([]);
  const [aiLoading, setAiLoading] = useState(true);

  // 加载持仓
  const loadPositions = useCallback(async () => {
    setPositionsLoading(true);
    try {
      const res = await simApi.getTrades({ status: 'OPEN', page: 1, pageSize: 100 });
      const data = res as any;
      setPositions(data?.data || []);
    } catch { /* 静默 */ }
    finally { setPositionsLoading(false); }
  }, []);

  // 加载历史
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

  // 加载 AI 推荐
  const loadAI = useCallback(async () => {
    setAiLoading(true);
    try {
      const res = await aiApi.getRecommendations({ page: 1, pageSize: 50 });
      const data = res as any;
      setAiList(data?.data || []);
    } catch { /* 静默 */ }
    finally { setAiLoading(false); }
  }, []);

  useEffect(() => {
    loadPositions();
    loadHistory();
    loadAI();
  }, []);

  // Tab 切换时刷新对应数据
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
    if (!chain || !address) {
      message.warning('请先选择链和输入合约地址');
      return;
    }
    setQueryLoading(true);
    try {
      const data = await tokenApi.getDetail(chain, address);
      setQueryResult(data as any);
      message.success('查询成功');
    } catch {
      message.error('代币未找到');
      setQueryResult(null);
    } finally {
      setQueryLoading(false);
    }
  };

  // 链名称映射
  const chainMap: Record<string, string> = { '56': 'BSC', 'CT_501': 'SOL', '1': 'ETH', '8453': 'Base' };

  // AI 推荐卡片
  const renderAIRecommendations = () => (
    <Spin spinning={aiLoading}>
      {aiList.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 60 }}>暂无 AI 分析数据</div>
      ) : (
        <Row gutter={[16, 16]}>
          {aiList.map(item => (
            <Col span={8} key={item.id}>
              <Card
                hoverable
                onClick={() => {
                  setSelectedAnalysis(item);
                  setOrderModalVisible(true);
                  orderForm.setFieldsValue({
                    chain: item.chain_id,
                    address: item.contract_address,
                    symbol: item.symbol,
                    side: item.recommendation === 'BUY' ? 'buy' : 'sell',
                  });
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Space>
                    <ThunderboltOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                    <span style={{ fontSize: 18, fontWeight: 'bold' }}>{item.symbol || '未知'}</span>
                  </Space>
                  <Tag color={
                    item.recommendation === 'BUY' ? 'green' :
                    item.recommendation === 'SELL' ? 'red' :
                    item.recommendation === 'HOLD' ? 'blue' : 'default'
                  }>
                    {item.recommendation === 'BUY' ? '买入' :
                     item.recommendation === 'SELL' ? '卖出' :
                     item.recommendation === 'HOLD' ? '持有' : item.recommendation}
                  </Tag>
                </div>
                <div style={{ marginBottom: 8, color: '#8c8c8c' }}>{chainMap[item.chain_id] || item.chain_id}</div>
                {item.reasons && (
                  <div style={{ marginBottom: 12, fontSize: 12, color: '#595959' }}>
                    {typeof item.reasons === 'string' ? item.reasons : JSON.stringify(item.reasons).slice(0, 100)}
                  </div>
                )}
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic title="评分" value={item.score} valueStyle={{ fontSize: 16 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="链" value={chainMap[item.chain_id] || item.chain_id} valueStyle={{ fontSize: 16 }} />
                  </Col>
                  <Col span={8}>
                    <Tag color={
                      item.risk_level === 'low' ? 'green' :
                      item.risk_level === 'medium' ? 'orange' : 'red'
                    } style={{ marginTop: 8 }}>
                      {item.risk_level === 'low' ? '低风险' :
                       item.risk_level === 'medium' ? '中风险' : '高风险'}
                    </Tag>
                  </Col>
                </Row>
                <div style={{ marginTop: 8, fontSize: 11, color: '#8c8c8c' }}>
                  {item.analyzed_at ? new Date(item.analyzed_at).toLocaleString() : ''}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Spin>
  );

  // 手动下单表单
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
          <Input
            placeholder="输入代币合约地址"
            addonAfter={
              <Button
                type="link"
                size="small"
                icon={<SearchOutlined />}
                loading={queryLoading}
                onClick={handleQueryToken}
                style={{ margin: -4 }}
              >
                查询
              </Button>
            }
          />
        </Form.Item>

        {/* 查询结果 */}
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
          <Col span={8}>
            <Form.Item label="金额(USD)" name="amount" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} placeholder="100" min={1} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="限价" name="limitPrice">
              <InputNumber style={{ width: '100%' }} placeholder="可选" min={0} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="止损" name="stopLoss">
              <InputNumber style={{ width: '100%' }} placeholder="可选" min={0} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="止盈" name="takeProfit">
              <InputNumber style={{ width: '100%' }} placeholder="可选" min={0} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item>
          <Button type="primary" size="large" block>
            下单
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );

  // 持仓表格列
  const positionColumns = [
    {
      title: '代币',
      key: 'symbol',
      width: 120,
      render: (_: any, record: SimTrade) => (
        <Tag>{record.symbol || record.contract_address?.slice(0, 8) + '...'}</Tag>
      ),
    },
    {
      title: '链',
      dataIndex: 'chain_id',
      key: 'chain_id',
      width: 80,
      render: (v: string) => chainMap[v] || v,
    },
    {
      title: '方向',
      dataIndex: 'side',
      key: 'side',
      width: 70,
      render: (v: string) => <Tag color={v === 'BUY' ? 'green' : 'red'}>{v === 'BUY' ? '买入' : '卖出'}</Tag>,
    },
    {
      title: '入场价',
      dataIndex: 'entry_price',
      key: 'entry_price',
      width: 120,
      render: (v: string) => formatPrice(v),
    },
    {
      title: '数量',
      dataIndex: 'entry_quantity',
      key: 'entry_quantity',
      width: 100,
      render: (v: string | null) => v ? parseFloat(v).toLocaleString() : '-',
    },
    {
      title: '金额',
      dataIndex: 'entry_amount',
      key: 'entry_amount',
      width: 100,
      render: (v: string | null) => v ? formatNumber(parseFloat(v), { prefix: '$' }) : '-',
    },
    {
      title: '止损',
      dataIndex: 'stop_loss_price',
      key: 'stop_loss_price',
      width: 100,
      render: (v: string | null) => v ? formatPrice(v) : '-',
    },
    {
      title: '止盈',
      dataIndex: 'take_profit_price',
      key: 'take_profit_price',
      width: 100,
      render: (v: string | null) => v ? formatPrice(v) : '-',
    },
    {
      title: '触发原因',
      dataIndex: 'trigger_reason',
      key: 'trigger_reason',
      width: 120,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: '模式',
      dataIndex: 'trade_type',
      key: 'trade_type',
      width: 80,
      render: (v: string) => <Tag color={v === 'ai_auto' ? 'blue' : 'default'}>{v === 'ai_auto' ? 'AI' : '手动'}</Tag>,
    },
    {
      title: '入场时间',
      dataIndex: 'entry_time',
      key: 'entry_time',
      width: 140,
      render: (v: string) => new Date(v).toLocaleString(),
    },
  ];

  // 历史交易列
  const historyColumns = [
    {
      title: '时间',
      dataIndex: 'exit_time',
      key: 'exit_time',
      width: 140,
      render: (v: string | null) => v ? new Date(v).toLocaleString() : '-',
    },
    {
      title: '代币',
      key: 'symbol',
      width: 100,
      render: (_: any, record: SimTrade) => (
        <Tag>{record.symbol || record.contract_address?.slice(0, 8) + '...'}</Tag>
      ),
    },
    {
      title: '方向',
      dataIndex: 'side',
      key: 'side',
      width: 70,
      render: (v: string) => <Tag color={v === 'BUY' ? 'green' : 'red'}>{v === 'BUY' ? '买入' : '卖出'}</Tag>,
    },
    {
      title: '入场价',
      dataIndex: 'entry_price',
      key: 'entry_price',
      width: 110,
      render: (v: string) => formatPrice(v),
    },
    {
      title: '出场价',
      dataIndex: 'exit_price',
      key: 'exit_price',
      width: 110,
      render: (v: string | null) => v ? formatPrice(v) : '-',
    },
    {
      title: '盈亏',
      dataIndex: 'pnl',
      key: 'pnl',
      width: 120,
      render: (v: string | null) => {
        if (v == null) return '-';
        const num = parseFloat(v);
        return (
          <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {formatNumber(num, { prefix: num >= 0 ? '+$' : '$', decimals: 4 })}
          </span>
        );
      },
    },
    {
      title: '盈亏%',
      dataIndex: 'pnl_percent',
      key: 'pnl_percent',
      width: 90,
      render: (v: string | null) => {
        if (v == null) return '-';
        const num = parseFloat(v);
        return (
          <span style={{ color: num >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {num >= 0 ? '+' : ''}{num.toFixed(2)}%
          </span>
        );
      },
    },
    {
      title: '持仓时长',
      dataIndex: 'holding_duration_minutes',
      key: 'holding_duration_minutes',
      width: 100,
      render: (v: number | null) => {
        if (v == null) return '-';
        if (v < 60) return `${v}分钟`;
        if (v < 1440) return `${Math.floor(v / 60)}h ${v % 60}m`;
        return `${Math.floor(v / 1440)}天 ${Math.floor((v % 1440) / 60)}h`;
      },
    },
    {
      title: '模式',
      dataIndex: 'trade_type',
      key: 'trade_type',
      width: 80,
      render: (v: string) => <Tag color={v === 'ai_auto' ? 'blue' : 'default'}>{v === 'ai_auto' ? 'AI' : '手动'}</Tag>,
    },
    {
      title: '平仓原因',
      dataIndex: 'exit_reason',
      key: 'exit_reason',
      width: 100,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
  ];

  const tabItems = [
    {
      key: 'positions',
      label: <><WalletOutlined /> 当前持仓</>,
      children: (
        <Table
          dataSource={positions}
          columns={positionColumns}
          rowKey="trade_id"
          size="small"
          loading={positionsLoading}
          scroll={{ x: 1100 }}
          pagination={false}
          locale={{ emptyText: '暂无持仓' }}
        />
      ),
    },
    {
      key: 'ai',
      label: <><RobotOutlined /> AI 推荐</>,
      children: renderAIRecommendations(),
    },
    {
      key: 'manual',
      label: <><EditOutlined /> 手动下单</>,
      children: renderManualOrder(),
    },
    {
      key: 'history',
      label: <><HistoryOutlined /> 历史交易</>,
      children: (
        <Table
          dataSource={history}
          columns={historyColumns}
          rowKey="trade_id"
          size="small"
          loading={historyLoading}
          scroll={{ x: 1100 }}
          pagination={{
            current: historyPage,
            pageSize: 20,
            total: historyTotal,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => loadHistory(p),
          }}
        />
      ),
    },
  ];

  return (
    <div>
      <Card>
        <Tabs activeKey={activeTab} onChange={handleTabChange} items={tabItems} />
      </Card>

      <Modal
        title="确认下单"
        open={orderModalVisible}
        onCancel={() => setOrderModalVisible(false)}
        onOk={() => { message.success('下单成功'); setOrderModalVisible(false); }}
      >
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
