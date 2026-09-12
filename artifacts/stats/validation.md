# `/stats` verification

Checked on 2026-09-12.

| Check | Result |
| --- | --- |
| TypeScript: browser, Node and Cloudflare | Passed |
| Node API, persistence, notification and transcript tests | 23 passed |
| Cloudflare API tests in workerd | 14 passed |
| Full browser suite: desktop Chromium, Android Chromium, iPhone WebKit | 117 passed |
| Dashboard browser suite against the Cloudflare adapter | 18 passed |
| Production Node/frontend build | Passed |
| Cloudflare deployment dry run | Passed |

The browser suites ran from an isolated copy with port 4317 because concurrent work was updating the shared frontend build. Backend persistence and notification edge cases were checked after the final server changes. AI and notification delivery were mocked; the actual `dode-italiano` topic was not used for test messages.

Coverage includes separate admin authentication, login rate limits, origin rejection, protected photo URLs, idempotent questions, full answers, chunked photo storage, browser names, search and pagination, owned live captions, late and duplicate fragments, disk/object restarts, retention cleanup, persisted ntfy retries and links after a cold start, and readable excerpts containing both sides of long exchanges. Browser checks also cover logout with an in-flight refresh, expired authentication, deep links, mobile name editing, no horizontal overflow, and automated WCAG AA checks on the dashboard, login and conversation dialog.

The local preview is served at `http://localhost:3001/stats`. A smoke check confirmed HTML 200, unauthenticated API 401, successful admin login, authenticated API 200, 30-day retention and enabled ntfy configuration. The generated password is in the ignored `.env` and `.dev.vars` files under `STATS_ADMIN_PASSWORD`.

Screenshots use synthetic traveler data:

- [Desktop](desktop.png)
- [Android](android.png)
- [iPhone](iphone.png)

Earlier history that exists only on travelers' devices is not imported. Live caption delivery on abrupt browser termination remains best effort; raw audio is not recorded. Deployment was not performed as part of this change.
