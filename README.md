# Kelionės vertėjas

A mobile-first Lithuanian travel interpreter for Italy. Three actions, no accounts, and no settings to navigate. React + TypeScript, an installable PWA, and a small backend for either Cloudflare Workers Free or Node/Express.

**Deploy to Cloudflare Free:** see the [Lithuanian deployment instructions](CLOUDFLARE.md). Run `npm run cf:prepare`, `npx wrangler login`, then `npm run cf:deploy`. Hosting and the API share one HTTPS address; OpenAI usage is billed separately.

## Run

Requires Node.js 22.13+ (the optional admin history uses Node's built-in SQLite).

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

The same Node process serves the compiled frontend and `/api` routes. Admin history uses a local SQLite file, with no separate database service required. `.env` is excluded from source control and Docker builds. Never prefix a secret with `VITE_`.

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

Default models are `gpt-live-1`, `gpt-5.6-sol` for text and images, `gpt-4o-mini-transcribe`, and `gpt-4o-mini-tts`. Photo and assistant requests use `reasoning.effort: "low"` and `service_tier: "fast"`. [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode) has a higher per-token price than Standard processing; OpenAI may report the actual tier as `priority` for GPT-5.6. Server environment variables can change models; any replacement text model must support the configured reasoning and service tier. The Live integration uses **`POST /v1/live/sessions`**, not the different Realtime API contract. No project key or ephemeral provider credential is returned to the frontend.

## Private activity dashboard: `/stats`

Open `/stats` directly; the main app contains no link to it. Set `STATS_ADMIN_PASSWORD` on the server to enable both the dashboard and activity recording. It uses a separate password login, signed eight-hour HttpOnly cookie, origin checks and login rate limiting. Traveler invitation cookies do not grant admin access. History APIs and photo URLs require this admin cookie, use `no-store`, and `/stats` is excluded from offline navigation and search indexing.

The dashboard includes sent photos and their follow-up questions, assistant questions and answers, dictated text before submission, requested speech playback, and the original/translated live captions. Search by text or name, filter by traveler, action or date, open full replies and photos, or view every question in a conversation. The feed refreshes every 15 seconds. Browser identities are hashed anonymous visitor IDs; give them names inside the dashboard, including on mobile after selecting a traveler. This labels a browser, not a verified person: a different device/browser or cleared cookies produces another identity. A shared microphone does not identify individual speakers.

| Server setting | Purpose |
| --- | --- |
| `STATS_ADMIN_PASSWORD` | Independent admin password; without it, recording and access are disabled. |
| `STATS_RETENTION_DAYS` | Retain entries for 30 days since their last update by default; accepts 1–365. |
| `STATS_DB_PATH` | Node only: persistent SQLite path, default `./data/stats.sqlite`. |
| `NTFY_TOPIC_URL` | Notification topic URL, configured here as `https://ntfy.sh/dode-italiano`. |
| `NTFY_TOKEN` | Optional bearer token for a topic requiring authentication. |

Node stores history and photos in SQLite; Cloudflare uses a separate `ActivityLog` SQLite Durable Object with the `v2` migration in `wrangler.jsonc`. Photo data is deduplicated and split into bounded rows. A photo is removed after the last referencing event expires. Mount persistent storage on Node hosts; Docker's `/app/data` volume holds the database. Changing or removing the password revokes access, but does not erase the existing database.

Notifications contain the traveler label, action, text excerpt and an authenticated `/stats?event=…` link. Photos remain behind admin authentication. Set `APP_ORIGIN` for Node production; Cloudflare derives the origin from the request. Publishing follows the [ntfy JSON API](https://docs.ntfy.sh/publish/#publish-as-json). Pending notifications survive restarts and retry up to five times with backoff; failures remain visible and can be retried from the dashboard. Node checks the queue every 15 seconds; Cloudflare uses alarms. Live caption updates are grouped into notifications about every 15 seconds. Delivery is at least once: a crash after ntfy accepted a message can cause a duplicate notification.

Recording starts when enabled; earlier device-only history is not imported. The live media connection sends displayed captions back to the server in small batches, retries temporary failures and flushes on ending/leaving a call. These captions come from the browser and are not independently verified against provider audio; an abrupt browser shutdown or extended outage can lose the final batch. Raw audio recordings are never stored. Playback served from the device cache or local speech synthesis does not call the server and produces no additional playback event. Deleting local phone history does not delete the admin copy. The app's privacy help describes organizer access and ntfy delivery.

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
docker run --rm --env-file .env -v italiano-data:/app/data -p 3000:3000 keliones-vertejas
```

Put the container behind the host's HTTPS proxy. Set `APP_ORIGIN` to the public HTTPS address.

## Mobile and offline behavior

- All fonts, SVG illustration and icons are local. Primary controls are large, form text is at least 19 px on mobile, and translated captions are 21–22 px. Zoom is allowed, dialogs trap focus, and reduced-motion preferences are respected.
- iPhone: use Safari → Share → Add to Home Screen. Android: use Chrome's install prompt or Add to Home screen. The footer explains both paths.
- The production app shell, previous answers, current photo and drafts open offline. **New AI translations need an internet connection.** A health probe also detects a network that appears connected but cannot reach the server.
- Voice reconnects with bounded backoff and seeds a replacement session from saved captions. Old connection events are ignored. The user may need to repeat an utterance that was lost during an outage.
- Failed questions remain visible. Transient network retries reuse the same request ID; the server deduplicates in-flight and completed requests. A recoverable offline question retries when connectivity returns. Do not claim exactly-once processing across a server restart or an ambiguous upstream timeout.
- Text and the last compressed photo live in IndexedDB on the device. Replacing a photo starts a new image conversation. Help includes a clear-data action. Private browsing or storage denial is reported; the app then continues in memory.
- The server requests `store: false` for Responses and Live. With `STATS_ADMIN_PASSWORD` enabled, photos, questions, replies and displayed live captions are retained in the private admin history described above. Raw recordings, credentials and raw upstream errors are not logged. Separate reply copies are cached for approximately ten minutes for network retries: in memory on Node, in temporary durable storage on Cloudflare. Caption upload ownership is retained for 40 minutes to accept late batches after a call ends. OpenAI's own data retention policies still apply. Audio input, photos and questions are sent to OpenAI for processing; organizer history and ntfy delivery are explained in the app.
- Replay audio is cached in memory for the last ten texts. If offline, a cached clip can replay; otherwise the app uses an available device voice or explains that the sound needs a connection. Voice quality and device voice availability vary.
- A screen wake lock is requested during live conversations where supported. Leaving the conversation stops capture; switching away from the page ends the call to avoid unexpected background microphone use.
- Live listening stops after two minutes without speech captions. A 20-second countdown offers **Tęsti pokalbį** before stopping. A separate ten-minute confirmation deadline applies even if nearby voices keep producing captions; only an explicit confirmation renews it. Both deadlines survive reconnection and use wall-clock time. Automatic stops release microphone tracks, close WebRTC and request server hangup, while preserving the conversation text. Returning to the page never reopens the microphone automatically. The server's existing 30-minute cleanup remains a fallback if the browser disappears without delivering hangup.
- Question dictation is limited to 60 seconds and releases the microphone immediately on app switching or screen lock, including when microphone permission is still pending. Lock/background behavior is covered with browser lifecycle event simulations; verify it on physical iPhone/Android devices before the trip.

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
