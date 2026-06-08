import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import AppLayout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Trading from './pages/Trading';
import Rules from './pages/Rules';
import IssuerProfile from './pages/IssuerProfile';
import SmartMoneySignals from './pages/SmartMoney';
import SystemControl from './pages/SystemControl';

const App: React.FC = () => {
  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="trading" element={<Trading />} />
            <Route path="rules" element={<Rules />} />
            <Route path="issuer/:address" element={<IssuerProfile />} />
            <Route path="signals" element={<SmartMoneySignals />} />
            <Route path="system" element={<SystemControl />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
};

export default App;
