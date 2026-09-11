# Validation — 11 September 2026

- Production build and TypeScript checks pass. The PWA precaches approximately 571 KiB including local fonts, icons and the application shell.
- 14 backend and caption tests pass.
- 27 Playwright scenarios pass across desktop Chromium, Android-sized Chromium and iPhone-sized WebKit, with no skipped scenarios. API responses are mocked in these flow tests.
- Axe reports no WCAG A/AA violations on the home, photo, assistant and live start screens in those browser profiles. No horizontal overflow was observed.
- Offline startup was verified by warming the production service worker, saving a draft, shutting down the test HTTP server, then reloading. The draft and app remained available in all three profiles. API responses are not cached by the service worker.
- Live lifecycle tests cover overlapping and late captions, large-text display, automatic reconnection with prior context, retaining microphone permission across outages, ending capture, and starting again while a prior connection closes.
- The compiled frontend was checked against the configured API key: the key is not present in frontend assets.

## Real OpenAI integration checks

These checks used a synthetic menu and synthetic audio, not a traveler's microphone or private photo.

| Check | Result |
| --- | --- |
| Project access to `gpt-live-1` and `gpt-5.6-luna` | Confirmed |
| Lithuanian assistant question via `/api/chat` | HTTP 200; correct Italian phrase for requesting the bill |
| Menu vision via `/api/chat` | HTTP 200; correctly translated items, all prices, and the per-person coperto charge |
| Lithuanian speech generation via `/api/speech` | HTTP 200; playable MP3 |
| Lithuanian transcription via `/api/transcribe` | HTTP 200; “Paklausk, ar galime čia statyti automobilį.” |
| Real GPT-Live-1 WebRTC session | HTTP 201, followed by `session.started` and original/translated captions |
| Meta-instruction interpretation | “Paklausk, ar galime čia statyti automobilį” became “Possiamo parcheggiare qui?” |
| Live session shutdown | HTTP 204 |

Physical iPhone/Android camera prompts, audio routing, and conversation quality in a noisy street still need a device check over HTTPS. Browser emulation verifies the UI and connection lifecycle; it does not establish hardware audio quality or guarantee every translation.
