import React, { useState } from 'react';
import { Layout as AntLayout, Menu, Switch, Space, Statistic } from 'antd';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import {
  DashboardOutlined,
  SwapOutlined,
  ControlOutlined,
  UserOutlined,
  WalletOutlined,
  ThunderboltOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { mockPortfolioStats } from '../mock/data';

const { Header, Content } = AntLayout;

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [autoMode, setAutoMode] = useState(false);

  // 根据路径确定选中的菜单项
  const getSelectedKey = () => {
    const path = location.pathname;
    if (path === '/') return '/';
    if (path.startsWith('/token')) return '/token';
    if (path.startsWith('/trading')) return '/trading';
    if (path.startsWith('/rules')) return '/rules';
    if (path.startsWith('/issuer')) return '/issuer';
    if (path.startsWith('/signals')) return '/signals';
    if (path.startsWith('/analysis')) return '/analysis';
    return '/';
  };

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '实时监控' },
    { key: '/trading', icon: <SwapOutlined />, label: '交易' },
    { key: '/analysis', icon: <SearchOutlined />, label: '代币分析' },
    { key: '/rules', icon: <ControlOutlined />, label: '规则引擎' },
    { key: '/issuer', icon: <UserOutlined />, label: '发行方画像' },
    { key: '/signals', icon: <ThunderboltOutlined />, label: '聪明钱' },
  ];

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === '/issuer') {
      // 发行方画像无参数时跳转到监控页
      navigate('/');
    } else {
      navigate(key);
    }
  };

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      {/* 顶部固定导航栏 */}
      <Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          background: '#001529',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ color: '#fff', fontSize: 20, fontWeight: 'bold', marginRight: 40, whiteSpace: 'nowrap' }}>
            🪙 Web3 AI 投资决策
          </div>
          <Menu
            theme="dark"
            mode="horizontal"
            selectedKeys={[getSelectedKey()]}
            items={menuItems}
            onClick={handleMenuClick}
            style={{ flex: 1 }}
          />
        </div>
        <Space size="large">
          <Space>
            <span style={{ color: '#fff' }}>交易模式:</span>
            <Switch
              checked={autoMode}
              onChange={setAutoMode}
              checkedChildren="全自动"
              unCheckedChildren="辅助"
            />
          </Space>
          <Space>
            <WalletOutlined style={{ color: '#fff' }} />
            <Statistic
              value={mockPortfolioStats.totalValue}
              precision={2}
              prefix="$"
              valueStyle={{ color: '#fff', fontSize: 16 }}
            />
          </Space>
        </Space>
      </Header>

      {/* 内容区域 */}
      <Content style={{ padding: 8, height: 'calc(100vh - 64px)', overflow: 'auto' }}>
        <Outlet />
      </Content>
    </AntLayout>
  );
};

export default AppLayout;
