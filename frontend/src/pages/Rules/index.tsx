import React from 'react';
import { Card, Table, Tag, Switch, Button, Space, Progress } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { mockRules } from '../../mock/data';
import type { Rule } from '../../types';

const Rules: React.FC = () => {
  const columns = [
    { title: '规则名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong>{v}</strong> },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '条件',
      dataIndex: 'conditions',
      key: 'conditions',
      render: (conditions: Rule['conditions']) => (
        <Space direction="vertical" size={0}>
          {conditions.map((c, i) => (
            <Tag key={i}>{c.field} {c.operator} {c.value}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '动作',
      dataIndex: 'actions',
      key: 'actions',
      render: (actions: Rule['actions']) => (
        <Space>
          {actions.map((a, i) => (
            <Tag key={i} color={a.type === 'alert' ? 'red' : a.type === 'buy' ? 'green' : 'blue'}>
              {a.type === 'alert' ? '预警' : a.type === 'buy' ? '买入' : a.type === 'sell' ? '卖出' : '监控'}
            </Tag>
          ))}
        </Space>
      ),
    },
    { title: '触发次数', dataIndex: 'hitCount', key: 'hitCount' },
    {
      title: '准确率',
      dataIndex: 'accuracy',
      key: 'accuracy',
      render: (v: number) => <Progress percent={v} size="small" status={v >= 80 ? 'success' : v >= 60 ? 'normal' : 'exception'} />,
    },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', render: (v: boolean) => <Switch defaultChecked={v} /> },
    {
      title: '操作',
      key: 'action',
      render: () => (
        <Space>
          <Button icon={<EditOutlined />} size="small">编辑</Button>
          <Button icon={<DeleteOutlined />} size="small" danger>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="⚙️ 规则引擎"
        extra={<Button type="primary" icon={<PlusOutlined />}>新建规则</Button>}
      >
        <Table dataSource={mockRules} columns={columns} rowKey="id" pagination={false} />
      </Card>
    </div>
  );
};

export default Rules;
