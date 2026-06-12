import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Space, Button, Tag, Checkbox } from 'antd';
import {
  SyncOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { systemApi } from '../../services/api';

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
}

/**
 * 运行日志面板 - Tab6 专用
 * 默认展开，固定高度充满 Tab 内区域，支持折叠
 */
const RuntimeLogPanel: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logLevels, setLogLevels] = useState<string[]>(['info', 'warn', 'error']);
  const [logStreaming, setLogStreaming] = useState(false);
  const [logExpanded, setLogExpanded] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logSseRef = useRef<EventSource | null>(null);

  // 加载日志历史
  const loadLogHistory = useCallback(async () => {
    try {
      const res = await systemApi.getLogHistory();
      const logs = res?.logs || (Array.isArray(res) ? res : []);
      setLogs(logs.slice(-200));
    } catch { /* 静默 */ }
  }, []);

  // SSE 日志流
  const startLogStream = useCallback(() => {
    if (logSseRef.current) return;
    const es = new EventSource('/api/system/logs');
    es.onmessage = (e) => {
      try {
        const log = JSON.parse(e.data);
        setLogs(prev => [...prev.slice(-199), log]);
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      es.close();
      logSseRef.current = null;
      setLogStreaming(false);
    };
    logSseRef.current = es;
    setLogStreaming(true);
  }, []);

  const stopLogStream = useCallback(() => {
    logSseRef.current?.close();
    logSseRef.current = null;
    setLogStreaming(false);
  }, []);

  // 初始加载历史日志
  useEffect(() => {
    loadLogHistory();
  }, [loadLogHistory]);

  // 卸载时清理 SSE
  useEffect(() => {
    return () => { logSseRef.current?.close(); };
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const filteredLogs = logs.filter(l => logLevels.includes(l.level)).slice(-100);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 折叠标题栏 */}
      <div
        onClick={() => setLogExpanded(!logExpanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          padding: '6px 8px', borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        {logExpanded ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
        <FileTextOutlined style={{ fontSize: 13, color: '#1890ff' }} />
        <span style={{ fontWeight: 'bold', fontSize: 13 }}>运行日志</span>
        <Tag style={{ fontSize: 10, padding: '0 4px', margin: 0 }}>{logs.length}</Tag>
        <div style={{ flex: 1 }} />
        <Space size={4}>
          <Button
            size="small"
            icon={logStreaming ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              logStreaming ? stopLogStream() : startLogStream();
            }}
            style={{ fontSize: 10, height: 22, padding: '0 6px' }}
          >
            {logStreaming ? '停止' : '开启'}
          </Button>
          <Button
            size="small"
            icon={<SyncOutlined />}
            onClick={(e) => { e.stopPropagation(); loadLogHistory(); }}
            style={{ fontSize: 10, height: 22, padding: '0 6px' }}
          >
            刷新
          </Button>
        </Space>
      </div>

      {/* 日志内容区 */}
      {logExpanded && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 级别过滤 */}
          <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: '#8c8c8c' }}>级别过滤:</span>
            <Checkbox.Group
              value={logLevels}
              onChange={(v) => setLogLevels(v as string[])}
              options={[
                { label: <Tag color="blue" style={{ fontSize: 10, padding: '0 3px', margin: 0 }}>信息</Tag>, value: 'info' },
                { label: <Tag color="orange" style={{ fontSize: 10, padding: '0 3px', margin: 0 }}>警告</Tag>, value: 'warn' },
                { label: <Tag color="red" style={{ fontSize: 10, padding: '0 3px', margin: 0 }}>错误</Tag>, value: 'error' },
                { label: <Tag color="default" style={{ fontSize: 10, padding: '0 3px', margin: 0 }}>调试</Tag>, value: 'debug' },
              ]}
            />
          </div>

          {/* 日志列表：弹性高度充满剩余空间 */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            background: '#fafafa',
            borderRadius: 4,
            margin: '0 4px 4px',
            padding: '2px 4px',
            fontSize: 11,
            fontFamily: 'monospace',
            lineHeight: '1.4',
          }}>
            {filteredLogs.map((log, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, borderBottom: '1px solid #f0f0f0', padding: '1px 0' }}>
                <span style={{ color: '#8c8c8c', whiteSpace: 'nowrap' }}>
                  {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '--'}
                </span>
                <Tag
                  color={log.level === 'error' ? 'red' : log.level === 'warn' ? 'orange' : log.level === 'debug' ? 'default' : 'blue'}
                  style={{ fontSize: 10, padding: '0 2px', margin: 0, lineHeight: '16px', minWidth: 30, textAlign: 'center' }}
                >
                  {log.level}
                </Tag>
                <span style={{ color: '#1890ff', minWidth: 50 }}>[{log.module}]</span>
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{log.message}</span>
              </div>
            ))}
            {filteredLogs.length === 0 && (
              <div style={{ color: '#8c8c8c', textAlign: 'center', padding: 12 }}>暂无日志，点击"开启"接收实时日志流</div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
};

export default RuntimeLogPanel;
