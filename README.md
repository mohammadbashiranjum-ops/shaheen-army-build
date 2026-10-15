# shaheen-army-build

## Tests
`npm test` (unit: node; UI: Playwright + Chromium, all network mocked — no live WHOS/GitHub/Meta call).
Publish All is locked until backend PR #816 is merged. Tokens/keys are kept in browser memory only.

## Live status & Marketing Week
Live card calls only public GET `/api/v1/health` and `/api/v1/inventory/public/catalog` (no credentials). LIVE = that call succeeded just now; otherwise UNKNOWN (or STALE within 5 min of the last good check). Marketing Week checklist is stored in localStorage only (non-secret, resets each ISO week).
