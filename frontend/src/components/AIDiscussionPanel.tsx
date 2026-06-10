import React, { useState, useEffect, useRef } from 'react';
import { Card, Button, Tag, Space, Spin, message, Divider, Progress, Row, Col, Badge } from 'antd';
import {
  RobotOutlined,

  SafetyOutlined,
  FundOutlined,
  LinkOutlined,

  PlayCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { discussionApi } from '../services/api';
import type { DiscussionMessage, DiscussionSession } from '../types';

// Agent 配置：颜色、图标、名称
const AGENT_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string; bgColor: string }> = {
  risk: {
    color: '#ff4d4f',
    icon: <WarningOutlined />,
    label: '风险评估 Agent',
    bgColor: '#fff1f0',
  },
  market: {
    color: '#1890ff',
    icon: <FundOutlined />,
    label: '市场分析 Agent',
    bgColor: '#e6f7ff',
  },
  issuer: {
    color: '#52c41a',
    icon: <SafetyOutlined />,
    label: '发行方评估 Agent',
    bgColor: '#f6ffed',
  },
  onchain: {
    color: '#722ed1',
    icon: <LinkOutlined />,
    label: '链上数据 Agent',
    bgColor: '#f9f0ff',
  },
  decision: {
    color: '#faad14',
    icon: <StarOutlined />,
    label: '决策 Agent',
    bgColor: '#fffbe6',
  },
};

// 推荐操作配色
const RECOMMENDATION_CONFIG: Record<string, { color: string; label: string; bg: string }> = {
  BUY: { color: '#52c41a', label: '买入', bg: '#f6ffed' },
  HOLD: { color: '#1890ff', label: '持有', bg: '#e6f7ff' },
  WATCH: { color: '#faad14', label: '观望', bg: '#fffbe6' },
  AVOID: { color: '#ff4d4f', label: '回避', bg: '#fff1f0' },
};

// 单个 Agent 发言卡片
const AgentCard: React.FC<{
  msg: DiscussionMessage;
  index: number;
  isAnimating: boolean;
}> = ({ msg, index, isAnimating }) => {
  const config = AGENT_CONFIG[msg.agent_type] || {
    color: '#8c8c8c',
    icon: <RobotOutlined />,
    label: msg.agent_type,
    bgColor: '#fafafa',
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 8,
        backgroundColor: config.bgColor,
        border: `1px solid ${config.color}20`,
        marginBottom: 12,
        animation: isAnimating ? 'fadeInUp 0.5s ease-out' : 'none',
        opacity: isAnimating ? 1 : 1,
      }}
    >
      {/* 左侧 Agent 图标 */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          backgroundColor: config.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {config.icon}
      </div>

      {/* 右侧内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 标题行 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Space size={8}>
            <span style={{ fontWeight: 'bold', fontSize: 13, color: config.color }}>
              {config.label}
            </span>
            <Tag color={config.color} style={{ fontSize: 11, padding: '0 4px', lineHeight: '16px' }}>
              #{index + 1}
            </Tag>
          </Space>
          <Progress
            percent={msg.score * 10}
            size="small"
            strokeColor={config.color}
            format={() => `${msg.score}/10`}
            style={{ width: 100, marginBottom: 0 }}
          />
        </div>

        {/* 发言内容 */}
        <div style={{ fontSize: 13, lineHeight: 1.6, color: '#262626', marginBottom: 8 }}>
          {msg.content}
        </div>

        {/* 风险标记 + 亮点 */}
        <Row gutter={8}>
          {msg.risk_flags && msg.risk_flags.length > 0 && (
            <Col span={msg.highlights && msg.highlights.length > 0 ? 12 : 24}>
              <div style={{ fontSize: 11, color: '#ff4d4f', fontWeight: 'bold', marginBottom: 2 }}>
                ⚠️ 风险标记
              </div>
              <Space size={4} wrap>
                {msg.risk_flags.map((flag, i) => (
                  <Tag key={i} color="red" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>
                    {flag}
                  </Tag>
                ))}
              </Space>
            </Col>
          )}
          {msg.highlights && msg.highlights.length > 0 && (
            <Col span={msg.risk_flags && msg.risk_flags.length > 0 ? 12 : 24}>
              <div style={{ fontSize: 11, color: '#52c41a', fontWeight: 'bold', marginBottom: 2 }}>
                ✅ 亮点
              </div>
              <Space size={4} wrap>
                {msg.highlights.map((h, i) => (
                  <Tag key={i} color="green" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>
                    {h}
                  </Tag>
                ))}
              </Space>
            </Col>
          )}
        </Row>
      </div>
    </div>
  );
};

// 讨论结果底部面板
const DecisionPanel: React.FC<{ session: DiscussionSession }> = ({ session }) => {
  const rec = RECOMMENDATION_CONFIG[session.final_recommendation] || RECOMMENDATION_CONFIG.WATCH;

  return (
    <Card
      size="small"
      style={{
        backgroundColor: rec.bg,
        border: `2px solid ${rec.color}`,
        marginTop: 16,
      }}
      bodyStyle={{ padding: '12px 16px' }}
    >
      <Row gutter={16} align="middle">
        {/* 综合评分 */}
        <Col span={6} style={{ textAlign: 'center' }}>
          <Progress
            type="circle"
            percent={session.final_score}
            strokeColor={rec.color}
            format={(pct) => (
              <div>
                <div style={{ fontSize: 20, fontWeight: 'bold' }}>{pct}</div>
                <div style={{ fontSize: 10, color: '#8c8c8c' }}>综合评分</div>
              </div>
            )}
            size={80}
          />
        </Col>

        {/* 推荐操作 */}
        <Col span={6} style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>推荐操作</div>
          <Tag
            color={rec.color}
            style={{
              fontSize: 18,
              fontWeight: 'bold',
              padding: '4px 16px',
              lineHeight: '28px',
              borderRadius: 6,
            }}
          >
            {rec.label}
          </Tag>
        </Col>

        {/* 关键理由 */}
        <Col span={12}>
          <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>💡 关键理由摘要</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: '#434343' }}>
            {session.messages
              .filter((m) => m.agent_type === 'decision')
              .map((m) => m.content)
              .join('') || '暂无详细理由'}
          </div>
        </Col>
      </Row>

      {/* 各 Agent 评分概览 */}
      <Divider style={{ margin: '8px 0' }} />
      <Space size={16} style={{ width: '100%', justifyContent: 'center' }}>
        {session.messages
          .filter((m) => m.agent_type !== 'decision')
          .map((m) => {
            const cfg = AGENT_CONFIG[m.agent_type];
            return (
              <div key={m.agent_type} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#8c8c8c' }}>{cfg?.label.replace(' Agent', '')}</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: cfg?.color }}>{m.score}/10</div>
              </div>
            );
          })}
      </Space>
    </Card>
  );
};

// 加载动画：模拟 Agent 依次发言
const DiscussionLoading: React.FC<{ currentStep: number }> = ({ currentStep }) => {
  const agents = ['risk', 'market', 'issuer', 'onchain', 'decision'];
  return (
    <div style={{ padding: '20px 0', textAlign: 'center' }}>
      <Spin size="large" />
      <div style={{ marginTop: 16, fontSize: 13, color: '#8c8c8c' }}>
        多 Agent 讨论进行中...
      </div>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 16 }}>
        {agents.map((agent, i) => {
          const cfg = AGENT_CONFIG[agent];
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          return (
            <div key={agent} style={{ textAlign: 'center' }}>
              <Badge dot status={isDone ? 'success' : isActive ? 'processing' : 'default'}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    backgroundColor: isDone || isActive ? cfg.color : '#d9d9d9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 16,
                    transition: 'all 0.3s',
                    boxShadow: isActive ? `0 0 12px ${cfg.color}80` : 'none',
                  }}
                >
                  {cfg.icon}
                </div>
              </Badge>
              <div style={{ fontSize: 10, marginTop: 4, color: isActive ? cfg.color : '#8c8c8c' }}>
                {cfg.label.replace(' Agent', '')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// 主组件
interface AIDiscussionPanelProps {
  chain: string;
  address: string;
}

const AIDiscussionPanel: React.FC<AIDiscussionPanelProps> = ({ chain, address }) => {
  const [sessions, setSessions] = useState<DiscussionSession[]>([]);
  const [currentSession, setCurrentSession] = useState<DiscussionSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [discussing, setDiscussing] = useState(false);
  const [animStep, setAnimStep] = useState(0);
  const [visibleCards, setVisibleCards] = useState(0);
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载历史讨论记录
  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await discussionApi.getList(chain, address);
      setSessions(data || []);
      if (data && data.length > 0) {
        setCurrentSession(data[0]); // 显示最新一次
      }
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (chain && address) {
      loadHistory();
    }
    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
  }, [chain, address]);

  // 触发讨论
  const handleStartDiscussion = async () => {
    setDiscussing(true);
    setAnimStep(0);
    setVisibleCards(0);

    // 启动动画：依次显示 Agent 状态
    let step = 0;
    animTimerRef.current = setInterval(() => {
      step++;
      setAnimStep(Math.min(step, 4));
    }, 1200);

    try {
      const result = await discussionApi.start(chain, address);
      if (result) {
        setCurrentSession(result);
        setSessions((prev) => [result, ...prev]);

        // 讨论完成，逐步显示卡片
        if (animTimerRef.current) clearInterval(animTimerRef.current);
        let cardIdx = 0;
        const showTimer = setInterval(() => {
          cardIdx++;
          setVisibleCards(cardIdx);
          if (cardIdx >= (result.messages?.length || 0)) {
            clearInterval(showTimer);
          }
        }, 300);

        message.success('讨论完成！');
      }
    } catch (err) {
      message.error('讨论触发失败，请检查后端接口');
    } finally {
      setDiscussing(false);
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    }
  };

  return (
    <div style={{ overflowY: 'auto', height: 460 }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <RobotOutlined style={{ fontSize: 16, color: '#1890ff' }} />
          <span style={{ fontWeight: 'bold', fontSize: 14 }}>AI 多 Agent 讨论</span>
          {sessions.length > 0 && (
            <Tag color="blue">{sessions.length} 次讨论</Tag>
          )}
        </Space>
        <Space>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadHistory}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={handleStartDiscussion}
            loading={discussing}
            disabled={!chain || !address}
          >
            开始讨论
          </Button>
        </Space>
      </div>

      {/* 讨论进行中动画 */}
      {discussing && <DiscussionLoading currentStep={animStep} />}

      {/* 讨论内容 */}
      {!discussing && currentSession && (
        <>
          {/* 讨论过程 */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
              📋 讨论过程 · 会话ID: {currentSession.session_id?.slice(0, 8)}...
              {currentSession.created_at && (
                <span style={{ marginLeft: 8 }}>
                  {new Date(currentSession.created_at).toLocaleString()}
                </span>
              )}
            </div>

            {currentSession.messages.map((msg, i) => {
              if (visibleCards > 0 && i >= visibleCards) return null;
              return (
                <AgentCard
                  key={`${currentSession.session_id}-${i}`}
                  msg={msg}
                  index={i}
                  isAnimating={discussing}
                />
              );
            })}
          </div>

          {/* 讨论结果 */}
          <DecisionPanel session={currentSession} />
        </>
      )}

      {/* 空状态 */}
      {!discussing && !currentSession && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c8c8c' }}>
          <RobotOutlined style={{ fontSize: 48, marginBottom: 16, color: '#d9d9d9' }} />
          <div style={{ fontSize: 14, marginBottom: 8 }}>暂无讨论记录</div>
          <div style={{ fontSize: 12 }}>点击"开始讨论"触发多 Agent 综合评估</div>
        </div>
      )}

      {/* 历史记录列表 */}
      {!discussing && sessions.length > 1 && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>📜 历史讨论</div>
          <div style={{ maxHeight: 120, overflowY: 'auto' }}>
            {sessions.slice(1).map((s) => {
              const rec = RECOMMENDATION_CONFIG[s.final_recommendation];
              return (
                <div
                  key={s.session_id}
                  onClick={() => {
                    setCurrentSession(s);
                    setVisibleCards(s.messages?.length || 0);
                  }}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    marginBottom: 4,
                    backgroundColor: '#fafafa',
                    border: '1px solid #f0f0f0',
                    fontSize: 12,
                  }}
                >
                  <Space size={8}>
                    <span style={{ fontFamily: 'monospace' }}>
                      {s.session_id?.slice(0, 8)}...
                    </span>
                    <span style={{ color: '#8c8c8c' }}>
                      {s.created_at ? new Date(s.created_at).toLocaleString() : '-'}
                    </span>
                  </Space>
                  <Space size={8}>
                    <span style={{ fontWeight: 'bold' }}>{s.final_score}分</span>
                    <Tag color={rec?.color} style={{ fontSize: 10, padding: '0 4px' }}>
                      {rec?.label}
                    </Tag>
                  </Space>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default AIDiscussionPanel;
