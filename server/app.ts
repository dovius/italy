import express, { type ErrorRequestHandler, type Request } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { ASSISTANT_PROMPT, INTERPRETER_PROMPT, PHOTO_PROMPT } from './prompts';
import { openaiRequest, requireKey, ServiceError } from './openai';
import { chatSchema, hangupSchema, sessionSchema, speechSchema } from './validation';
import type { ChatResult, Citation } from '../shared/types';

type OwnerRequest = Request & { visitor?: string };
type Upstream = typeof openaiRequest;
type ResponseOutput = {
  status?: string;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[];
};

export function extractResponse(data: ResponseOutput): ChatResult {
  let text = '';
  const sources: Citation[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text) text += part.text;
      if (part.type === 'refusal' && part.refusal) text += part.refusal;
      for (const annotation of part.annotations ?? []) {
        if (annotation.type === 'url_citation' && annotation.url && /^https?:\/\//.test(annotation.url) && !sources.some((s) => s.url === annotation.url)) {
          sources.push({ url: annotation.url, title: annotation.title || new URL(annotation.url).hostname });
        }
      }
    }
  }
  if (!text.trim() || data.status === 'incomplete' || data.status === 'failed') {
    throw new ServiceError(502, 'incomplete', 'Nepavyko gauti viso atsakymo. Pabandykite dar kartą arba užduokite trumpesnį klausimą.');
  }
  // OpenAI citation markers are rendered as accessible source links below the answer.
  return { text: text.replace(/cite[^]*/g, '').trim(), sources };
}

export function createApp(upstream: Upstream = openaiRequest) {
  const app = express();
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
    requireKey();
    for (const [key, value] of pending) if (value.expires < Date.now()) pending.delete(key);
    const key = `${req.visitor}:${input.requestId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    let entry = pending.get(key);
    if (entry && entry.fingerprint !== fingerprint) throw new ServiceError(409, 'request_changed', 'Klausimas pasikeitė. Išsiųskite jį iš naujo.');
    if (!entry) {
      if (pending.size >= 400) throw new ServiceError(429, 'busy', 'Vertėjas užimtas. Pabandykite po minutės.');
      const promise = (async () => {
        const context: unknown[] = [];
        if (input.image) context.push({ role: 'user', content: [{ type: 'input_text', text: 'Ši nuotrauka yra viso tolesnio pokalbio kontekstas.' }, { type: 'input_image', image_url: input.image, detail: 'high' }] });
        context.push(...input.messages.map((m) => ({ role: m.role, content: m.text })));
        const result = await upstream('responses', {
          model: process.env.OPENAI_TEXT_MODEL || 'gpt-5.6-luna',
          ...(/^(gpt-5|gpt-6)/.test(process.env.OPENAI_TEXT_MODEL || 'gpt-5.6-luna') ? { reasoning: { effort: 'low' } } : {}),
          instructions: input.mode === 'photo' ? PHOTO_PROMPT : ASSISTANT_PROMPT,
          input: context,
          store: false,
          max_output_tokens: 2200,
          ...(input.mode === 'assistant' ? { tools: [{ type: 'web_search' }], tool_choice: 'auto' } : {}),
        });
        return extractResponse(await result.json());
      })();
      entry = { fingerprint, promise, expires: Date.now() + 10 * 60_000 };
      pending.set(key, entry);
      // Retain successes only. An explicit retry can recover from upstream failures.
      promise.catch(() => pending.delete(key));
    }
    res.json(await entry.promise);
  });

  const sessions = new Map<string, { owner: string; timer: ReturnType<typeof setTimeout> }>();
  const hangup = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    clearTimeout(session.timer);
    sessions.delete(id);
    try { await upstream(`live/sessions/${encodeURIComponent(id)}/hangup`, undefined, 10_000); } catch { /* Peer teardown also closes media; no sensitive diagnostics. */ }
  };
  app.post('/api/live/session', rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { code: 'busy', error: 'Ryšį atkūrėme kelis kartus. Palaukite minutę ir bandykite dar kartą.' } }), async (req: OwnerRequest, res) => {
    const { sdp, history } = sessionSchema.parse(req.body);
    requireKey();
    for (const [id, value] of sessions) if (value.owner === req.visitor) await hangup(id);
    const result = await upstream('live/sessions', {
      session: {
        model: process.env.OPENAI_LIVE_MODEL || 'gpt-live-1',
        instructions: INTERPRETER_PROMPT,
        audio: { output: { voice: 'marin' } },
        store: false,
        input: history.map((m) => ({ type: 'message', role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.text }] })),
      },
      transport: { type: 'webrtc', sdp },
    }, 25_000);
    const data = await result.json() as { session?: { id?: string }; transport?: { sdp?: string } };
    if (!data.session?.id || !data.transport?.sdp || !/^[A-Za-z0-9_-]+$/.test(data.session.id)) throw new ServiceError(502, 'invalid_session', 'Nepavyko pradėti pokalbio. Pabandykite dar kartą.');
    const id = data.session.id;
    const timer = setTimeout(() => void hangup(id), 30 * 60_000);
    timer.unref();
    sessions.set(id, { owner: req.visitor!, timer });
    if (res.destroyed) { await hangup(id); return; }
    res.status(201).json({ session: { id }, transport: { type: 'webrtc', sdp: data.transport.sdp } });
  });
  app.post('/api/live/end', async (req: OwnerRequest, res) => {
    const { sessionId } = hangupSchema.parse(req.body);
    if (sessions.get(sessionId)?.owner === req.visitor) await hangup(sessionId);
    res.status(204).end();
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 } });
  app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    requireKey();
    const file = req.file;
    if (!file || file.size === 0 || !/^(audio\/(webm|mp4|mpeg|ogg|wav|x-wav)|video\/(webm|mp4))(;.*)?$/.test(file.mimetype)) {
      throw new ServiceError(400, 'audio_format', 'Nepavyko perskaityti įrašo. Pabandykite įrašyti dar kartą arba parašykite klausimą.');
    }
    const extension = file.mimetype.includes('mp4') ? 'm4a' : file.mimetype.includes('mpeg') ? 'mp3' : file.mimetype.includes('ogg') ? 'ogg' : file.mimetype.includes('wav') ? 'wav' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), `klausimas.${extension}`);
    form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
    form.append('language', 'lt');
    form.append('response_format', 'json');
    const result = await upstream('audio/transcriptions', form);
    const data = await result.json() as { text?: string };
    if (!data.text?.trim()) throw new ServiceError(422, 'empty_audio', 'Neišgirdome klausimo. Kalbėkite arčiau telefono ir pabandykite dar kartą.');
    res.json({ text: data.text.trim() });
  });
  app.post('/api/speech', async (req, res) => {
    const { text } = speechSchema.parse(req.body);
    const result = await upstream('audio/speech', {
      model: process.env.OPENAI_SPEECH_MODEL || 'gpt-4o-mini-tts',
      voice: 'marin',
      input: text,
      instructions: 'Read this text exactly, in its original language. Speak clearly at an unhurried pace for an older traveler. Do not add words or translate.',
      response_format: 'mp3',
    });
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
  return app;
}
