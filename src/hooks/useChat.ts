import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMode, ChatResult, Message } from '../../shared/types';
import { ApiError, request } from '../lib/api';

function context(messages: Message[]) {
  const result: { role: 'user' | 'assistant'; text: string }[] = [];
  let length = 0;
  for (const message of [...messages].reverse()) {
    if (length + message.text.length > 45_000 || result.length >= 30) break;
    result.unshift({ role: message.role, text: message.text });
    length += message.text.length;
  }
  return result;
}

export function useChat(mode: ChatMode, messages: Message[], image: string | undefined, onChange: (messages: Message[]) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef({ messages, image, onChange });
  current.current = { messages, image, onChange };
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);
  const recoverable = useRef(false);

  const perform = useCallback(async (history: Message[]) => {
    if (active.current || !history.length) return;
    active.current = true;
    setBusy(true);
    setError('');
    recoverable.current = false;
    const abort = new AbortController();
    controller.current = abort;
    const last = history.at(-1)!;
    const body = { requestId: last.id, mode, messages: context(history), ...(mode === 'photo' ? { image: current.current.image } : {}) };
    try {
      let response: Response;
      try { response = await request('/api/chat', body, abort.signal); }
      catch (first) {
        if (!(first instanceof ApiError) || (first.status && first.status < 500) || first.code === 'not_configured' || first.code === 'service_unavailable' || !navigator.onLine) throw first;
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        if (abort.signal.aborted) return;
        response = await request('/api/chat', body, abort.signal);
      }
      const result = await response.json() as ChatResult;
      if (abort.signal.aborted) return;
      current.current.onChange([...history, { id: crypto.randomUUID(), role: 'assistant' as const, text: result.text, sources: result.sources }].slice(-100));
    } catch (cause) {
      if (abort.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Nepavyko gauti atsakymo. Pabandykite dar kartą.');
      recoverable.current = cause instanceof ApiError && (cause.code === 'offline' || cause.code === 'network');
    } finally {
      if (controller.current === abort) {
        active.current = false;
        setBusy(false);
      }
    }
  }, [mode]);

  const send = useCallback((text: string, initialImage?: string) => {
    if (!text.trim() || active.current) return;
    const previous = initialImage ? [] : current.current.messages;
    const history = [...previous, { id: crypto.randomUUID(), role: 'user' as const, text: text.trim() }];
    if (initialImage) current.current.image = initialImage;
    current.current.onChange(history);
    void perform(history);
  }, [perform]);
  const retry = useCallback(() => {
    if (current.current.messages.at(-1)?.role === 'user') void perform(current.current.messages);
  }, [perform]);
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    active.current = false;
    recoverable.current = false;
    setBusy(false);
    setError('');
  }, []);
  useEffect(() => {
    const reconnect = () => { if (recoverable.current) retry(); };
    window.addEventListener('online', reconnect);
    window.addEventListener('trip:online', reconnect);
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('trip:online', reconnect); controller.current?.abort(); };
  }, [retry]);
  return { busy, error, send, retry, cancel, unanswered: !busy && messages.at(-1)?.role === 'user' };
}
