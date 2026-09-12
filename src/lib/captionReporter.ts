import type { TranscriptFragment } from '../../shared/types';

// The media connection bypasses our server. Send only its displayed captions,
// in small deduplicated batches, including the final batch when leaving a call.
export class CaptionReporter {
  private pending = new Map<string, Map<string, TranscriptFragment>>();
  private timer?: ReturnType<typeof setTimeout>;
  private sending = false;
  private disposed = false;
  constructor() { window.addEventListener('online', this.online); }
  private online = () => { void this.flush(); };
  add(fragment: TranscriptFragment) {
    const session = this.pending.get(fragment.session) || new Map<string, TranscriptFragment>();
    session.set(fragment.id, fragment);
    this.pending.set(fragment.session, session);
    this.schedule(4000);
  }
  private schedule(delay: number) {
    if (!this.timer && !this.disposed) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }
  private batches() {
    const batches: { sessionId: string; fragments: TranscriptFragment[] }[] = [];
    for (const [sessionId, values] of this.pending) {
      let fragments: TranscriptFragment[] = [];
      let size = 0;
      for (const fragment of values.values()) {
        const bytes = new TextEncoder().encode(JSON.stringify(fragment)).length;
        if (fragments.length && (fragments.length >= 80 || size + bytes > 45_000)) { batches.push({ sessionId, fragments }); fragments = []; size = 0; }
        fragments.push(fragment); size += bytes;
      }
      if (fragments.length) batches.push({ sessionId, fragments });
    }
    return batches;
  }
  async flush(leaving = false) {
    clearTimeout(this.timer); this.timer = undefined;
    if (leaving && navigator.sendBeacon) {
      // Beacon delivery is best effort; server IDs also deduplicate an in-flight
      // normal upload. Keep entries until an acknowledged upload succeeds.
      for (const batch of this.batches()) {
        const body = JSON.stringify(batch);
        if (!navigator.sendBeacon('/api/live/fragments', new Blob([body], { type: 'application/json' }))) {
          void fetch('/api/live/fragments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
        }
      }
      return;
    }
    if (this.sending) return;
    this.sending = true;
    try {
      for (const batch of this.batches()) {
        const response = await fetch('/api/live/fragments', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch), keepalive: true, signal: AbortSignal.timeout(10_000) });
        if (!response.ok && response.status !== 403) throw new Error('Caption upload failed');
        const session = this.pending.get(batch.sessionId);
        for (const fragment of batch.fragments) session?.delete(fragment.id);
        if (!session?.size) this.pending.delete(batch.sessionId);
      }
    } catch { /* Retry without interrupting speech or displaying a second error. */ }
    finally { this.sending = false; if (this.pending.size) this.schedule(10_000); }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    window.removeEventListener('online', this.online);
    void this.flush(true);
  }
}
