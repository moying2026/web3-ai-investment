#!/usr/bin/env python3
"""
AI评估平仓脚本 - 针对链预算超限的持仓进行平仓
"""
import sqlite3
import json
import urllib.request
import time

DB_PATH = "/home/winnie/openclaw/workspace/projects/项目_Web3投资决策系统/backend/data/web3_tokens.db"
API_BASE = "http://127.0.0.1:3500"
TOTAL_BUDGET = 10000
MAX_CHAIN_PCT = 40
CHAIN_LIMIT = TOTAL_BUDGET * MAX_CHAIN_PCT / 100  # 4000

def get_chain_investments():
    """获取每链投资金额"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT chain_id, SUM(CAST(from_amount AS REAL)) as total_invested
        FROM sim_trades 
        WHERE side='BUY' AND status='SUCCESS'
        GROUP BY chain_id
    """)
    
    result = {}
    for row in cursor.fetchall():
        result[row[0]] = row[1]
    
    conn.close()
    return result

def get_positions_by_chain(chain_id):
    """获取指定链的所有持仓"""
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
             WHERE a.contract_address = t.contract_address AND a.chain_id = t.chain_id) as avg_score
        FROM sim_trades s
        JOIN tokens t ON s.contract_address = t.contract_address AND s.chain_id = t.chain_id
        WHERE s.status = 'SUCCESS' AND s.chain_id = ?
        GROUP BY t.symbol, t.chain_id, t.contract_address
        HAVING tokens_held > 0
        ORDER BY avg_score ASC
    """, (chain_id,))
    
    positions = []
    for row in cursor.fetchall():
        positions.append({
            'symbol': row[0],
            'chain_id': row[1],
            'contract_address': row[2],
            'price_latest': row[3],
            'tokens_held': row[4],
            'native_spent': row[5],
            'avg_score': row[6] or 0
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
    print("=== 链预算超限平仓脚本 ===")
    print(f"链预算限制: {CHAIN_LIMIT} (总预算 {TOTAL_BUDGET} 的 {MAX_CHAIN_PCT}%)")
    print()
    
    chain_investments = get_chain_investments()
    
    # 找出超限或达到限制的链
    over_limit_chains = {chain: amount for chain, amount in chain_investments.items() if amount >= CHAIN_LIMIT}
    
    if not over_limit_chains:
        print("没有链预算超限")
        return
    
    print(f"超限或达到限制的链:")
    for chain, amount in over_limit_chains.items():
        excess = amount - CHAIN_LIMIT
        print(f"  {chain}: {amount:.2f} (超出 {excess:.2f})")
    print()
    
    total_closed = 0
    total_released = 0
    
    for chain_id, current_amount in over_limit_chains.items():
        excess = current_amount - CHAIN_LIMIT
        print(f"=== 处理链 {chain_id} (超出 {excess:.2f}) ===")
        
        positions = get_positions_by_chain(chain_id)
        print(f"  该链持仓: {len(positions)} 个")
        
        # 按评分排序，从最低开始平仓
        positions.sort(key=lambda x: x['avg_score'])
        
        released = 0
        # 如果链已经达到限制，释放20%的预算
        target_release = max(excess, current_amount * 0.2)
        for p in positions:
            if released >= target_release:
                break
            
            trade_id = get_buy_trade_id(p['contract_address'], p['chain_id'])
            if not trade_id:
                continue
            
            exit_price = p['price_latest'] or 0
            reason = f"chain_limit_{chain_id}"
            
            print(f"  平仓: {p['symbol']} | 评分: {p['avg_score']:.1f} | 投入: {p['native_spent']:.2f}")
            
            if close_position(trade_id, exit_price, reason):
                released += p['native_spent']
                total_closed += 1
                total_released += p['native_spent']
                print(f"    ✓ 成功 (累计释放: {released:.2f})")
            else:
                print(f"    ✗ 失败")
            
            time.sleep(0.1)
        
        print()
    
    print("=== 平仓完成 ===")
    print(f"平仓数量: {total_closed} 个")
    print(f"释放预算: {total_released:.2f}")

if __name__ == "__main__":
    main()
