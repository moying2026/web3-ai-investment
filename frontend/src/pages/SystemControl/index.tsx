import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Switch, Space, Button, Tag, Spin, message, Input } from 'antd';
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
  const [autoMode, setAutoMode] = useState(false);

  // 代理状态
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyAddress, setProxyAddress] = useState('');
  const [proxyLastCheck, setProxyLastCheck] = useState<string | null>(null);
  const [proxyLastResult, setProxyLastResult] = useState<string | null>(null);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await systemApi.getStatus();
      setModules(Array.isArray(data) ? data : []);
      // 加载代理状态
      const proxy = await systemApi.getProxy();
      setProxyEnabled(proxy.enabled ?? false);
      setProxyAddress(proxy.address ?? '');
      setProxyLastCheck(proxy.lastCheckTime ?? null);
      setProxyLastResult(proxy.lastCheckResult ?? null);
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

  // 代理保存
  const handleProxySave = async () => {
    setProxySaving(true);
    try {
      await systemApi.setProxy(proxyEnabled, proxyAddress);
      message.success('代理设置已保存');
      await loadStatus();
    } catch {
      message.error('代理设置失败');
    } finally {
      setProxySaving(false);
    }
  };

  // 代理测试
  const handleProxyTest = async () => {
    setProxyTesting(true);
    try {
      const res = await systemApi.testProxy();
      if (res?.success) {
        message.success('代理连通测试成功');
      } else {
        message.error(`代理测试失败: ${res?.message || '未知错误'}`);
      }
      await loadStatus();
    } catch {
      message.error('代理测试失败');
    } finally {
      setProxyTesting(false);
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
        <Card size="small" style={{ marginBottom: 2 }} bodyStyle={{ padding: '2px 6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space size={2}>
              <ThunderboltOutlined style={{ fontSize: 12, color: '#1890ff' }} />
              <Tag color={allRunning ? 'green' : allStopped ? 'default' : 'blue'} style={{ fontSize: 10, padding: '0 3px', lineHeight: '16px', margin: 0 }}>
                {allRunning ? '全部运行中' : allStopped ? '全部已暂停' : '部分运行中'}
              </Tag>
            </Space>
            <Space size={2}>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                disabled={allRunning}
                onClick={() => handleToggleAll(true)}
                size="small"
                style={{ fontSize: 10, height: 20, padding: '0 4px' }}
              >
                全部启动
              </Button>
              <Button
                danger
                icon={<PauseCircleOutlined />}
                disabled={allStopped}
                onClick={() => handleToggleAll(false)}
                size="small"
                style={{ fontSize: 10, height: 20, padding: '0 4px' }}
              >
                全部暂停
              </Button>
              <Button icon={<SyncOutlined />} onClick={loadStatus} size="small" style={{ fontSize: 10, height: 20, padding: '0 4px' }}>刷新</Button>
            </Space>
          </div>
        </Card>

        {/* 代理设置 */}
        <Card size="small" style={{ marginBottom: 4 }} bodyStyle={{ padding: '4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 'bold', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <SyncOutlined style={{ fontSize: 12, color: '#1890ff' }} />
              代理设置
            </span>
            <Switch
              checked={proxyEnabled}
              onChange={setProxyEnabled}
              checkedChildren="启用"
              unCheckedChildren="禁用"
              style={{ height: 20, lineHeight: '20px', fontSize: 10 }}
            />
            {proxyLastCheck && (
              <span style={{ color: '#8c8c8c', fontSize: 10 }}>
                最后检测: {new Date(proxyLastCheck).toLocaleString()}
              </span>
            )}
            {proxyLastResult && (
              <Tag color={proxyLastResult === 'success' ? 'green' : 'red'} style={{ fontSize: 10, padding: '0 3px', margin: 0 }}>
                {proxyLastResult === 'success' ? '成功' : '失败'}
              </Tag>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Input
              size="small"
              placeholder="代理地址 (如 http://127.0.0.1:7890)"
              value={proxyAddress}
              onChange={(e) => setProxyAddress(e.target.value)}
              style={{ flex: 1, fontSize: 11, height: 22 }}
            />
            <Button
              size="small"
              type="primary"
              loading={proxySaving}
              onClick={handleProxySave}
              style={{ fontSize: 10, height: 22, padding: '0 6px' }}
            >
              保存
            </Button>
            <Button
              size="small"
              loading={proxyTesting}
              onClick={handleProxyTest}
              style={{ fontSize: 10, height: 22, padding: '0 6px' }}
            >
              测试
            </Button>
          </div>
        </Card>

        {/* 模块控制卡片 */}
        <Row gutter={[4, 4]}>
          {modules.map(mod => (
            <Col xs={24} key={mod.id}>
              <Card
                size="small"
                bodyStyle={{ padding: '4px 8px' }}
                style={{
                  borderLeft: `3px solid ${mod.running ? moduleColors[mod.id] || '#1890ff' : '#d9d9d9'}`,
                  opacity: mod.running ? 1 : 0.7,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* 标题 */}
                  <span style={{ fontWeight: 'bold', minWidth: 60, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <span style={{ fontSize: 14, color: mod.running ? moduleColors[mod.id] : '#d9d9d9' }}>
                      {moduleIcons[mod.id] || <ThunderboltOutlined />}
                    </span>
                    {mod.name}
                  </span>

                  {/* 间隔 */}
                  <span style={{ color: '#8c8c8c', fontSize: 11 }}>
                    间隔 {mod.intervalMs < 1000 ? `${mod.intervalMs}ms` : `${(mod.intervalMs / 1000).toFixed(0)}s`}
                  </span>

                  {/* 成功/失败 */}
                  <span style={{ fontSize: 11 }}>
                    <span style={{ color: '#52c41a' }}>成功 {mod.successCount}</span>
                    <span style={{ color: mod.failCount > 0 ? '#ff4d4f' : '#8c8c8c', marginLeft: 6 }}>失败 {mod.failCount}</span>
                  </span>

                  {/* 最近运行 */}
                  <span style={{ color: '#8c8c8c', fontSize: 11, flex: 1 }}>
                    {formatTime(mod.lastRun)}
                  </span>

                  {/* 运行开关 */}
                  <Switch
                    checked={mod.running}
                    loading={toggling[mod.id]}
                    onChange={(checked) => handleToggle(mod.id, checked)}
                    checkedChildren="运行"
                    unCheckedChildren="暂停"
                    style={{ height: 20, lineHeight: '20px', fontSize: 10 }}
                  />
                </div>
                {mod.lastError && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#ff4d4f' }}>
                    错误: {mod.lastError.slice(0, 80)}
                  </div>
                )}
              </Card>
            </Col>
          ))}
        </Row>

        {/* 交易模式控制 */}
        <Card size="small" style={{ marginTop: 4 }} bodyStyle={{ padding: '4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 4, minWidth: 60, fontSize: 12 }}>
              <RobotOutlined style={{ fontSize: 14, color: '#722ed1' }} />
              交易模式
            </span>
            <span style={{ color: '#8c8c8c', fontSize: 11, flex: 1 }}>
              {autoMode ? 'AI全自动模式运行中' : 'AI辅助手动模式'}
            </span>
            <Switch
              checked={autoMode}
              onChange={setAutoMode}
              checkedChildren="自动"
              unCheckedChildren="手动"
              style={{ height: 20, lineHeight: '20px', fontSize: 10 }}
            />
          </div>
        </Card>

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
