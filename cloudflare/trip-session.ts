import { DurableObject } from 'cloudflare:workers';
import { createOpenAIRequest, requireKey, ServiceError } from '../server/openai';
import { chatPayload, livePayload, speechPayload, transcriptionForm } from '../server/payloads';
import { extractResponse } from '../server/response';
import { chatSchema, hangupSchema, liveFragmentsSchema, sessionSchema, speechSchema } from '../server/validation';
import type { ChatResult } from '../shared/types';
import type { StatsCommand } from '../shared/stats';
import type { Env } from './worker';
import { digest, errorResponse, readJSON, readLimited } from './http';

const MINUTE = 60_000;
type CachedAnswer = { fingerprint: string; expires: number; result?: ChatResult };
type LiveSession = { id: string; expires: number; retries: number; visitor: string; origin: string };
type Rate = { expires: number; count: number; live: number };

export class TripSession extends DurableObject<Env> {
  private pending = new Map<string, { fingerprint: string; promise: Promise<ChatResult> }>();
  private liveQueue: Promise<unknown> = Promise.resolve();
  private upstream = createOpenAIRequest(this.env.OPENAI_API_KEY);

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      const visitor = request.headers.get('x-trip-visitor')!;
      const origin = request.headers.get('x-trip-origin')!;
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      // End must remain available even after rate limits or key removal.
      if (path === '/api/live/end') {
        const { sessionId } = hangupSchema.parse(await readJSON(request, 2048));
        await this.withLiveLock(() => this.closeSession(sessionId));
        return new Response(null, { status: 204 });
      }
      if (path === '/api/live/fragments') {
        await this.consumeRate(false);
        const input = liveFragmentsSchema.parse(await readJSON(request, 250_000));
        const session = await this.ctx.storage.get<{ expires: number }>(`captions:${input.sessionId}`);
        if (!session || session.expires < Date.now()) throw new ServiceError(403, 'session_owner', 'Šis pokalbis nepriklauso šiai naršyklei.');
        await this.capture({ action: 'fragments', visitor, ...input }, origin);
        return new Response(null, { status: 204 });
      }
      requireKey(this.env.OPENAI_API_KEY);
      await this.consumeRate(path === '/api/live/session');
      if (path === '/api/chat') return Response.json(await this.chat(chatSchema.parse(await readJSON(request)), visitor, origin));
      if (path === '/api/live/session') {
        const input = sessionSchema.parse(await readJSON(request, 100_000));
        return await this.withLiveLock(async () => {
          const old = await this.ctx.storage.list<LiveSession>({ prefix: 'live:' });
          for (const previous of old.values()) await this.closeSession(previous.id);
          const response = await this.upstream('live/sessions', livePayload(input, this.env), 25_000);
          const data = await response.json() as { session?: { id?: string }; transport?: { sdp?: string } };
          const id = data.session?.id;
          if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !data.transport?.sdp) throw new ServiceError(502, 'invalid_session', 'Nepavyko pradėti pokalbio. Pabandykite dar kartą.');
          const session: LiveSession = { id, expires: Date.now() + 30 * MINUTE, retries: 0, visitor, origin };
          await this.ctx.storage.put(`live:${id}`, session);
          await this.ctx.storage.put(`captions:${id}`, { expires: Date.now() + 40 * MINUTE });
          await this.schedule(session.expires);
          await this.capture({ action: 'live', visitor, sessionId: id }, origin);
          return Response.json({ session: { id }, transport: { type: 'webrtc', sdp: data.transport.sdp } }, { status: 201 });
        });
      }
      if (path === '/api/speech') {
        const { text } = speechSchema.parse(await readJSON(request, 30_000));
        const response = await this.upstream('audio/speech', speechPayload(text, this.env));
        await this.capture({ action: 'speech', visitor, text }, origin);
        // Stream MP3 bytes instead of buffering them in Worker memory.
        return new Response(response.body, { headers: { 'Content-Type': 'audio/mpeg' } });
      }
      if (path === '/api/transcribe') return await this.transcribe(request);
      throw new ServiceError(404, 'not_found', 'Tokio veiksmo nėra. Grįžkite į pradžią.');
    } catch (error) { return errorResponse(error); }
  }

  private async chat(input: ReturnType<typeof chatSchema.parse>, visitor: string, origin: string): Promise<ChatResult> {
    const fingerprint = await digest(JSON.stringify(input));
    const pending = this.pending.get(input.requestId);
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw new ServiceError(409, 'request_changed', 'Klausimas pasikeitė. Išsiųskite jį iš naujo.');
      return pending.promise;
    }
    const key = `chat:${input.requestId}`;
    const promise = (async () => {
      const cached = await this.ctx.storage.get<CachedAnswer>(key);
      if (cached && cached.expires > Date.now()) {
        if (cached.fingerprint !== fingerprint) throw new ServiceError(409, 'request_changed', 'Klausimas pasikeitė. Išsiųskite jį iš naujo.');
        if (cached.result) return cached.result;
        // A lost instance may already have sent a paid request. Don't immediately
        // submit it again without knowing whether the first request completed.
        throw new ServiceError(503, 'pending', 'Ankstesnio atsakymo dar negavome. Palaukite dvi minutes ir pabandykite dar kartą.');
      }
      if ((await this.ctx.storage.list({ prefix: 'chat:', limit: 100 })).size >= 100) throw new ServiceError(429, 'busy', 'Vertėjas užimtas. Palaukite kelias minutes ir bandykite dar kartą.');
      const expires = Date.now() + 2 * MINUTE;
      await this.ctx.storage.put(key, { fingerprint, expires } satisfies CachedAnswer);
      await this.schedule(expires);
      await this.capture({ action: 'chat', visitor, requestId: input.requestId, conversationId: input.conversationId || input.requestId, mode: input.mode, text: input.messages.at(-1)!.text, image: input.image, imageName: input.imageName }, origin);
      try {
        const response = await this.upstream('responses', chatPayload(input, this.env));
        const result = extractResponse(await response.json());
        const completed = { fingerprint, result, expires: Date.now() + 10 * MINUTE };
        await this.ctx.storage.put(key, completed);
        await this.schedule(completed.expires);
        await this.capture({ action: 'answer', visitor, requestId: input.requestId, ...result }, origin);
        return result;
      } catch (error) {
        await this.capture({ action: 'failure', visitor, requestId: input.requestId, error: error instanceof ServiceError ? error.message : 'Nepavyko gauti atsakymo.' }, origin);
        await this.ctx.storage.delete(key); throw error;
      }
    })();
    this.pending.set(input.requestId, { fingerprint, promise });
    try { return await promise; } finally { this.pending.delete(input.requestId); }
  }

  private async transcribe(request: Request) {
    const bytes = await readLimited(request, 10 * 1024 * 1024 + 4096);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData(); }
    catch { throw new ServiceError(400, 'audio_format', 'Nepavyko perskaityti įrašo. Pabandykite įrašyti dar kartą.'); }
    const audio = form.get('audio');
    if (!(audio instanceof File) || form.getAll('audio').length !== 1 || [...form.keys()].some(key => key !== 'audio') || audio.size === 0 || audio.size > 10 * 1024 * 1024 || !/^(audio\/(webm|mp4|mpeg|ogg|wav|x-wav)|video\/(webm|mp4))(;.*)?$/.test(audio.type)) {
      throw new ServiceError(400, 'audio_format', 'Nepavyko perskaityti įrašo. Pabandykite įrašyti dar kartą arba parašykite klausimą.');
    }
    const response = await this.upstream('audio/transcriptions', transcriptionForm(audio, this.env));
    const data = await response.json() as { text?: string };
    if (!data.text?.trim()) throw new ServiceError(422, 'empty_audio', 'Neišgirdome klausimo. Kalbėkite arčiau telefono ir pabandykite dar kartą.');
    await this.capture({ action: 'dictation', visitor: request.headers.get('x-trip-visitor')!, text: data.text.trim() }, request.headers.get('x-trip-origin')!);
    return Response.json({ text: data.text.trim() });
  }

  private withLiveLock<T>(callback: () => Promise<T>): Promise<T> {
    const result = this.liveQueue.then(callback);
    this.liveQueue = result.catch(() => {});
    return result;
  }

  private async closeSession(id: string) {
    const key = `live:${id}`;
    const session = await this.ctx.storage.get<LiveSession>(key);
    if (!session) return;
    try {
      const response = await this.upstream(`live/sessions/${encodeURIComponent(id)}/hangup`, undefined, 10_000);
      await response.body?.cancel();
      await this.ctx.storage.delete(key);
      if (session.visitor) await this.capture({ action: 'end', visitor: session.visitor, sessionId: id }, session.origin);
    } catch {
      if (session.retries >= 3) { await this.ctx.storage.delete(key); return; }
      const retry = { ...session, retries: session.retries + 1, expires: Date.now() + 30_000 };
      await this.ctx.storage.put(key, retry);
      await this.schedule(retry.expires);
    }
  }

  private async consumeRate(live: boolean) {
    const now = Date.now();
    let rate = await this.ctx.storage.get<Rate>('rate');
    if (!rate || rate.expires <= now) rate = { expires: now + MINUTE, count: 0, live: 0 };
    if (rate.count >= 60 || (live && rate.live >= 8)) throw new ServiceError(429, 'busy', 'Per daug užklausų. Palaukite minutę ir bandykite dar kartą.');
    await this.ctx.storage.put('rate', { ...rate, count: rate.count + 1, live: rate.live + Number(live) });
    await this.schedule(rate.expires);
  }

  private async capture(command: StatsCommand, origin: string) {
    if (!this.env.STATS_ADMIN_PASSWORD) return;
    try {
      const response = await this.env.ACTIVITY_LOG.getByName('trip').fetch('https://activity.internal/record', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-trip-origin': origin }, body: JSON.stringify(command),
      });
      if (!response.ok) throw new Error('Activity storage unavailable');
      await response.body?.cancel();
    } catch { console.error('Nepavyko išsaugoti administravimo istorijos įrašo.'); }
  }

  private async schedule(at: number) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || at < current) await this.ctx.storage.setAlarm(at);
  }

  async alarm() {
    await this.withLiveLock(async () => {
      const now = Date.now();
      const entries = await this.ctx.storage.list<CachedAnswer | LiveSession | Rate>();
      for (const [key, value] of entries) {
        if (value.expires > now) continue;
        if (key.startsWith('live:')) await this.closeSession((value as LiveSession).id);
        else {
          // An in-flight answer may have refreshed this entry while a hangup
          // awaited OpenAI. Never delete a newer result using the old snapshot.
          const current = await this.ctx.storage.get<{ expires: number }>(key);
          if (current && current.expires <= now) await this.ctx.storage.delete(key);
        }
      }
      const remaining = await this.ctx.storage.list<{ expires: number }>();
      if (remaining.size) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...[...remaining.values()].map(value => value.expires))));
      else { await this.ctx.storage.deleteAll(); await this.ctx.storage.deleteAlarm(); }
    });
  }
}
