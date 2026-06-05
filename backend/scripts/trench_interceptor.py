#!/usr/bin/env python3
"""
战壕页面新币拦截器 - 从 Binance Meme Rush 社交排行榜获取新币
通过桌面自动化工作台的浏览器上下文 fetch 调用 API（绕过 Cloudflare）
"""
import json
import sqlite3
import time
import sys
import os
import urllib.request
from datetime import datetime, timezone

# 配置
HAS_API = "http://127.0.0.1:9223"
TAB_ID = "tab-1780653694439-3"  # 战壕页面 Tab（Binance Meme Rush）
DB_PATH = "/home/wwtopenclaw/openclaw/workspace/projects/项目_Web3投资决策系统/backend/data/web3_tokens.db"
POLL_INTERVAL = 5  # 秒（浏览器通道不触发限流）
STATE_FILE = "/tmp/trench_seen_tokens.json"

# API 参数
RANK_LIST_URL = "/bapi/defi/v2/public/wallet-direct/buw/wallet/market/token/social-rush/rank/list"
RANK_PARAMS = "?asc=false&chainId=56&favorites=0&keywords=&rankType=10&sort=10&tokenSizeMin=1&topicType=Culture%2CGiants%2CThemes"

# 已见代币缓存
seen_tokens = set()

def load_seen():
    global seen_tokens
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                seen_tokens = set(json.load(f))
            print(f"[Init] 加载已见代币 {len(seen_tokens)} 个")
        except:
            seen_tokens = set()

def save_seen():
    with open(STATE_FILE, 'w') as f:
        json.dump(list(seen_tokens)[-2000:], f)  # 保留最近2000个

def browser_fetch(script):
    """通过 HAS API 在浏览器上下文执行 JS"""
    payload = json.dumps({"tabId": TAB_ID, "script": script}).encode()
    req = urllib.request.Request(
        f"{HAS_API}/execute",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            if result.get("success"):
                return result.get("result")
            else:
                print(f"[Error] HAS API: {result.get('error', 'unknown')}")
                return None
    except Exception as e:
        print(f"[Error] HAS API 请求失败: {e}")
        return None

def fetch_trench_tokens():
    """从战壕页面 API 获取代币列表"""
    script = f"""(async function(){{
      try {{
        var r = await fetch("{RANK_LIST_URL}{RANK_PARAMS}");
        var d = await r.json();
        if (!d.success || !d.data) return JSON.stringify({{error:"api_error"}});
        var tokens = [];
        (d.data||[]).forEach(function(topic){{
          (topic.tokenList||[]).forEach(function(t){{
            tokens.push({{
              chainId: t.chainId || "56",
              contractAddress: t.contractAddress,
              symbol: t.symbol,
              icon: t.icon || "",
              price: t.price || "0",
              marketCap: String(t.marketCap || "0"),
              liquidity: String(t.liquidity || "0"),
              holders: t.holders || 0,
              launchTime: t.createTime || 0,
              devHoldingPercent: t.devHoldingPercent || "0",
              smartMoneyHoldingPercent: t.smartMoneyHoldingPercent || 0,
              kolHoldingPercent: t.kolHoldingPercent || 0,
              volumeBuy: String(t.volumeBuy || "0"),
              volumeSell: String(t.volumeSell || "0"),
              uniqueTrader24h: t.uniqueTrader24h || 0,
              priceChange24h: String(t.priceChange24h || "0"),
              migrateStatus: t.migrateStatus || 0,
              topicName: topic.name ? topic.name.topicNameCn || topic.name.topicNameEn || "" : "",
              topicType: topic.type || "",
              topicId: topic.topicId || ""
            }});
          }});
        }});
        return JSON.stringify({{ok:true, count:tokens.length, tokens:tokens}});
      }} catch(e) {{
        return JSON.stringify({{error:e.message}});
      }}
    }})()"""
    result = browser_fetch(script)
    if not result:
        return None
    try:
        data = json.loads(result)
        if data.get("error"):
            print(f"[Error] API: {data['error']}")
            return None
        return data.get("tokens", [])
    except:
        print(f"[Error] 解析响应失败: {result[:200]}")
        return None

def insert_token(token):
    """插入新币到数据库"""
    now = datetime.now(timezone.utc).isoformat()
    launch_time = token.get("launchTime", 0)
    if launch_time and launch_time > 1e12:
        launch_time = int(launch_time / 1000)  # 毫秒转秒

    meta_info = json.dumps({
        "originSymbol": token.get("symbol", ""),
        "originName": "",
        "name": token.get("symbol", ""),
        "decimals": 18,
        "lsdFlag": 0,
        "aiNarrativeFlag": 0,
        "createTime": token.get("launchTime", 0),
        "blacklist": False,
        "whitelist": False,
        "creatorAddress": "",
        "topicName": token.get("topicName", ""),
        "topicType": token.get("topicType", ""),
        "topicId": token.get("topicId", ""),
        "source": "trench_interceptor"
    })

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR IGNORE INTO tokens (
                chain_id, contract_address, symbol, icon,
                decimals, price_first, price_latest,
                market_cap, liquidity, holders, launch_time,
                dev_holding_percent, smart_money_holding_percent,
                volume_24h_buy, volume_24h_sell,
                unique_trader_24h, percent_change_24h,
                meta_info, first_seen_at, is_new_coin, created_at, updated_at
            ) VALUES (
                ?, ?, ?, ?,
                18, ?, ?,
                ?, ?, ?, ?,
                ?, ?,
                ?, ?,
                ?, ?,
                ?, ?, 1, ?, ?
            )
        """, (
            token.get("chainId", "56"),
            token.get("contractAddress"),
            token.get("symbol"),
            token.get("icon", ""),
            token.get("price", "0"),
            token.get("price", "0"),
            token.get("marketCap", "0"),
            token.get("liquidity", "0"),
            token.get("holders", 0),
            launch_time,
            float(token.get("devHoldingPercent", "0") or "0"),
            float(token.get("smartMoneyHoldingPercent", 0) or 0),
            token.get("volumeBuy", "0"),
            token.get("volumeSell", "0"),
            token.get("uniqueTrader24h", 0),
            token.get("priceChange24h", "0"),
            meta_info,
            now,
            now,
            now
        ))
        conn.commit()
        inserted = cursor.rowcount > 0
        conn.close()
        return inserted
    except Exception as e:
        print(f"[Error] DB 插入失败: {e}")
        return False

def main():
    global seen_tokens
    load_seen()

    print(f"[Start] 战壕新币拦截器启动")
    print(f"  HAS API: {HAS_API}")
    print(f"  Tab ID: {TAB_ID}")
    print(f"  DB: {DB_PATH}")
    print(f"  轮询间隔: {POLL_INTERVAL}s")
    print()

    round_num = 0
    total_new = 0

    while True:
        round_num += 1
        tokens = fetch_trench_tokens()

        if tokens is None:
            print(f"[Round {round_num}] 获取失败，等待重试...")
            time.sleep(POLL_INTERVAL * 2)
            continue

        new_count = 0
        for token in tokens:
            addr = token.get("contractAddress", "")
            if not addr:
                continue
            key = f"56:{addr.lower()}"
            if key in seen_tokens:
                continue

            seen_tokens.add(key)
            inserted = insert_token(token)
            if inserted:
                new_count += 1
                total_new += 1
                print(f"  🆕 {token.get('symbol','?')} | MC: ${float(token.get('marketCap','0') or '0'):.0f} | Holders: {token.get('holders',0)} | Age: {int((time.time()*1000 - (token.get('launchTime',0) or 0))/1000)}s")

        if new_count > 0 or round_num % 12 == 0:  # 每分钟汇报一次
            print(f"[Round {round_num}] 获取 {len(tokens)} 个代币，新增 {new_count}，累计 {total_new}")

        save_seen()
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
