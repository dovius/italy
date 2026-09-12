import express, { type ErrorRequestHandler, type Request } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { openaiRequest, requireKey, ServiceError } from './openai';
import { chatSchema, hangupSchema, liveFragmentsSchema, sessionSchema, speechSchema } from './validation';
import type { ChatResult } from '../shared/types';
import { extractResponse } from './response';
import { chatPayload, livePayload, speechPayload, transcriptionForm } from './payloads';
import { createNodeStats } from './stats-node';
import type { StatsCommand } from '../shared/stats';
export { extractResponse } from './response';

type OwnerRequest = Request & { visitor?: string };
type Upstream = typeof openaiRequest;
export function createApp(upstream: Upstream = openaiRequest, options: { stats?: ReturnType<typeof createNodeStats> } = {}) {
  const app = express();
  const stats = options.stats || createNodeStats({ ...process.env });
  const visitorId = (req: OwnerRequest) => createHash('sha256').update(req.visitor!).digest('hex');
  const capture = async (command: StatsCommand) => { await stats?.service.capture(command); };
  app.disable('x-powered-by');
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
  const production = process.env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: production ? { directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", 'blob:', 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    } } : false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    next();
  });
  // Optional one-tap invitation for a private trip. No account or login form.
  // The project API key never participates in browser authentication.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  app.get(['/stats', '/stats/'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.use('/api/stats', express.json({ limit: '4kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!stats) return void res.status(503).json({ code: 'stats_not_configured', error: 'Administravimo puslapis dar neįjungtas. Serveryje nustatykite STATS_ADMIN_PASSWORD.' });
    const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    stats.service.setOrigin(origin);
    const headers = new Headers();
    for (const name of ['cookie', 'origin', 'sec-fetch-site', 'content-type']) {
      const value = req.get(name); if (value) headers.set(name, value);
    }
    const request = new Request(new URL(req.originalUrl, origin), { method: req.method, headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: JSON.stringify(req.body || {}) } : {}) });
    const result = await stats.service.handle(request, digest(req.ip || 'unknown').toString('hex'));
    result.headers.forEach((value, name) => res.setHeader(name, value));
    res.status(result.status).send(Buffer.from(await result.arrayBuffer()));
  });
  app.get('/join/:token', (req, res) => {
    const expected = process.env.TRIP_ACCESS_TOKEN;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (expected && timingSafeEqual(digest(req.params.token), digest(expected))) {
      res.cookie('trip_access', digest(expected).toString('hex'), { httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.APP_ORIGIN?.startsWith('https://'), maxAge: 14 * 86400_000 });
    }
    res.redirect(303, '/');
  });
  app.use('/api', (req: OwnerRequest, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    let visitor = req.headers.cookie?.match(/(?:^|;\s*)trip_visitor=([a-f0-9-]{36})(?:;|$)/)?.[1];
    if (!visitor) {
      visitor = randomUUID();
      res.cookie('trip_visitor', visitor, { httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.APP_ORIGIN?.startsWith('https://'), maxAge: 14 * 86400_000 });
    }
    req.visitor = visitor;
    stats?.service.setOrigin(process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
      if (req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') {
        return res.status(403).json({ code: 'origin', error: 'Atverkite vertėją jo įprastu adresu ir pabandykite dar kartą.' });
      }
      if (process.env.TRIP_ACCESS_TOKEN) {
        const access = req.headers.cookie?.match(/(?:^|;\s*)trip_access=([a-f0-9]{64})(?:;|$)/)?.[1];
        if (!access || !timingSafeEqual(Buffer.from(access, 'hex'), digest(process.env.TRIP_ACCESS_TOKEN))) {
          return res.status(403).json({ code: 'trip_access', error: 'Atverkite kelionės organizatoriaus atsiųstą vertėjo nuorodą. Taip galėsite tęsti be registracijos.' });
        }
      }
    }
    next();
  });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 60, skip: (req) => req.method === 'GET', standardHeaders: 'draft-8', legacyHeaders: false, message: { code: 'busy', error: 'Per daug užklausų. Palaukite minutę ir bandykite dar kartą.' } }));
  app.use(express.json({ limit: '7mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, configured: Boolean(process.env.OPENAI_API_KEY) }));

  // A short-lived idempotency cache prevents duplicate charges on a mobile retry.
  // It is scoped to an anonymous browser cookie, never shared across travelers.
  const pending = new Map<string, { fingerprint: string; promise: Promise<ChatResult>; expires: number }>();
  app.post('/api/chat', async (req: OwnerRequest, res) => {
    const input = chatSchema.parse(req.body);
    for (const [key, value] of pending) if (value.expires < Date.now()) pending.delete(key);
    const key = `${req.visitor}:${input.requestId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    let entry = pending.get(key);
    if (entry && entry.fingerprint !== fingerprint) throw new ServiceError(409, 'request_changed', 'Klausimas pasikeitė. Išsiųskite jį iš naujo.');
    if (!entry) {
      if (pending.size >= 400) throw new ServiceError(429, 'busy', 'Vertėjas užimtas. Pabandykite po minutės.');
      const promise = (async () => {
        const visitor = visitorId(req);
        await capture({ action: 'chat', visitor, requestId: input.requestId, conversationId: input.conversationId || input.requestId, mode: input.mode, text: input.messages.at(-1)!.text, image: input.image, imageName: input.imageName });
        try {
          requireKey();
          const response = await upstream('responses', chatPayload(input, process.env));
          const result = extractResponse(await response.json());
          await capture({ action: 'answer', visitor, requestId: input.requestId, ...result });
          return result;
        } catch (error) {
          await capture({ action: 'failure', visitor, requestId: input.requestId, error: error instanceof ServiceError ? error.message : 'Nepavyko gauti atsakymo.' });
          throw error;
        }
      })();
      entry = { fingerprint, promise, expires: Date.now() + 10 * 60_000 };
      pending.set(key, entry);
      // Retain successes only. An explicit retry can recover from upstream failures.
      promise.catch(() => pending.delete(key));
    }
    res.json(await entry.promise);
  });

  const sessions = new Map<string, { owner: string; timer: ReturnType<typeof setTimeout> }>();
  // Closed sessions accept late caption batches briefly, still scoped to owner.
  const captionOwners = new Map<string, { owner: string; expires: number }>();
  const hangup = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    clearTimeout(session.timer);
    sessions.delete(id);
    await capture({ action: 'end', visitor: digest(session.owner).toString('hex'), sessionId: id });
    try { await upstream(`live/sessions/${encodeURIComponent(id)}/hangup`, undefined, 10_000); } catch { /* Peer teardown also closes media; no sensitive diagnostics. */ }
  };
  app.post('/api/live/session', rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { code: 'busy', error: 'Ryšį atkūrėme kelis kartus. Palaukite minutę ir bandykite dar kartą.' } }), async (req: OwnerRequest, res) => {
    const { sdp, history } = sessionSchema.parse(req.body);
    requireKey();
    for (const [id, value] of sessions) if (value.owner === req.visitor) await hangup(id);
    const result = await upstream('live/sessions', livePayload({ sdp, history }, process.env), 25_000);
    const data = await result.json() as { session?: { id?: string }; transport?: { sdp?: string } };
    if (!data.session?.id || !data.transport?.sdp || !/^[A-Za-z0-9_-]+$/.test(data.session.id)) throw new ServiceError(502, 'invalid_session', 'Nepavyko pradėti pokalbio. Pabandykite dar kartą.');
    const id = data.session.id;
    const timer = setTimeout(() => void hangup(id), 30 * 60_000);
    timer.unref();
    sessions.set(id, { owner: req.visitor!, timer });
    for (const [key, value] of captionOwners) if (value.expires < Date.now()) captionOwners.delete(key);
    captionOwners.set(id, { owner: req.visitor!, expires: Date.now() + 40 * 60_000 });
    await capture({ action: 'live', visitor: visitorId(req), sessionId: id });
    if (res.destroyed) { await hangup(id); return; }
    res.status(201).json({ session: { id }, transport: { type: 'webrtc', sdp: data.transport.sdp } });
  });
  app.post('/api/live/end', async (req: OwnerRequest, res) => {
    const { sessionId } = hangupSchema.parse(req.body);
    if (sessions.get(sessionId)?.owner === req.visitor) await hangup(sessionId);
    res.status(204).end();
  });
  app.post('/api/live/fragments', async (req: OwnerRequest, res) => {
    const input = liveFragmentsSchema.parse(req.body);
    const owner = captionOwners.get(input.sessionId);
    if (!owner || owner.owner !== req.visitor || owner.expires < Date.now()) throw new ServiceError(403, 'session_owner', 'Šis pokalbis nepriklauso šiai naršyklei.');
    await capture({ action: 'fragments', visitor: visitorId(req), ...input });
    res.status(204).end();
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 } });
  app.post('/api/transcribe', upload.single('audio'), async (req: OwnerRequest, res) => {
    requireKey();
    const file = req.file;
    if (!file || file.size === 0 || !/^(audio\/(webm|mp4|mpeg|ogg|wav|x-wav)|video\/(webm|mp4))(;.*)?$/.test(file.mimetype)) {
      throw new ServiceError(400, 'audio_format', 'Nepavyko perskaityti įrašo. Pabandykite įrašyti dar kartą arba parašykite klausimą.');
    }
    const form = transcriptionForm(new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), process.env);
    const result = await upstream('audio/transcriptions', form);
    const data = await result.json() as { text?: string };
    if (!data.text?.trim()) throw new ServiceError(422, 'empty_audio', 'Neišgirdome klausimo. Kalbėkite arčiau telefono ir pabandykite dar kartą.');
    await capture({ action: 'dictation', visitor: visitorId(req), text: data.text.trim() });
    res.json({ text: data.text.trim() });
  });
  app.post('/api/speech', async (req: OwnerRequest, res) => {
    const { text } = speechSchema.parse(req.body);
    const result = await upstream('audio/speech', speechPayload(text, process.env));
    await capture({ action: 'speech', visitor: visitorId(req), text });
    res.type('audio/mpeg').send(Buffer.from(await result.arrayBuffer()));
  });
  app.use('/api', (_req, res) => res.status(404).json({ code: 'not_found', error: 'Tokio veiksmo nėra. Grįžkite į pradžią.' }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) return void res.status(400).json({ code: 'invalid_input', error: 'Nepavyko perskaityti užklausos. Pabandykite trumpesnį klausimą arba kitą nuotrauką.' });
    if (error instanceof ServiceError) return void res.status(error.status).json({ code: error.code, error: error.message });
    if (error instanceof multer.MulterError || error?.type === 'entity.too.large') return void res.status(413).json({ code: 'too_large', error: 'Failas per didelis. Pasirinkite mažesnę nuotrauką arba trumpesnį įrašą.' });
    if (error instanceof SyntaxError) return void res.status(400).json({ code: 'invalid_input', error: 'Nepavyko perskaityti užklausos. Pabandykite dar kartą.' });
    res.status(500).json({ code: 'internal', error: 'Kažkas nepavyko. Pabandykite dar kartą po kelių akimirkų.' });
  };
  app.use(errors);
  app.locals.closeSessions = () => Promise.all([...sessions.keys()].map(hangup));
  app.locals.closeStats = () => stats?.close();
  return app;
}
