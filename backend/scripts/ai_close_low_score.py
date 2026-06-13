#!/usr/bin/env python3
"""
AI评估平仓脚本 - 根据AI评分关闭低分持仓，释放预算
"""
import sqlite3
import json
import urllib.request
import time
import sys

DB_PATH = "/home/winnie/openclaw/workspace/projects/项目_Web3投资决策系统/backend/data/web3_tokens.db"
API_BASE = "http://127.0.0.1:3500"
SCORE_THRESHOLD = 25  # 低于此分数的持仓将被平仓

def get_open_positions():
    """获取所有未平仓持仓"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            t.symbol,
            t.chain_id,
            t.contract_address,
            t.price_latest,
            SUM(CASE WHEN s.side='BUY' THEN CAST(s.to_amount AS REAL) ELSE 0 END) as tokens_held,
            SUM(CASE WHEN s.side='BUY' THEN CAST(s.from_amount AS REAL) ELSE 0 END) as native_spent,
            (SELECT AVG(score) FROM agent_scores a 
             WHERE a.contract_address = t.contract_address AND a.chain_id = t.chain_id) as avg_score,
            (SELECT GROUP_CONCAT(agent_type || ':' || score) FROM agent_scores a 
             WHERE a.contract_address = t.contract_address AND a.chain_id = t.chain_id) as scores
        FROM sim_trades s
        JOIN tokens t ON s.contract_address = t.contract_address AND s.chain_id = t.chain_id
        WHERE s.status = 'SUCCESS'
        GROUP BY t.symbol, t.chain_id, t.contract_address
        HAVING tokens_held > 0
    """)
    
    positions = []
    for row in cursor.fetchall():
        positions.append({
            'symbol': row[0],
            'chain_id': row[1],
            'contract_address': row[2],
            'price_latest': row[3],
            'tokens_held': row[4],
            'native_spent': row[5],
            'avg_score': row[6] or 0,
            'scores': row[7] or ''
        })
    
    conn.close()
    return positions

def get_buy_trade_id(contract_address, chain_id):
    """获取最近的BUY交易ID"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT trade_id FROM sim_trades 
        WHERE contract_address = ? AND chain_id = ? AND side = 'BUY' AND status = 'SUCCESS'
        ORDER BY created_at DESC LIMIT 1
    """, (contract_address, chain_id))
    
    result = cursor.fetchone()
    conn.close()
    return result[0] if result else None

def close_position(trade_id, price, reason):
    """调用API平仓"""
    url = f"{API_BASE}/api/sim/trades/{trade_id}/close"
    data = json.dumps({'price': price, 'reason': reason}).encode()
    
    req = urllib.request.Request(
        url,
        data=data,
        headers={'Content-Type': 'application/json'},
        method='PUT'
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            return result.get('code') == 0
    except Exception as e:
        print(f"  [Error] 平仓失败: {e}")
        return False

def main():
    print("=== AI评估平仓脚本 ===")
    print(f"评分阈值: < {SCORE_THRESHOLD} 的持仓将被平仓")
    print()
    
    positions = get_open_positions()
    print(f"总持仓: {len(positions)} 个")
    
    # 按评分分组
    low_score = [p for p in positions if p['avg_score'] < SCORE_THRESHOLD]
    mid_score = [p for p in positions if SCORE_THRESHOLD <= p['avg_score'] < 50]
    high_score = [p for p in positions if p['avg_score'] >= 50]
    
    print(f"低分持仓 (<{SCORE_THRESHOLD}): {len(low_score)} 个")
    print(f"中分持仓 ({SCORE_THRESHOLD}-50): {len(mid_score)} 个")
    print(f"高分持仓 (>=50): {len(high_score)} 个")
    print()
    
    if not low_score:
        print("没有需要平仓的低分持仓")
        return
    
    # 按评分排序，从最低开始平仓
    low_score.sort(key=lambda x: x['avg_score'])
    
    print("=== 开始平仓低分持仓 ===")
    closed_count = 0
    released_budget = 0
    
    for p in low_score[:50]:  # 限制最多平仓50个，避免一次性操作太多
        trade_id = get_buy_trade_id(p['contract_address'], p['chain_id'])
        if not trade_id:
            print(f"  [Skip] {p['symbol']}: 找不到BUY交易记录")
            continue
        
        # 使用当前价格平仓
        exit_price = p['price_latest'] or 0
        reason = f"ai_score_{p['avg_score']:.1f}"
        
        print(f"  平仓: {p['symbol']} ({p['chain_id']}) | 评分: {p['avg_score']:.1f} | 价格: {exit_price}")
        
        if close_position(trade_id, exit_price, reason):
            closed_count += 1
            released_budget += p['native_spent']
            print(f"    ✓ 成功")
        else:
            print(f"    ✗ 失败")
        
        time.sleep(0.1)  # 避免请求过快
    
    print()
    print("=== 平仓完成 ===")
    print(f"平仓数量: {closed_count} 个")
    print(f"释放预算: {released_budget:.2f} (原生代币)")

if __name__ == "__main__":
    main()
