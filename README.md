# Kelionės vertėjas

A mobile-first Lithuanian travel interpreter for Italy. Three actions, no accounts, and no settings to navigate. React + TypeScript, an installable PWA, and a small backend for either Cloudflare Workers Free or Node/Express.

**Deploy to Cloudflare Free:** see the [Lithuanian deployment instructions](CLOUDFLARE.md). Run `npm run cf:prepare`, `npx wrangler login`, then `npm run cf:deploy`. Hosting and the API share one HTTPS address; OpenAI usage is billed separately.

## Run

Requires Node.js 22.12+.

```sh
npm ci
cp .env.example .env
# Set OPENAI_API_KEY in .env, on the server only.
npm run dev
```

Open **http://localhost:3000**. If `.env` already exists, keep it; do not overwrite your key. Without a key, the UI, navigation, installation instructions and saved context still work; AI actions show a friendly Lithuanian service message.

For the production PWA, including offline startup:

```sh
npm run build
npm start
```

The same Node process serves the compiled frontend and `/api` routes. No database, separate frontend host, OpenAI SDK, or external font service is required. `.env` is excluded from source control and Docker builds. Never prefix a secret with `VITE_`.

## Architecture and flows

```text
iPhone / Android browser
  React UI ─── IndexedDB: latest photo, text, captions and drafts
     │        Service worker: app, fonts and icons only
     │
     ├─ HTTPS /api/live/session ── Backend ── OpenAI Live session creation
     │    └─ WebRTC directly to GPT-Live-1: microphone, speech, captions
     │
     ├─ HTTPS /api/chat ───────── Backend ── Responses (text + vision + search)
     ├─ HTTPS /api/transcribe ─── Backend ── Lithuanian speech transcription
     └─ HTTPS /api/speech ─────── Backend ── Spoken playback / repeat
```

1. **Kalbėtis** immediately requests microphone access and starts `gpt-live-1`. Lithuanian is interpreted into Italian; Italian, English and Spanish into Lithuanian. The prompt preserves meaning and converts “ask whether we can park here” into a direct Italian question. The Live model handles turn-taking and interruptions. Original and translated captions are displayed independently. Repeat uses speech synthesis; Show displays the latest translation in a full-screen accessible dialog. During playback or Show, microphone input is paused to prevent translating the app’s own audio. End stops microphone capture immediately and drains the session close event.
2. **Išversti nuotrauką** opens the native rear camera or the photo library. A local canvas rotates according to the decoded image, scales the longest edge to at most 2,000 px, and compresses to JPEG. The server sends the image to a vision-capable Responses model with instructions to translate and explain the practical meaning. Every follow-up includes the same image and recent messages, including after reload.
3. **Paklausti apie Italiją** accepts Lithuanian text or a short recording. Dictation uses MediaRecorder (WebM/Opus or MP4 depending on the browser), then server-side transcription; the user can review the text before sending. The assistant has hosted web search for current travel facts and shows clickable source links. Answers can be read aloud.

Default models are `gpt-live-1`, `gpt-5.6-luna` for text and images, `gpt-4o-mini-transcribe`, and `gpt-4o-mini-tts`. Server environment variables can change them. The Live integration uses **`POST /v1/live/sessions`**, not the different Realtime API contract. No project key or ephemeral provider credential is returned to the frontend.

## Deploy for the trip

For **Cloudflare Workers Free**, follow [CLOUDFLARE.md](CLOUDFLARE.md). `wrangler.jsonc` deploys the frontend and native Fetch API together, with SQLite Durable Objects for temporary browser sessions. API secrets are uploaded from the ignored `.dev.vars` file. No separate domain or `APP_ORIGIN` configuration is needed. The React interface and shared OpenAI payloads are the same on both hosting targets.

Alternatively, deploy the Node server on an HTTPS host. Set `OPENAI_API_KEY` and `APP_ORIGIN=https://your-domain.example`. If the host has one trusted reverse proxy, set `TRUST_PROXY=1`. Bind using the host's `PORT` variable. A static-only host cannot run the API.

HTTPS is required for a phone's microphone, PWA installation and service workers. Plain HTTP on a LAN IP will not enable those features. `localhost` is the browser's local development exception.

For private trip access without a login, optionally set `TRIP_ACCESS_TOKEN` to a random value:

```sh
openssl rand -hex 24
```

Share `https://your-domain.example/join/YOUR_TOKEN` with the travelers. Opening it sets a secure, HttpOnly, 14-day access cookie and redirects to the clean home URL. They can then install the app and use it normally. `/join/` is deliberately excluded from the offline navigation cache. Anyone holding the invitation can use the service, so share it only with the travel group. Without this optional token, the API is accessible to anyone who can reach the site. Keep the OpenAI project funded, configure spend alerts, and stop the server after the trip.

The backend verifies the request origin, validates payloads, limits requests, scopes live session ownership to an anonymous browser cookie, and deduplicates chat retries for ten minutes. Opening a replacement live session closes the previous session; abandoned sessions are ended after 30 minutes. Node uses process memory and timers, appropriate for a single small server. The Cloudflare adapter uses per-browser SQLite Durable Objects and alarms, so ownership, limits and completed retries survive process eviction. Only one Node replica should be used without shared storage; Cloudflare handles its own object routing.

### Docker

```sh
docker build -t keliones-vertejas .
docker run --rm --env-file .env -p 3000:3000 keliones-vertejas
```

Put the container behind the host's HTTPS proxy. Set `APP_ORIGIN` to the public HTTPS address.

## Mobile and offline behavior

- All fonts, SVG illustration and icons are local. Primary controls are large, form text is at least 19 px on mobile, and translated captions are 21–22 px. Zoom is allowed, dialogs trap focus, and reduced-motion preferences are respected.
- iPhone: use Safari → Share → Add to Home Screen. Android: use Chrome's install prompt or Add to Home screen. The footer explains both paths.
- The production app shell, previous answers, current photo and drafts open offline. **New AI translations need an internet connection.** A health probe also detects a network that appears connected but cannot reach the server.
- Voice reconnects with bounded backoff and seeds a replacement session from saved captions. Old connection events are ignored. The user may need to repeat an utterance that was lost during an outage.
- Failed questions remain visible. Transient network retries reuse the same request ID; the server deduplicates in-flight and completed requests. A recoverable offline question retries when connectivity returns. Do not claim exactly-once processing across a server restart or an ambiguous upstream timeout.
- Text and the last compressed photo live in IndexedDB on the device. Replacing a photo starts a new image conversation. Help includes a clear-data action. Private browsing or storage denial is reported; the app then continues in memory.
- The server requests `store: false` for Responses and Live. It does not persist or log photos, live transcripts, recordings, prompts, API keys or raw upstream errors. Reply copies are cached for approximately ten minutes for network retries: in memory on Node, in temporary durable storage on Cloudflare. The Cloudflare adapter also retains short-lived session IDs, request fingerprints and rate counters; alarms clean them up. OpenAI's own data retention policies still apply. Audio input, photos and questions are sent to OpenAI for processing; this is explained in the app.
- Replay audio is cached in memory for the last ten texts. If offline, a cached clip can replay; otherwise the app uses an available device voice or explains that the sound needs a connection. Voice quality and device voice availability vary.
- A screen wake lock is requested during live conversations where supported. Leaving the conversation stops capture; switching away from the page ends the call to avoid unexpected background microphone use.

## Checks

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
# Cloudflare runtime and the same browser flows:
npm run cf:check
npm run test:cloudflare
npm run test:e2e:cloudflare
```

The automated API tests use an injected provider, and browser flow tests explicitly mock AI responses. They test origin rejection, anonymous ownership, invitation access, idempotency, image follow-ups, incomplete answers, mobile dictation formats, and late/overlapping captions. Browser projects cover desktop Chromium, Android-sized Chromium, and iPhone-sized WebKit. The production PWA is exercised offline. WebKit emulation is not a replacement for testing camera permissions, audio routing and interruption quality on physical phones.

`scripts/generate-icons.mjs` rebuilds install icons from `public/icon.svg`.

Official contracts used: [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [Live session lifecycle and captions](https://developers.openai.com/api/docs/guides/live-conversations), [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting), [images and vision](https://developers.openai.com/api/docs/guides/images-vision), [web search](https://developers.openai.com/api/docs/guides/tools-web-search), [speech transcription](https://developers.openai.com/api/docs/guides/speech-to-text), and [speech synthesis](https://developers.openai.com/api/docs/guides/text-to-speech).

The mobile layout has viewport screenshot validation at 360 × 800, 375 × 812, 390 × 844 and 430 × 932, plus tablet, desktop and reduced-height checks. See the [visual QA report and screenshots](artifacts/mobile-ux/validation.md). Run `node --import tsx scripts/capture-layout.ts final` against a running production build to repeat the captures.
