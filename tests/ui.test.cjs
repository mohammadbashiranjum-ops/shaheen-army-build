// UI test: real Chromium, all network mocked. No live WHOS/GitHub/Meta call is possible.
const { chromium } = require('playwright');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const JWT = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"exp":4102444800}').toString('base64url') + '.sig';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function setup(handler) {
  const exe = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const calls = [];
  await page.route('**/*', route => {
    const r = route.request(); const u = r.url();
    if (u.startsWith('file://')) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    calls.push(r.method() + ' ' + u);
    return handler(route, r, u);
  });
  await page.goto(url);
  return { browser, page, calls };
}
const json = (route, status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
async function login(page) {
  await page.click('.settings-btn');
  await page.fill('#whosEmail', 'owner'); await page.fill('#whosPass', 'pw');
  await page.click('#whosLoginBox button');
  await page.waitForSelector('#whosInfoBox:not(.hidden)');
}

test('Publish All is disabled and fires nothing', async () => {
  const { browser, page, calls } = await setup(route => json(route, 200, {}));
  assert.ok(await page.isDisabled('#publishBtn'));
  await page.click('#publishBtn', { force: true }).catch(() => {});
  assert.ok(!calls.some(c => /meta-publishing/.test(c)));
  await browser.close();
});

test('Projects 403 shows permission nahi + HTTP 403, token not stored', async () => {
  const { browser, page, calls } = await setup((route, r, u) =>
    /auth\/login/.test(u) ? json(route, 201, { accessToken: JWT }) : json(route, 403, { message: 'Forbidden resource' }));
  await login(page);
  await page.fill('#msg', 'Projects dikhao'); await page.click('.input-box button');
  await page.waitForSelector('.msg-err:has-text("HTTP 403")');
  const t = await page.textContent('#chat');
  assert.match(t, /permission nahi/); assert.doesNotMatch(t, /unknown/);
  const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + location.href + document.cookie);
  assert.ok(!stored.includes('eyJ'));
  assert.ok(!t.includes(JWT));
  await browser.close();
});

test('Projects success renders list; logout revokes and clears token', async () => {
  const { browser, page, calls } = await setup((route, r, u) =>
    /auth\/login/.test(u) ? json(route, 201, { accessToken: JWT }) :
    /auth\/logout/.test(u) ? json(route, 201, {}) : json(route, 200, { data: [{ name: 'Alpha', status: 'ACTIVE' }] }));
  await login(page);
  await page.fill('#msg', 'Projects dikhao'); await page.click('.input-box button');
  await page.waitForSelector('text=Alpha');
  page.on('dialog', d => d.accept());
  await page.click('#whosInfoBox button');
  await page.waitForSelector('#whosLoginBox:not(.hidden)');
  assert.ok(calls.some(c => /POST .*auth\/logout/.test(c)));
  await page.fill('#msg', 'Tasks dikhao'); await page.click('.input-box button');
  await page.waitForSelector('text=Pehle WHOS');
  await browser.close();
});

test('401 auto-logs out', async () => {
  const { browser, page } = await setup((route, r, u) =>
    /auth\/login/.test(u) ? json(route, 201, { accessToken: JWT }) : /logout/.test(u) ? json(route, 201, {}) : json(route, 401, { message: 'Unauthorized' }));
  await login(page);
  await page.fill('#msg', 'Tasks dikhao'); await page.click('.input-box button');
  await page.waitForSelector('#whosLoginBox:not(.hidden)');
  await browser.close();
});

test('Owner kaam shows copy items; PR board is GET-only and shows CI/review', async () => {
  const { browser, page, calls } = await setup((route, r, u) =>
    /\/pulls\?/.test(u) ? json(route, 200, [{ number: 816, title: 'Meta guard', draft: false, head: { sha: 'abcdef0123' } }]) :
    /check-runs/.test(u) ? json(route, 200, { check_runs: [{ status: 'completed', conclusion: 'success' }] }) :
    /reviews/.test(u) ? json(route, 200, [{ user: { login: 'r' }, state: 'APPROVED' }]) : json(route, 404, {}));
  await page.click('text=Owner kaam');
  assert.ok((await page.locator('.copy-btn').count()) >= 3);
  await page.click('text=PR Board');
  await page.waitForSelector('text=Meta guard');
  const t = await page.textContent('#chat');
  assert.match(t, /PASS/); assert.match(t, /approved/);
  assert.ok(calls.every(c => c.startsWith('GET ')));
  await browser.close();
});

test('Live card: LIVE when public GETs succeed; UNKNOWN (not LIVE) on failure; week checklist persists', async () => {
  const mk = ok => (route, r, u) => ok
    ? (/health/.test(u) ? json(route, 200, { status: 'ok', commit: 'abcdef0123' }) : json(route, 200, [{ id: 1 }]))
    : json(route, 503, {});
  let { browser, page, calls } = await setup(mk(true));
  await page.waitForSelector('#liveBody .pill.live');
  assert.match(await page.textContent('#liveBody'), /Backend: LIVE/);
  assert.ok(calls.every(c => c.startsWith('GET ')));
  assert.ok(calls.every(c => /\/api\/v1\/(health|inventory\/public\/catalog)$/.test(c.slice(4))));
  await page.click('button:has-text("Marketing Week")');
  assert.strictEqual(await page.locator('.week-row').count(), 7);
  await page.locator('.week-row input').first().check();
  await page.reload(); await page.click('button:has-text("Marketing Week")');
  assert.ok(await page.locator('.week-row input').first().isChecked());
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert.ok(keys.every(k => k.startsWith('shaheen_week_')));
  await browser.close();
  ({ browser, page } = await setup(mk(false)));
  await page.waitForSelector('#liveBody .pill.unknown');
  const t = await page.textContent('#liveBody');
  assert.match(t, /Backend: UNKNOWN/); assert.doesNotMatch(t, /LIVE/);
  assert.ok(await page.isDisabled('#publishBtn'));
  await browser.close();
});
