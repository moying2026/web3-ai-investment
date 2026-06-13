import React, { useState } from 'react';
import { Card, Input, Button, Row, Col, Tag, Spin, Tabs, Alert, Statistic, Divider } from 'antd';
import {
  SearchOutlined,
  RobotOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { issuerProfilerApi, tokenRatingApi, tradeAnalysisApi, contextAnalysisApi } from '../../services/api';

interface AnalysisResult {
  issuer: any;
  rating: any;
  tradeAnalysis: any;
  contextAnalysis: any;
  loading: boolean;
}

const TokenAnalysis: React.FC = () => {
  const [chain, setChain] = useState<string>('56');
  const [address, setAddress] = useState<string>('');
  const [result, setResult] = useState<AnalysisResult>({
    issuer: null,
    rating: null,
    tradeAnalysis: null,
    contextAnalysis: null,
    loading: false,
  });

  const handleAnalyze = async () => {
    if (!address) return;

    setResult(prev => ({ ...prev, loading: true }));

    try {
      // 并行执行所有分析
      const [issuerRes, ratingRes, tradeRes, contextRes] = await Promise.all([
        issuerProfilerApi.analyze(address),
        tokenRatingApi.analyze(chain, address),
        tradeAnalysisApi.analyze(chain, address),
        contextAnalysisApi.analyze(chain, address),
      ]);

      setResult({
        issuer: issuerRes,
        rating: ratingRes,
        tradeAnalysis: tradeRes,
        contextAnalysis: contextRes,
        loading: false,
      });
    } catch (error) {
      console.error('Analysis failed:', error);
      setResult(prev => ({ ...prev, loading: false }));
    }
  };

  const getLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      'L1': '#52c41a', 'L2': '#1890ff', 'L3': '#faad14', 'L4': '#ff7a45', 'L5': '#ff4d4f',
    };
    return colors[level] || '#d9d9d9';
  };

  const getRiskLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      'low': '#52c41a', 'medium': '#faad14', 'high': '#ff4d4f',
      'clean': '#52c41a', 'suspicious': '#faad14', 'moderate': '#ff7a45', 'high_risk': '#ff4d4f',
    };
    return colors[level] || '#d9d9d9';
  };

  return (
    <div style={{ padding: 24 }}>
      {/* 搜索栏 */}
      <Card style={{ marginBottom: 24 }}>
        <Row gutter={16}>
          <Col span={4}>
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              style={{ width: '100%', height: 32, padding: '4px 11px' }}
            >
              <option value="56">BSC</option>
              <option value="CT_501">Solana</option>
              <option value="8453">Base</option>
              <option value="1">Ethereum</option>
            </select>
          </Col>
          <Col span={16}>
            <Input
              placeholder="输入代币合约地址"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              prefix={<SearchOutlined />}
            />
          </Col>
          <Col span={4}>
            <Button
              type="primary"
              onClick={handleAnalyze}
              loading={result.loading}
              block
            >
              开始分析
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 分析结果 */}
      {result.loading && (
        <Card>
          <div style={{ textAlign: 'center', padding: 50 }}>
            <Spin size="large" tip="正在分析中..." />
          </div>
        </Card>
      )}

      {!result.loading && result.rating && (
        <>
          {/* 综合评分卡片 */}
          <Card style={{ marginBottom: 24 }}>
            <Row gutter={24}>
              <Col span={6}>
                <Statistic
                  title="代币分级"
                  value={result.rating.level}
                  valueStyle={{ color: getLevelColor(result.rating.level), fontSize: 36 }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="综合评分"
                  value={result.rating.score}
                  suffix="/100"
                  valueStyle={{ fontSize: 36 }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="刷单风险"
                  value={`${((result.tradeAnalysis?.wash_trading?.score || 0) * 100).toFixed(0)}%`}
                  valueStyle={{ color: getRiskLevelColor(result.tradeAnalysis?.wash_trading?.level) }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="相关面风险"
                  value={result.contextAnalysis?.context_risk_level || 'low'}
                  valueStyle={{ color: getRiskLevelColor(result.contextAnalysis?.context_risk_level) }}
                />
              </Col>
            </Row>
          </Card>

          {/* 详细分析 */}
          <Tabs
            items={[
              {
                key: 'issuer',
                label: '发行方分析',
                children: (
                  <Card>
                    {result.issuer ? (
                      <div>
                        <Alert
                          message={`风险等级: ${result.issuer.level || 'N/A'}`}
                          type={result.issuer.level === 'high' ? 'error' : result.issuer.level === 'medium' ? 'warning' : 'success'}
                          showIcon
                          style={{ marginBottom: 16 }}
                        />
                        <Row gutter={16}>
                          <Col span={8}>
                            <Statistic title="风险评分" value={result.issuer.score || 0} suffix="/100" />
                          </Col>
                          <Col span={8}>
                            <Statistic title="风险等级" value={result.issuer.level || 'N/A'} />
                          </Col>
                          <Col span={8}>
                            <Statistic title="风险标记" value={result.issuer.flags?.length || 0} />
                          </Col>
                        </Row>
                        {result.issuer.flags?.length > 0 && (
                          <div style={{ marginTop: 16 }}>
                            <strong>风险标记：</strong>
                            {result.issuer.flags.map((flag: string, idx: number) => (
                              <Tag key={idx} color="red" style={{ marginTop: 8 }}>{flag}</Tag>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Alert message="暂无发行方数据" type="info" showIcon />
                    )}
                  </Card>
                ),
              },
              {
                key: 'rating',
                label: '代币分级',
                children: (
                  <Card>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Statistic title="代币等级" value={result.rating.level} valueStyle={{ color: getLevelColor(result.rating.level) }} />
                      </Col>
                      <Col span={8}>
                        <Statistic title="评分" value={result.rating.score} suffix="/100" />
                      </Col>
                      <Col span={8}>
                        <Statistic title="评级原因" value={result.rating.reason} />
                      </Col>
                    </Row>
                    <Divider />
                    <Row gutter={16}>
                      <Col span={8}>
                        <Statistic title="发行方风险" value={result.rating.details?.issuer_risk || 0} suffix="/5" />
                      </Col>
                      <Col span={8}>
                        <Statistic title="代币年龄" value={`${((result.rating.details?.token_age || 0) / 24).toFixed(1)}天`} />
                      </Col>
                      <Col span={8}>
                        <Statistic
                          title="LP状态"
                          value={result.rating.details?.lp_locked ? '已锁定' : '未锁定'}
                          valueStyle={{ color: result.rating.details?.lp_locked ? '#52c41a' : '#ff4d4f' }}
                        />
                      </Col>
                    </Row>
                    {result.rating.risk_flags?.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <strong>风险标记：</strong>
                        {result.rating.risk_flags.map((flag: string, idx: number) => (
                          <Tag key={idx} color="orange" style={{ marginTop: 8 }}>{flag}</Tag>
                        ))}
                      </div>
                    )}
                  </Card>
                ),
              },
              {
                key: 'trade',
                label: '交易真实性',
                children: (
                  <Card>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Statistic
                          title="刷单风险"
                          value={`${((result.tradeAnalysis?.wash_trading?.score || 0) * 100).toFixed(0)}%`}
                          valueStyle={{ color: getRiskLevelColor(result.tradeAnalysis?.wash_trading?.level) }}
                        />
                      </Col>
                      <Col span={8}>
                        <Statistic title="风险等级" value={result.tradeAnalysis?.wash_trading?.level || 'unknown'} />
                      </Col>
                      <Col span={8}>
                        <Statistic title="建议" value={result.tradeAnalysis?.recommendation || 'N/A'} />
                      </Col>
                    </Row>
                    <Divider />
                    <Row gutter={16}>
                      <Col span={4}>
                        <Statistic title="项目方" value={result.tradeAnalysis?.participants?.project || 0} prefix={<TeamOutlined />} />
                      </Col>
                      <Col span={4}>
                        <Statistic title="机器人" value={result.tradeAnalysis?.participants?.bot || 0} prefix={<RobotOutlined />} />
                      </Col>
                      <Col span={4}>
                        <Statistic title="KOL" value={result.tradeAnalysis?.participants?.kol || 0} />
                      </Col>
                      <Col span={4}>
                        <Statistic title="智能资金" value={result.tradeAnalysis?.participants?.smart_money || 0} />
                      </Col>
                      <Col span={4}>
                        <Statistic title="散户" value={result.tradeAnalysis?.participants?.retail || 0} />
                      </Col>
                    </Row>
                  </Card>
                ),
              },
              {
                key: 'context',
                label: '相关面分析',
                children: (
                  <Card>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Statistic
                          title="风险评分"
                          value={result.contextAnalysis?.context_risk_score || 0}
                          suffix="/100"
                          valueStyle={{ color: getRiskLevelColor(result.contextAnalysis?.context_risk_level) }}
                        />
                      </Col>
                      <Col span={8}>
                        <Statistic title="风险等级" value={result.contextAnalysis?.context_risk_level || 'low'} />
                      </Col>
                      <Col span={8}>
                        <Statistic title="热门匹配" value={result.contextAnalysis?.hot_token_matches?.length || 0} />
                      </Col>
                    </Row>
                    {result.contextAnalysis?.risks?.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <strong>风险点：</strong>
                        {result.contextAnalysis.risks.map((risk: string, idx: number) => (
                          <Tag key={idx} color="red" style={{ marginTop: 8 }}>{risk}</Tag>
                        ))}
                      </div>
                    )}
                    {result.contextAnalysis?.narrative_matches?.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <strong>蹭叙事：</strong>
                        {result.contextAnalysis.narrative_matches.map((match: any, idx: number) => (
                          <Tag key={idx} color="blue" style={{ marginTop: 8 }}>{match.narrative}: {match.keyword}</Tag>
                        ))}
                      </div>
                    )}
                  </Card>
                ),
              },
            ]}
          />
        </>
      )}

      {!result.loading && !result.rating && address && (
        <Card>
          <Alert message="请输入代币地址并点击分析" type="info" showIcon />
        </Card>
      )}
    </div>
  );
};

export default TokenAnalysis;
