import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3500,
    strictPort: true,
    proxy: {
      // SSE 流式端点需要单独配置（放在 /api 前面优先匹配）
      '/api/stream': {
        target: 'http://localhost:3499',
        changeOrigin: true,
        // SSE 必须关闭缓冲
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            req.headers['connection'] = 'keep-alive';
          });
          proxy.on('proxyRes', (proxyRes) => {
            // 禁用响应缓冲，让 SSE 流式传输
            proxyRes.headers['cache-control'] = 'no-cache';
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
      },
      '/api': {
        target: 'http://localhost:3499',
        changeOrigin: true,
      },
    },
  },
})
