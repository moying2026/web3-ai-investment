import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import AppLayout from './components/Layout';
import Dashboard from './pages/Dashboard';
import TokenDetail from './pages/TokenDetail';
import Trading from './pages/Trading';
import SimStats from './pages/SimStats';
import Rules from './pages/Rules';
import IssuerProfile from './pages/IssuerProfile';

const App: React.FC = () => {
  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="token/:chain/:address" element={<TokenDetail />} />
            <Route path="trading" element={<Trading />} />
            <Route path="sim" element={<SimStats />} />
            <Route path="rules" element={<Rules />} />
            <Route path="issuer/:address" element={<IssuerProfile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
};

export default App;
