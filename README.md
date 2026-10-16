# shaheen-army-build

## Tests
`npm test` (unit: node; UI: Playwright + Chromium, all network mocked — no live WHOS/GitHub/Meta call).
Publish All is locked until backend PR #816 is merged.

## WHOS session
By default, the WHOS access token is held in memory and `sessionStorage`. Enabling **Stay logged in** stores it in `localStorage` so it can be restored after a browser restart; use that option only on a trusted device because same-site scripts can read the token. Passwords, the Groq key, and the optional GitHub token remain memory-only. Explicit logout clears the app's token entries from both storage areas and the saved-session preference.

Phase A does not refresh or extend JWTs. The backend code default is 8 hours (the production override is unknown); when the server rejects a token, the app prompts for sign-in again without silently clearing the stored session.
