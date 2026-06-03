#!/bin/bash
# Web3 AI 投资决策系统 — 后端数据采集服务启动脚本
# 用法：
#   ./start.sh                    # 直连模式
#   ./start.sh --proxy http://127.0.0.1:7890  # 代理模式

cd "$(dirname "$0")"

# 解析参数
PROXY=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --proxy)
      PROXY="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# 构建（如果需要）
if [ ! -d "dist" ] || [ "src/index.ts" -nt "dist/index.js" ]; then
  echo "📦 编译 TypeScript..."
  npx tsc
  if [ $? -ne 0 ]; then
    echo "❌ 编译失败"
    exit 1
  fi
fi

# 设置环境变量
export NODE_ENV=production
if [ -n "$PROXY" ]; then
  export HTTPS_PROXY="$PROXY"
  export HTTP_PROXY="$PROXY"
  echo "🌐 使用代理: $PROXY"
fi

# 启动服务
echo "🚀 启动 Web3 数据采集服务..."
node --experimental-sqlite dist/index.js
