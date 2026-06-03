import { useEffect, useRef, useCallback, useState } from 'react';
import type { SSEEvent, Token } from '../types';

type SSEHandler = (event: SSEEvent) => void;

export function useSSE(url: string, handler: SSEHandler) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlerRef = useRef(handler);
  const [connected, setConnected] = useState(false);

  handlerRef.current = handler;

  useEffect(() => {
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      // 自动重连由浏览器EventSource处理
    };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handlerRef.current(data);
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [url]);

  return { connected };
}

// 新币上线SSE Hook
export function useNewTokenStream(onToken: (token: Token) => void) {
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useSSE('/api/stream/new-tokens', useCallback((event: SSEEvent) => {
    if (event.type === 'new_token') {
      onTokenRef.current(event.data as Token);
    }
  }, []));
}
