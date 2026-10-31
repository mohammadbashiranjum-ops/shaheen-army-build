# shaheen-army-build

## Tests
`npm test` (unit: node; UI: Playwright + Chromium, all network mocked — no live WHOS/GitHub/Meta call).
Publish All is locked until backend PR #816 is merged.

## WHOS session
By default, the WHOS access token is held in memory and `sessionStorage`. Enabling **Stay logged in** stores it in `localStorage` so it can be restored after a browser restart; use that option only on a trusted device because same-site scripts can read the token. Passwords, the Groq key, and the optional GitHub token remain memory-only. Explicit logout clears the app's token entries from both storage areas and the saved-session preference.

Phase A does not refresh or extend JWTs. The backend code default is 8 hours (the production override is unknown); when the server rejects a token, the app prompts for sign-in again without silently clearing the stored session.

## Installable PWA (app shell)
`manifest.json`, `sw.js` and `icons/` make the app installable from its GitHub Pages sub-path (`/shaheen-army-build/`); every URL is relative so the sub-path is not hard-coded. The icons are a plain neutral placeholder glyph (no logo asset exists in this repo) and can be replaced by same-named PNGs (192, 512, 512 maskable, 180 apple-touch).
The service worker precaches only the same-origin shell (`index.html`, `shaheen-lib.js`, manifest, icons), serves it network-first with a cached offline fallback, and never intercepts cross-origin requests (WHOS API, Groq, GitHub) or non-GET requests, so no authenticated response is ever cached. Bump `CACHE` in `sw.js` when the shell file list changes. Offline, the shell opens but WHOS calls still fail; there is no offline data.
Not covered: token refresh (re-sign-in on expiry, as before) and a same-origin API gateway.
