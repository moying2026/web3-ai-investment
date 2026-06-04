import React, { useState } from 'react';
import { Tabs, Card, Table, Tag, Button, Form, Input, Select, InputNumber, Space, Row, Col, Statistic, Modal, message, Descriptions } from 'antd';
import {
  RobotOutlined,
  EditOutlined,
  WalletOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { AIRecommendation, Position, Token } from '../../types';
import { tokenApi } from '../../services/api';
import { mockRecommendations, mockPositions, mockTrades } from '../../mock/data';
import { formatPrice, formatVolume, formatNumber } from '../../utils/format';

const Trading: React.FC = () => {
  const [activeTab, setActiveTab] = useState('ai');
  const [orderForm] = Form.useForm();
  const [orderModalVisible, setOrderModalVisible] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] = useState<AIRecommendation | null>(null);
  const [queryResult, setQueryResult] = useState<Token | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

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

  // AI推荐卡片
  const renderAIRecommendations = () => (
    <Row gutter={[16, 16]}>
      {mockRecommendations.map(rec => (
        <Col span={8} key={rec.id}>
          <Card
            hoverable
            onClick={() => {
              setSelectedRecommendation(rec);
              setOrderModalVisible(true);
              orderForm.setFieldsValue({
                chain: rec.chain,
                address: rec.address,
                symbol: rec.symbol,
                side: rec.action === 'buy' ? 'buy' : 'sell',
              });
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Space>
                <ThunderboltOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                <span style={{ fontSize: 18, fontWeight: 'bold' }}>{rec.symbol}</span>
              </Space>
              <Tag color={rec.action === 'buy' ? 'green' : rec.action === 'sell' ? 'red' : rec.action === 'hold' ? 'blue' : 'default'}>
                {rec.action === 'buy' ? '买入' : rec.action === 'sell' ? '卖出' : rec.action === 'hold' ? '持有' : '观望'}
              </Tag>
            </div>
            <div style={{ marginBottom: 8, color: '#8c8c8c' }}>{rec.name}</div>
            <div style={{ marginBottom: 12 }}>{rec.reasoning}</div>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="置信度" value={rec.confidence} suffix="%" valueStyle={{ fontSize: 16 }} />
              </Col>
              <Col span={8}>
                <Statistic title="目标价" value={rec.targetPrice} prefix="$" valueStyle={{ fontSize: 16 }} />
              </Col>
              <Col span={8}>
                <Statistic title="止损价" value={rec.stopLoss} prefix="$" valueStyle={{ fontSize: 16, color: '#ff4d4f' }} />
              </Col>
            </Row>
            <div style={{ marginTop: 12 }}>
              <Tag color={rec.riskLevel === 'low' ? 'green' : rec.riskLevel === 'medium' ? 'orange' : 'red'}>
                {rec.riskLevel === 'low' ? '低风险' : rec.riskLevel === 'medium' ? '中风险' : '高风险'}
              </Tag>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
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

  // 持仓表格
  const positionColumns = [
    { title: '代币', dataIndex: 'symbol', key: 'symbol', render: (v: string) => <Tag>{v}</Tag> },
    { title: '链', dataIndex: 'chain', key: 'chain' },
    { title: '方向', dataIndex: 'side', key: 'side', render: (v: string) => (
      <Tag color={v === 'long' ? 'green' : 'red'}>{v === 'long' ? '多' : '空'}</Tag>
    )},
    { title: '数量', dataIndex: 'amount', key: 'amount' },
    { title: '入场价', dataIndex: 'entryPrice', key: 'entryPrice', render: (v: number) => formatPrice(v) },
    { title: '当前价', dataIndex: 'currentPrice', key: 'currentPrice', render: (v: number) => formatPrice(v) },
    {
      title: '盈亏',
      dataIndex: 'pnl',
      key: 'pnl',
      render: (v: number, record: Position) => (
        <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {formatNumber(v, { prefix: v >= 0 ? '+' : '' })} USD ({formatNumber(record.pnlPercent, { suffix: '%' })})
        </span>
      ),
    },
    { title: '止损', dataIndex: 'stopLoss', key: 'stopLoss', render: (v?: number) => v ? formatPrice(v) : '-' },
    { title: '止盈', dataIndex: 'takeProfit', key: 'takeProfit', render: (v?: number) => v ? formatPrice(v) : '-' },
    {
      title: '操作',
      key: 'action',
      render: () => <Button danger size="small">平仓</Button>,
    },
  ];

  // 历史交易表格
  const tradeColumns = [
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
    { title: '代币', dataIndex: 'symbol', key: 'symbol', render: (v: string) => <Tag>{v}</Tag> },
    { title: '链', dataIndex: 'chain', key: 'chain' },
    { title: '方向', dataIndex: 'side', key: 'side', render: (v: string) => (
      <Tag color={v === 'buy' ? 'green' : 'red'}>{v === 'buy' ? '买入' : '卖出'}</Tag>
    )},
    { title: '数量', dataIndex: 'amount', key: 'amount' },
    { title: '价格', dataIndex: 'price', key: 'price', render: (v: number) => formatPrice(v) },
    { title: '总额', dataIndex: 'total', key: 'total', render: (v: number) => formatNumber(v, { prefix: '$' }) },
    {
      title: '盈亏',
      dataIndex: 'pnl',
      key: 'pnl',
      render: (v?: number) => v !== undefined ? (
        <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {formatNumber(v, { prefix: v >= 0 ? '+$' : '$' })}
        </span>
      ) : '-',
    },
    { title: '模式', dataIndex: 'mode', key: 'mode', render: (v: string) => (
      <Tag color={v === 'ai' ? 'blue' : 'default'}>{v === 'ai' ? 'AI' : '手动'}</Tag>
    )},
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => (
      <Tag color={v === 'filled' ? 'green' : v === 'pending' ? 'orange' : 'default'}>
        {v === 'filled' ? '已成交' : v === 'pending' ? '待成交' : '已取消'}
      </Tag>
    )},
  ];

  const tabItems = [
    {
      key: 'ai',
      label: <><RobotOutlined /> AI推荐</>,
      children: renderAIRecommendations(),
    },
    {
      key: 'manual',
      label: <><EditOutlined /> 手动下单</>,
      children: renderManualOrder(),
    },
    {
      key: 'positions',
      label: <><WalletOutlined /> 当前持仓</>,
      children: <Table dataSource={mockPositions} columns={positionColumns} rowKey="id" pagination={false} />,
    },
    {
      key: 'history',
      label: <><HistoryOutlined /> 历史交易</>,
      children: <Table dataSource={mockTrades} columns={tradeColumns} rowKey="id" pagination={{ pageSize: 20 }} />,
    },
  ];

  return (
    <div>
      <Card>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </Card>

      <Modal
        title="确认下单"
        open={orderModalVisible}
        onCancel={() => setOrderModalVisible(false)}
        onOk={() => { message.success('下单成功'); setOrderModalVisible(false); }}
      >
        {selectedRecommendation && (
          <div>
            <p><strong>代币:</strong> {selectedRecommendation.symbol} ({selectedRecommendation.name})</p>
            <p><strong>链:</strong> {selectedRecommendation.chain.toUpperCase()}</p>
            <p><strong>合约:</strong> {selectedRecommendation.address}</p>
            <p><strong>AI建议:</strong> {selectedRecommendation.action === 'buy' ? '买入' : selectedRecommendation.action === 'sell' ? '卖出' : '持有'}</p>
            <p><strong>置信度:</strong> {selectedRecommendation.confidence}%</p>
            <p><strong>目标价:</strong> ${selectedRecommendation.targetPrice}</p>
            <p><strong>止损价:</strong> ${selectedRecommendation.stopLoss}</p>
            <p><strong>分析:</strong> {selectedRecommendation.reasoning}</p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Trading;
