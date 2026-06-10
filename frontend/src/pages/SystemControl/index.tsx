import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Switch, Statistic, Space, Button, Tag, Spin, message } from 'antd';
import {
  SyncOutlined,
  RocketOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined,
  BugOutlined,
  RobotOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { systemApi } from '../../services/api';

interface ModuleStatus {
  id: string;
  name: string;
  running: boolean;
  intervalMs: number;
  lastRun: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  successCount: number;
  failCount: number;
  metrics: Record<string, any>;
}

const moduleIcons: Record<string, React.ReactNode> = {
  polling: <SyncOutlined />,
  discovery: <RocketOutlined />,
  ai: <RobotOutlined />,
  trading: <LineChartOutlined />,
  trench: <BugOutlined />,
};

const moduleColors: Record<string, string> = {
  polling: '#1890ff',
  discovery: '#52c41a',
  ai: '#722ed1',
  trading: '#faad14',
  trench: '#ff4d4f',
};

const SystemControl: React.FC = () => {
  const [modules, setModules] = useState<ModuleStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const loadStatus = useCallback(async () => {
    try {
      const data = await systemApi.getStatus();
      setModules(Array.isArray(data) ? data : []);
    } catch { /* 静默 */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadStatus();
    const timer = setInterval(loadStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleToggle = async (moduleId: string, running: boolean) => {
    setToggling(prev => ({ ...prev, [moduleId]: true }));
    try {
      await systemApi.toggle(moduleId, running);
      message.success(`${moduleId} 已${running ? '启动' : '暂停'}`);
      await loadStatus();
    } catch {
      message.error(`操作失败`);
    } finally {
      setToggling(prev => ({ ...prev, [moduleId]: false }));
    }
  };

  const handleToggleAll = async (running: boolean) => {
    try {
      await systemApi.toggleAll(running);
      message.success(`全部${running ? '启动' : '暂停'}成功`);
      await loadStatus();
    } catch {
      message.error('操作失败');
    }
  };

  const formatTime = (t: string | null) => {
    if (!t) return '-';
    const d = new Date(t);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    return d.toLocaleString();
  };

  const allRunning = modules.length > 0 && modules.every(m => m.running);
  const allStopped = modules.length > 0 && modules.every(m => !m.running);

  return (
    <Spin spinning={loading}>
      <div>
        {/* 顶部操作栏 */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <ThunderboltOutlined style={{ fontSize: 20, color: '#1890ff' }} />
              <Tag color={allRunning ? 'green' : allStopped ? 'default' : 'blue'}>
                {allRunning ? '全部运行中' : allStopped ? '全部已暂停' : '部分运行中'}
              </Tag>
            </Space>
            <Space>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                disabled={allRunning}
                onClick={() => handleToggleAll(true)}
              >
                全部启动
              </Button>
              <Button
                danger
                icon={<PauseCircleOutlined />}
                disabled={allStopped}
                onClick={() => handleToggleAll(false)}
              >
                全部暂停
              </Button>
              <Button icon={<SyncOutlined />} onClick={loadStatus}>刷新</Button>
            </Space>
          </div>
        </Card>

        {/* 模块控制卡片 */}
        <Row gutter={[16, 16]}>
          {modules.map(mod => (
            <Col xs={24} sm={12} lg={8} xl={4} key={mod.id}>
              <Card
                size="small"
                style={{
                  borderLeft: `4px solid ${mod.running ? moduleColors[mod.id] || '#1890ff' : '#d9d9d9'}`,
                  opacity: mod.running ? 1 : 0.7,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Space>
                    <span style={{ fontSize: 20, color: mod.running ? moduleColors[mod.id] : '#d9d9d9' }}>
                      {moduleIcons[mod.id] || <ThunderboltOutlined />}
                    </span>
                    <span style={{ fontWeight: 'bold' }}>{mod.name}</span>
                  </Space>
                  <div
                    style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: mod.running ? '#52c41a' : '#d9d9d9',
                      boxShadow: mod.running ? '0 0 6px #52c41a' : 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                    间隔 {mod.intervalMs < 1000 ? `${mod.intervalMs}ms` : `${(mod.intervalMs / 1000).toFixed(0)}s`}
                  </span>
                  <Switch
                    checked={mod.running}
                    loading={toggling[mod.id]}
                    onChange={(checked) => handleToggle(mod.id, checked)}
                    checkedChildren="运行"
                    unCheckedChildren="暂停"
                  />
                </div>

                <Row gutter={8}>
                  <Col span={12}>
                    <Statistic
                      title="成功"
                      value={mod.successCount}
                      valueStyle={{ fontSize: 16, color: '#52c41a' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="失败"
                      value={mod.failCount}
                      valueStyle={{ fontSize: 16, color: mod.failCount > 0 ? '#ff4d4f' : '#8c8c8c' }}
                    />
                  </Col>
                </Row>

                <div style={{ marginTop: 8, fontSize: 11, color: '#8c8c8c' }}>
                  <div>最近运行: {formatTime(mod.lastRun)}</div>
                  {mod.lastError && (
                    <div style={{ color: '#ff4d4f', marginTop: 4 }}>
                      错误: {mod.lastError.slice(0, 50)}
                    </div>
                  )}
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        {modules.length === 0 && !loading && (
          <Card style={{ textAlign: 'center', padding: 60, color: '#8c8c8c' }}>
            暂无模块数据，请确认后端已启动
          </Card>
        )}
      </div>
    </Spin>
  );
};

export default SystemControl;
