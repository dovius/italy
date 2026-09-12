import { z, ZodError } from 'zod';
import { activityLabels, visitorLabel, type Activity, type StatsCommand, type StatsConfig } from '../shared/stats';
import { ServiceError } from './openai';
import { adminCookie, checkOrigin, hash, isAdmin, passwordMatches, statsFilters } from './stats-auth';
import { StatsStore } from './stats-store';

function excerpt(text: string, budget: number, recent = false) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= budget) return text;
  let start = recent ? bytes.length - budget : 0;
  let end = recent ? bytes.length : budget;
  // Keep UTF-8 characters intact at either edge of a bounded notification.
  if (recent) while ((bytes[start] & 0xc0) === 0x80) start++;
  else while ((bytes[end] & 0xc0) === 0x80) end--;
  const clipped = new TextDecoder().decode(bytes.subarray(start, end));
  return recent ? `…${clipped}` : `${clipped}…`;
}

export class StatsService {
  private flushing = false;
  private readonly expectedOrigin?: string;
  readonly retentionDays: number;
  constructor(readonly store: StatsStore, readonly config: StatsConfig, private fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.expectedOrigin = config.APP_ORIGIN;
    this.config.APP_ORIGIN ||= store.origin();
    const days = Number(config.STATS_RETENTION_DAYS || 30);
    this.retentionDays = Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30;
  }
  setOrigin(origin: string) {
    const selected = this.expectedOrigin || origin;
    if (this.config.APP_ORIGIN === selected) return;
    this.config.APP_ORIGIN = selected;
    try { this.store.rememberOrigin(selected); }
    catch { console.error('Nepavyko išsaugoti administravimo puslapio adreso.'); }
  }
  private id(visitor: string, key: string) { return `${visitor}-${key}`; }
  private base(visitor: string, key: string, kind: Activity['kind']): Omit<Activity, 'visitorName'> {
    return { id: this.id(visitor, key), visitorId: visitor, kind, conversationId: key, createdAt: Date.now(), updatedAt: Date.now(), status: 'complete', text: '', answer: '', error: '', imageId: null, imageName: '', sources: [], notification: 'off' };
  }
  async record(command: StatsCommand) {
    if (!this.config.STATS_ADMIN_PASSWORD) return;
    const { visitor } = command;
    if (command.action === 'chat') {
      const event = { ...this.base(visitor, command.requestId, command.mode === 'photo' ? 'photo' : 'question'), conversationId: command.conversationId, status: 'pending' as const, text: command.text, imageId: command.image ? await hash(command.image) : null, imageName: command.imageName || '' };
      this.store.create(event, command.image);
      return;
    }
    if (command.action === 'answer' || command.action === 'failure') {
      const id = this.id(visitor, command.requestId);
      this.store.update(id, command.action === 'answer' ? { status: 'complete', answer: command.text, sources: command.sources, error: '' } : { status: 'error', error: command.error });
      if (this.config.NTFY_TOPIC_URL) this.store.notify(id);
      return;
    }
    if (command.action === 'live') {
      this.store.create({ ...this.base(visitor, command.sessionId, 'live'), status: 'active' });
      return;
    }
    if (command.action === 'fragments' || command.action === 'end') {
      const id = this.id(visitor, command.sessionId);
      const event = this.store.event(id);
      if (!event || event.kind !== 'live') return;
      if (command.action === 'fragments') {
        if (this.store.append(id, command.fragments) && this.config.NTFY_TOPIC_URL) this.store.notify(id, event.status === 'ended' ? 0 : 15_000);
      } else {
        this.store.update(id, { status: 'ended' });
        if (this.config.NTFY_TOPIC_URL && (event.text || event.answer)) this.store.notify(id);
      }
      return;
    }
    const event = { ...this.base(visitor, crypto.randomUUID(), command.action), text: command.text };
    this.store.create(event);
    if (this.config.NTFY_TOPIC_URL) this.store.notify(event.id);
  }
  // Best-effort capture must never turn a successful translation into a retry
  // (and another paid provider request). Diagnostics contain no user content.
  async capture(command: StatsCommand) {
    try { await this.record(command); }
    catch { console.error('Nepavyko išsaugoti administravimo istorijos įrašo.'); }
  }
  async flushNotifications() {
    if (this.flushing || !this.config.NTFY_TOPIC_URL || !this.config.STATS_ADMIN_PASSWORD) return;
    this.flushing = true;
    try {
      for (const item of this.store.notifications()) {
        const event = this.store.event(item.id);
        if (!event) continue;
        let success = false;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const topicUrl = new URL(this.config.NTFY_TOPIC_URL);
          if (!['https:', 'http:'].includes(topicUrl.protocol) || topicUrl.username || topicUrl.password) throw new Error('Invalid topic');
          const topic = topicUrl.pathname.split('/').filter(Boolean).at(-1);
          if (!topic || !/^[A-Za-z0-9_-]+$/.test(topic)) throw new Error('Invalid topic');
          topicUrl.pathname = topicUrl.pathname.slice(0, topicUrl.pathname.lastIndexOf(topic));
          topicUrl.search = ''; topicUrl.hash = '';
          const title = `${visitorLabel(event.visitorId, event.visitorName)} · ${activityLabels[event.kind]}`;
          const live = event.kind === 'live';
          const content = [event.imageName && `Nuotrauka: ${excerpt(event.imageName, 150)}`, event.text && `${live ? 'Išgirsta' : 'Žinutė'}: ${excerpt(event.text, 1000, live)}`, event.answer && `${live ? 'Vertimas' : 'Atsakymas'}: ${excerpt(event.answer, 1400, live)}`, event.error && `Nepavyko: ${excerpt(event.error, 200)}`].filter(Boolean).join('\n\n');
          // JSON keeps Lithuanian titles intact; limit UTF-8 bytes to ntfy's
          // message size. Full text and authenticated photos stay in /stats.
          const message = excerpt(content, 3000);
          const click = this.config.APP_ORIGIN ? `${this.config.APP_ORIGIN.replace(/\/$/, '')}/stats?event=${encodeURIComponent(event.id)}` : undefined;
          const response = await this.fetcher(topicUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.config.NTFY_TOKEN ? { Authorization: `Bearer ${this.config.NTFY_TOKEN}` } : {}) },
            body: JSON.stringify({ topic, title, message: message || activityLabels[event.kind], click, tags: [event.kind === 'photo' ? 'camera' : event.kind === 'live' ? 'speech_balloon' : 'memo'] }),
            signal: controller.signal, redirect: 'manual',
          });
          success = response.ok;
          await response.body?.cancel();
        } catch { /* Persist a retry without logging the topic, token or content. */ }
        finally { clearTimeout(timeout); }
        this.store.notified(item.id, item.revision, item.attempts + 1, success);
      }
    } finally { this.flushing = false; }
  }
  async handle(request: Request, client: string): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '');
      if (!this.config.STATS_ADMIN_PASSWORD) throw new ServiceError(503, 'stats_not_configured', 'Administravimo puslapis dar neįjungtas. Serveryje nustatykite STATS_ADMIN_PASSWORD.');
      if (!['GET', 'HEAD'].includes(request.method)) checkOrigin(request, this.expectedOrigin);
      if (path === '/api/stats/login' && request.method === 'POST') {
        if (!this.store.allowLogin(client)) throw new ServiceError(429, 'login_limit', 'Per daug bandymų. Pabandykite po 10 minučių.');
        const { password } = z.object({ password: z.string().min(1).max(2000) }).parse(await request.json());
        if (!await passwordMatches(password, this.config.STATS_ADMIN_PASSWORD)) throw new ServiceError(401, 'admin_auth', 'Neteisingas slaptažodis.');
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': await adminCookie(this.config.STATS_ADMIN_PASSWORD, url.protocol === 'https:') } });
      }
      if (!await isAdmin(request, this.config.STATS_ADMIN_PASSWORD)) throw new ServiceError(401, 'admin_auth', 'Prisijunkite prie administravimo puslapio.');
      if (path === '/api/stats/logout' && request.method === 'POST') return new Response(null, { status: 204, headers: { 'Set-Cookie': `stats_admin=; Path=/api/stats; HttpOnly; SameSite=Strict; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}` } });
      if (path === '/api/stats' && request.method === 'GET') {
        this.store.prune(this.retentionDays);
        return Response.json({ ...this.store.list(statsFilters.parse(Object.fromEntries(url.searchParams))), retentionDays: this.retentionDays, ntfyConfigured: Boolean(this.config.NTFY_TOPIC_URL) });
      }
      const eventId = path.match(/^\/api\/stats\/events\/([a-zA-Z0-9_-]{1,300})$/)?.[1];
      if (eventId && request.method === 'GET') {
        this.store.prune(this.retentionDays);
        const event = this.store.event(eventId, true);
        if (event) return Response.json(event);
      }
      const imageId = path.match(/^\/api\/stats\/images\/([a-f0-9]{64})$/)?.[1];
      if (imageId && request.method === 'GET') {
        this.store.prune(this.retentionDays);
        const data = this.store.image(imageId);
        if (data) {
          const match = data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
          if (match) return new Response(Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)), { headers: { 'Content-Type': match[1], 'Content-Disposition': 'inline' } });
        }
      }
      const visitorId = path.match(/^\/api\/stats\/visitors\/([a-f0-9]{64})$/)?.[1];
      if (visitorId && request.method === 'POST') {
        const { name } = z.object({ name: z.string().trim().max(80) }).parse(await request.json());
        if (this.store.rename(visitorId, name)) return Response.json({ ok: true });
      }
      if (path === '/api/stats/notifications/retry' && request.method === 'POST') {
        this.store.retryNotifications();
        return Response.json({ ok: true });
      }
      throw new ServiceError(404, 'not_found', 'Įrašas nerastas.');
    } catch (error) {
      if (error instanceof ServiceError) return Response.json({ code: error.code, error: error.message }, { status: error.status });
      if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ code: 'invalid_input', error: 'Patikrinkite įvestus duomenis.' }, { status: 400 });
      return Response.json({ code: 'internal', error: 'Nepavyko atverti istorijos. Pabandykite dar kartą.' }, { status: 500 });
    }
  }
}
