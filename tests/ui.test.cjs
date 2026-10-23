// UI test: real Chromium, all network mocked. No live WHOS/GitHub/Meta call is possible.
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const JWT = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"exp":4102444800}').toString('base64url') + '.sig';
const TOKEN_KEY = 'shaheen_army_whos_access_token_v1';
const STAY_KEY = 'shaheen_army_stay_logged_in_v1';

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
async function setupPersistent(handler, userDataDir) {
  const exe = process.env.CHROMIUM_PATH;
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(exe ? { executablePath: exe } : {}),
    viewport: { width: 390, height: 800 },
  });
  const page = await context.newPage();
  const calls = [];
  await page.route('**/*', route => {
    const r = route.request(); const u = r.url();
    if (u.startsWith('file://')) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    calls.push(r.method() + ' ' + u);
    return handler(route, r, u);
  });
  await page.goto(url);
  return { context, page, calls };
}
const json = (route, status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
function jwtWithExpiry(exp) {
  return 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.sig';
}
async function login(page, { stayLoggedIn = false } = {}) {
  await page.click('.settings-btn');
  if (stayLoggedIn) await page.check('#whosStayLoggedIn');
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

test('Projects 403 shows permission nahi; default token is session-only and never in URL/cookie/chat', async () => {
  const { browser, page, calls } = await setup((route, r, u) =>
    /auth\/login/.test(u) ? json(route, 201, { accessToken: JWT }) : json(route, 403, { message: 'Forbidden resource' }));
  await login(page);
  await page.fill('#msg', 'Projects dikhao'); await page.click('.input-box button');
  await page.waitForSelector('.msg-err:has-text("HTTP 403")');
  const t = await page.textContent('#chat');
  assert.match(t, /permission nahi/); assert.doesNotMatch(t, /unknown/);
  const stored = await page.evaluate(tokenKey => ({
    local: localStorage.getItem(tokenKey), session: sessionStorage.getItem(tokenKey),
    href: location.href, cookie: document.cookie,
  }), TOKEN_KEY);
  assert.strictEqual(stored.local, null);
  assert.strictEqual(stored.session, JWT);
  assert.ok(!stored.href.includes(JWT));
  assert.ok(!stored.cookie.includes(JWT));
  assert.ok(!t.includes(JWT));
  await browser.close();
});

test('raw user chat text is escaped before it reaches innerHTML', async () => {
  const { browser, page } = await setup(route => json(route, 200, {}));
  const payload = '<script>alert(1)</script>';
  await page.fill('#msg', payload);
  await page.click('.input-box button');
  await page.waitForSelector('.msg-user');
  assert.strictEqual(await page.locator('#chat script').count(), 0);
  assert.strictEqual(await page.locator('.msg-user').textContent(), payload);
  await browser.close();
});

test('dashboard data from WHOS is escaped before it reaches innerHTML', async () => {
  const payload = {
    total: '<img src=x onerror=alert(1)>',
    actionable: '<svg onload=alert(1)>',
    byStatus: { '<img class=x src=x onerror=alert(1)>': '<svg onload=alert(1)>' },
    items: [{ sku: '<img id=sku src=x onerror=alert(1)>', item: '<svg id=item onload=alert(1)>' }],
  };
  const { browser, page } = await setup((route, request, requestUrl) =>
    /auth\/login/.test(requestUrl) ? json(route, 201, { accessToken: JWT }) :
    /inventory\/pilot\/dashboard/.test(requestUrl) ? json(route, 200, payload) : json(route, 404, {}));
  await login(page);
  await page.locator('.quick-actions button').first().click();
  await page.waitForSelector('.msg-ai:has-text("INVENTORY DASHBOARD")');
  assert.strictEqual(await page.locator('#chat img, #chat svg').count(), 0);
  const text = await page.locator('.msg-ai').last().textContent();
  assert.ok(text.includes('<img src=x onerror=alert(1)>'));
  assert.ok(text.includes('<svg onload=alert(1)>'));
  await browser.close();
});

test('Projects success renders list; explicit logout revokes and clears both token stores', async () => {
  const { browser, page, calls } = await setup((route, r, u) =>
    /auth\/login/.test(u) ? json(route, 201, { accessToken: JWT }) :
    /auth\/logout/.test(u) ? json(route, 201, {}) : json(route, 200, { data: [{ name: 'Alpha', status: 'ACTIVE' }] }));
  await login(page, { stayLoggedIn: true });
  await page.fill('#msg', 'Projects dikhao'); await page.click('.input-box button');
  await page.waitForSelector('text=Alpha');
  const storedBeforeLogout = await page.evaluate(tokenKey => ({
    local: localStorage.getItem(tokenKey), session: sessionStorage.getItem(tokenKey),
  }), TOKEN_KEY);
  assert.strictEqual(storedBeforeLogout.local, JWT);
  assert.strictEqual(storedBeforeLogout.session, null);
  await page.evaluate(tokenKey => sessionStorage.setItem(tokenKey, 'stale-test-value'), TOKEN_KEY);
  page.on('dialog', d => d.accept());
  await page.click('#whosInfoBox button');
  await page.waitForSelector('#whosLoginBox:not(.hidden)');
  assert.ok(calls.some(c => /POST .*auth\/logout/.test(c)));
  const storedAfterLogout = await page.evaluate(tokenKey => ({
    local: localStorage.getItem(tokenKey), session: sessionStorage.getItem(tokenKey),
  }), TOKEN_KEY);
  assert.deepStrictEqual(storedAfterLogout, { local: null, session: null });
  assert.strictEqual(await page.evaluate(stayKey => localStorage.getItem(stayKey), STAY_KEY), null);
  assert.strictEqual(await page.isChecked('#whosStayLoggedIn'), false);
  await page.fill('#msg', 'Tasks dikhao'); await page.click('.input-box button');
  await page.waitForSelector('text=Pehle WHOS');
  await browser.close();
});

test('protected 401 shows re-login notice without clearing session or calling logout', async () => {
  const { browser, page, calls } = await setup((route, r, u) =>
    /auth\/login/.test(u) ? json(route, 201, { accessToken: JWT }) : /logout/.test(u) ? json(route, 201, {}) : json(route, 401, { message: 'Unauthorized' }));
  await login(page);
  await page.fill('#msg', 'Tasks dikhao'); await page.click('.input-box button');
  await page.waitForSelector('#whosStatus:text("Session expired. Please log in again.")');
  assert.ok(await page.isVisible('#whosLoginBox'));
  assert.ok(await page.isVisible('#whosInfoBox'));
  const stored = await page.evaluate(tokenKey => sessionStorage.getItem(tokenKey), TOKEN_KEY);
  assert.strictEqual(stored, JWT);
  assert.strictEqual(await page.locator('#chat').textContent().then(t => (t.match(/Session expired\. Please log in again\./g) || []).length), 1);
  assert.ok(!calls.some(c => /POST .*\/auth\/logout/.test(c)));
  await browser.close();
});

test('expiry timer verifies with /auth/me and retains a server-valid session', async () => {
  const shortToken = jwtWithExpiry(Math.floor(Date.now() / 1000) + 1);
  const { browser, page, calls } = await setup((route, r, u) =>
    /auth\/login/.test(u) ? json(route, 201, { accessToken: shortToken }) :
    /auth\/me/.test(u) ? json(route, 200, { username: 'owner', sub: 'owner-id' }) :
    /auth\/logout/.test(u) ? json(route, 201, {}) : json(route, 200, {}));
  await login(page);
  await page.waitForTimeout(1200);
  assert.ok(calls.some(c => /GET .*\/auth\/me/.test(c)));
  assert.ok(await page.isVisible('#whosInfoBox'));
  assert.strictEqual(await page.locator('#whosStatus').textContent(), '✅ WHOS Logged In');
  assert.ok(!calls.some(c => /POST .*\/auth\/logout/.test(c)));
  await browser.close();
});

test('expiry timer that receives 401 asks for re-login but keeps token until explicit logout', async () => {
  const shortToken = jwtWithExpiry(Math.floor(Date.now() / 1000) + 1);
  const { browser, page, calls } = await setup((route, r, u) =>
    /auth\/login/.test(u) ? json(route, 201, { accessToken: shortToken }) :
    /auth\/me/.test(u) ? json(route, 401, { message: 'Unauthorized' }) :
    /auth\/logout/.test(u) ? json(route, 201, {}) : json(route, 200, {}));
  await login(page);
  await page.waitForSelector('#whosStatus:text("Session expired. Please log in again.")', { timeout: 5000 });
  assert.strictEqual(await page.evaluate(tokenKey => sessionStorage.getItem(tokenKey), TOKEN_KEY), shortToken);
  assert.ok(await page.isVisible('#whosInfoBox'));
  assert.ok(await page.isVisible('#whosLoginBox'));
  assert.ok(!calls.some(c => /POST .*\/auth\/logout/.test(c)));
  await browser.close();
});

test('changing Stay logged in moves the active token between exactly one storage area', async () => {
  const { browser, page } = await setup((route, r, u) =>
    /auth\/login/.test(u) ? json(route, 201, { accessToken: JWT }) : json(route, 200, {}));
  await login(page);
  await page.check('#whosStayLoggedIn');
  let stored = await page.evaluate(([tokenKey, stayKey]) => ({
    local: localStorage.getItem(tokenKey), session: sessionStorage.getItem(tokenKey), stay: localStorage.getItem(stayKey),
  }), [TOKEN_KEY, STAY_KEY]);
  assert.deepStrictEqual(stored, { local: JWT, session: null, stay: '1' });
  await page.uncheck('#whosStayLoggedIn');
  stored = await page.evaluate(([tokenKey, stayKey]) => ({
    local: localStorage.getItem(tokenKey), session: sessionStorage.getItem(tokenKey), stay: localStorage.getItem(stayKey),
  }), [TOKEN_KEY, STAY_KEY]);
  assert.deepStrictEqual(stored, { local: null, session: JWT, stay: null });
  await browser.close();
});

test('Stay logged in restores and verifies the token after closing and reopening the browser', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaheen-pwa-session-'));
  let context;
  try {
    const handler = (route, r, u) =>
      /auth\/login/.test(u) ? json(route, 201, { accessToken: JWT }) :
      /auth\/me/.test(u) ? json(route, 200, { username: 'owner', sub: 'owner-id' }) :
      /auth\/logout/.test(u) ? json(route, 201, {}) : json(route, 200, {});
    const first = await setupPersistent(handler, userDataDir);
    context = first.context;
    await login(first.page, { stayLoggedIn: true });
    const firstStorage = await first.page.evaluate(([tokenKey, stayKey]) => ({
      localToken: localStorage.getItem(tokenKey),
      sessionToken: sessionStorage.getItem(tokenKey),
      stay: localStorage.getItem(stayKey),
    }), [TOKEN_KEY, STAY_KEY]);
    assert.strictEqual(firstStorage.localToken, JWT);
    assert.strictEqual(firstStorage.sessionToken, null);
    assert.strictEqual(firstStorage.stay, '1');
    assert.deepStrictEqual(await first.page.evaluate(() => Object.keys(localStorage).sort()), [TOKEN_KEY, STAY_KEY].sort());
    assert.strictEqual(await first.page.inputValue('#whosPass'), '');
    await context.close();

    const reopened = await setupPersistent(handler, userDataDir);
    context = reopened.context;
    await reopened.page.waitForFunction(() => document.getElementById('whosStatus').textContent === '✅ WHOS Logged In', null, { timeout: 5000 });
    assert.ok(reopened.calls.some(c => /GET .*\/auth\/me/.test(c)));
    assert.strictEqual(await reopened.page.evaluate(tokenKey => localStorage.getItem(tokenKey), TOKEN_KEY), JWT);
    await reopened.page.click('.settings-btn');
    assert.strictEqual(await reopened.page.isVisible('#whosInfoBox'), true);
    assert.strictEqual(await reopened.page.isChecked('#whosStayLoggedIn'), true);
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('unchecked Stay logged in keeps token in sessionStorage and does not restore after browser restart', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaheen-pwa-session-only-'));
  let context;
  try {
    const handler = (route, r, u) =>
      /auth\/login/.test(u) ? json(route, 201, { accessToken: JWT }) :
      /auth\/me/.test(u) ? json(route, 200, { username: 'owner', sub: 'owner-id' }) : json(route, 200, {});
    const first = await setupPersistent(handler, userDataDir);
    context = first.context;
    await login(first.page);
    assert.strictEqual(await first.page.evaluate(tokenKey => sessionStorage.getItem(tokenKey), TOKEN_KEY), JWT);
    assert.strictEqual(await first.page.evaluate(tokenKey => localStorage.getItem(tokenKey), TOKEN_KEY), null);
    await context.close();

    const reopened = await setupPersistent(handler, userDataDir);
    context = reopened.context;
    await reopened.page.click('.settings-btn');
    assert.strictEqual(await reopened.page.isVisible('#whosInfoBox'), false);
    assert.strictEqual(await reopened.page.isVisible('#whosLoginBox'), true);
    assert.ok(!reopened.calls.some(c => /GET .*\/auth\/me/.test(c)));
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
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
  assert.match(await page.textContent('#pipeBody'), /Public items: 1/);
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
test('PR board escapes external number and short SHA before HTML insertion', async () => {
  const number = '<img data-xss="number" src=x onerror="window.__xss=1">';
  const shortSha = '<img x>';
  const { browser, page, calls } = await setup((route, r, u) =>
    /\/pulls\?/.test(u) ? json(route, 200, [{ number, title: 'Safe PR title', draft: false, head: { sha: shortSha } }]) :
    /check-runs/.test(u) ? json(route, 200, { check_runs: [] }) :
    /reviews/.test(u) ? json(route, 200, []) : json(route, 404, {}));
  await page.evaluate(() => { window.__xss = 0; });
  await page.click('text=PR Board');
  await page.waitForSelector('text=Safe PR title');
  assert.strictEqual(await page.locator('#chat img').count(), 0);
  assert.strictEqual(await page.evaluate(() => window.__xss), 0);
  const text = await page.textContent('#chat');
  assert.ok(text.includes(number));
  assert.ok(text.includes(shortSha));
  assert.ok(calls.every(c => c.startsWith('GET ')));
  await browser.close();
});
