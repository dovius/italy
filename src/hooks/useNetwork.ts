import { useEffect, useState } from 'react';

export function useNetwork() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    let previous = navigator.onLine;
    let stopped = false;
    let active: AbortController | null = null;
    function update(connected: boolean) {
      if (stopped) return;
      setOnline(connected);
      if (connected && !previous) window.dispatchEvent(new Event('trip:online'));
      previous = connected;
    }
    async function probe() {
      if (!navigator.onLine) { update(false); return; }
      if (active || document.visibilityState === 'hidden') return;
      const controller = new AbortController();
      active = controller;
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const result = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' });
        update(result.ok);
      } catch { update(false); }
      finally { clearTimeout(timer); active = null; }
    }
    const offline = () => { active?.abort(); update(false); };
    void probe();
    const timer = setInterval(() => void probe(), 20_000);
    window.addEventListener('online', probe);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', probe);
    return () => { stopped = true; active?.abort(); clearInterval(timer); window.removeEventListener('online', probe); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', probe); };
  }, []);
  return online;
}
