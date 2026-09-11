**Kelionės vertėjas — mobile viewport QA, 2026-09-12**

All three primary actions are visible without scrolling at every required phone size. The 390 × 844 homepage previously placed the third card’s bottom at 954.3 px; it now ends at 581.1 px. The desktop postcard, serif typography, cream paper, terracotta and olive palette remain.

Every linked screenshot below is a **viewport-only capture**, taken with `fullPage: false` after local fonts loaded. The app was running at `http://127.0.0.1:3000`. Each homepage was captured at scroll position 0, then visually inspected. Full document height is recorded separately and was never used as evidence of viewport fit.

| Viewport / screenshot | innerHeight | clientHeight | visualViewport.height | Bottom of all three actions | Document height | Primary actions require scrolling? |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| [360 × 800](final/home-chromium-360x800.png) | 800 | 800 | 800 | 574.6 px | 814 px | No |
| [375 × 812](final/home-chromium-375x812.png) | 812 | 812 | 812 | 574.6 px | 814 px | No |
| [390 × 844](final/home-chromium-390x844.png) | 844 | 844 | 844 | 581.1 px | 844 px | No |
| [430 × 932](final/home-chromium-430x932.png) | 932 | 932 | 932 | 581.1 px | 932 px | No |
| [768 × 1024](final/home-chromium-768x1024.png) | 1024 | 1024 | 1024 | 837.9 px | 1109 px | No |
| [1024 × 900](final/home-chromium-1024x900.png) | 900 | 900 | 900 | 872.4 px | 1143 px | No |
| [1440 × 1080](final/home-chromium-1440x1080.png) | 1080 | 1080 | 1080 | 949.6 px | 1221 px | No |
| [390 × 640](final/home-chromium-390x640.png) | 640 | 640 | 640 | 581.1 px | 820 px | No |

Raw bounding rectangles and font sizes: [geometry.json](final/geometry.json). The two secondary buttons sit alongside each other; their bottoms share the same coordinate.

**Visual acceptance review of the four phone screenshots**

| Question answered by inspecting the rendered screenshot | 360 × 800 | 375 × 812 | 390 × 844 | 430 × 932 |
| --- | --- | --- | --- | --- |
| Kalbėtis immediately visible? | Yes | Yes | Yes | Yes |
| Išversti nuotrauką visible? | Yes | Yes | Yes | Yes |
| Paklausti apie Italiją visible? | Yes | Yes | Yes | Yes |
| All three choices understandable without scrolling? | Yes | Yes | Yes | Yes |
| Large illustration wasting the first screen? | No | No | No | No |
| Excess blank space before or between actions? | No | No | No | No |
| Comfortable type rather than compressed text? | 28 / 21 px titles; 16–18 px copy | 28 / 21 px titles; 16–18 px copy | 28 / 22 px titles; 16–18 px copy | 28 / 22 px titles; 16–18 px copy |
| Entire cards easy to tap? | 324 × 238 main; 156 × 189 secondary | 339 × 238 main; 164 × 189 secondary | 354 × 238 main; 171 × 195 secondary | 394 × 238 main; 191 × 195 secondary |
| Awkward heading wrapping or clipping? | No; two clear lines per secondary title | No; two clear lines | No; two clear lines | No; two clear lines |
| Feels like a compact phone tool? | Yes; one dominant action and two choices | Yes | Yes | Yes |

At 430 × 932, remaining space is below the actions and tip. At 360 × 800, the document extends 14 px below the viewport for the footer; all primary actions are already visible. The extra 390 × 640 check models reduced usable height from browser controls: all three actions still fit, with about 59 px to spare.

**Observed issues and corrections**

1. [Before, 390 × 844](before/home-390x844.png): the first action began at 423.6 px, and the third extended below the screen. Replaced the mobile hero with one short question, made the header 64 px, and used a full-width conversation button above two compact buttons.
2. [First iteration, 360 px live screen](iteration-1/live-transcript-chromium-360x800.png): the original-text label was clipped while the waveform used vertical space. Removed the phone waveform and increased room for captions.
3. [Second iteration, 390 × 640](iteration-2/live-transcript-chromium-390x640.png): the sticky controls could cover translated text. The [photo](iteration-2/photo-chromium-390x640.png) and [assistant](iteration-2/assistant-chromium-390x640.png) introductions also pushed inputs too low. Removed repeated mobile introductions and compacted the live status in short viewports.
4. Dynamic resize regression: starting at 844 px and shrinking to 640 px could leave the newest translation clipped even though loading directly at 640 px looked correct. Added a ResizeObserver to keep the current translation in view when following the conversation. It leaves readers who scrolled into history in place. The [final capture after resizing](final/live-resized-chromium-390x640.png) and automated regression verify this case.

**Final tool screens**

- [Live conversation, WebKit 360 × 800](final/live-transcript-webkit-360x800.png): explicit “KALBĖKITE”, original and translation, Replay, Show and End in the viewport.
- [Reconnecting, 390 × 844](final/live-reconnecting-chromium-390x844.png): a single clear connection state and instruction to wait. Readiness is based on the confirmed session; microphone volume is not used to invent speaking or translation states.
- [Fullscreen translation](final/live-fullscreen-chromium-390x844.png): huge text and visible return/playback controls.
- [Photo, 390 × 640](final/photo-chromium-390x640.png): camera and photo-library actions are both fully visible.
- [Assistant, 390 × 640](final/assistant-chromium-390x640.png): text input, microphone and Send fit; suggested questions follow the input.
- [Help, 360 × 800](final/help-chromium-360x800.png): three short instructions and “Supratau”; privacy details remain available in a disclosure.
- [WebKit home, 360 × 800](final/home-webkit-360x800.png) and [430 × 932](final/home-webkit-430x932.png) confirm the compact layout in the Safari engine.

**Verification**

`npm run build` (including TypeScript checking) passed. All 14 server/transcript tests and all 48 Playwright browser scenarios passed. Browser projects cover desktop Chromium, Android-sized Chromium and iPhone-sized WebKit. Tests cover viewport geometry, tapping card corners and icons, help dismissal, visible camera/chat inputs, captions during viewport changes, accessibility checks, microphone-denial messaging, reconnect history, immediate microphone cleanup, saved photo/chat context, and the offline production PWA. `git diff --check` passed.

These are real browser renders using emulated viewports. The screenshot and browser-flow runs use synthetic microphone/WebRTC and mocked AI responses; they do not test physical camera hardware, live translation quality or real phone audio routing.

**Reproduce**

Run `npm run build`, then `npm start`. In a second terminal run `node --import tsx scripts/capture-layout.ts final`. `QA_BASE_URL` can select another running instance. This environment uses `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/italiano-playwright`; omit that variable with a normal Playwright browser installation. The capture script preserves separate viewport images and geometry, including the dynamic-resize case.
