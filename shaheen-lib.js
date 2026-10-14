// Pure logic for SHAHEEN ARMY. No DOM, no storage, no network of its own:
// fetch is injected so everything is unit-testable and nothing can publish by accident.
(function (root) {
  'use strict';

  // Publish All stays locked until backend PR #816 (Meta duplicate-post guard) is merged to main.
  var PUBLISH_UNLOCKED = false;

  var SECRET_RE = /(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*|gsk_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|Bearer\s+[A-Za-z0-9._-]{8,})/g;

  function redact(s) {
    return String(s == null ? '' : s).replace(SECRET_RE, '[hidden]');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function serverMessage(data) {
    if (!data) return '';
    var m = data.message;
    if (Array.isArray(m)) m = m.join(', ');
    return redact(m || data.error || '').slice(0, 200);
  }

  // Roman Urdu, real status, never secrets.
  function describeError(label, res) {
    var s = res && res.status;
    var msg = serverMessage(res && res.data);
    if (!s) return '❌ ' + label + ': WHOS tak nahi pahunch saka (network) ' + redact(res && res.error || '');
    var tail = ' [HTTP ' + s + (msg ? ': ' + msg : '') + ']';
    if (s === 401) return '❌ ' + label + ': login expire ho gaya. Dobara login karein.' + tail;
    if (s === 403) return '⛔ ' + label + ': permission nahi. Is account ko ye data dekhne ka haq nahi.' + tail;
    if (s === 404) return '❌ ' + label + ': endpoint nahi mila.' + tail;
    if (s === 429) return '⏳ ' + label + ': bohat requests, thori der baad try karein.' + tail;
    if (s >= 500) return '❌ ' + label + ': WHOS server ka masla.' + tail;
    return '⚠️ ' + label + ': data nahi mila.' + tail;
  }

  async function request(fetchImpl, url, token, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
    try {
      var r = await fetchImpl(url, { method: opts.method || 'GET', headers: headers, body: opts.body, cache: 'no-store', referrerPolicy: 'no-referrer' });
      var data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      return { ok: r.ok, status: r.status, data: data };
    } catch (e) {
      return { ok: false, status: 0, error: e && e.message };
    }
  }

  function normalizeList(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      var keys = ['data', 'items', 'results', 'projects', 'tasks'];
      for (var i = 0; i < keys.length; i++) if (Array.isArray(data[keys[i]])) return data[keys[i]];
    }
    return null; // unknown shape
  }

  function pick(o, names) {
    for (var i = 0; i < names.length; i++) if (o && o[names[i]] != null && o[names[i]] !== '') return o[names[i]];
    return '';
  }

  function renderRows(list, kind) {
    if (!list.length) return '<i>Koi ' + kind + ' nahi.</i>';
    return list.slice(0, 30).map(function (it, i) {
      var title = pick(it, ['name', 'title', 'code', 'id']);
      var status = pick(it, ['status', 'state']);
      return (i + 1) + '. <b>' + escapeHtml(title) + '</b>' + (status ? ' — ' + escapeHtml(status) : '');
    }).join('<br>') + (list.length > 30 ? '<br>… aur ' + (list.length - 30) + ' ' : '');
  }

  // JWT exp (seconds) read from the payload; null if unreadable. Never logged.
  function tokenExpiryMs(token) {
    try {
      var p = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var json = typeof atob === 'function' ? atob(p) : Buffer.from(p, 'base64').toString('utf8');
      var exp = JSON.parse(json).exp;
      return typeof exp === 'number' ? exp * 1000 : null;
    } catch (e) { return null; }
  }

  // Exact approval draft: pure data -> text. Performs no network call and cannot publish.
  function buildApprovalDraft(items, channels) {
    var seen = {}, rows = [];
    (items || []).forEach(function (it) {
      if (it && it.sku && !seen[it.sku]) { seen[it.sku] = 1; rows.push(it.sku); }
    });
    var ch = (channels || []).slice();
    return {
      items: rows, channels: ch, itemCount: rows.length, channelCount: ch.length,
      postCount: rows.length * ch.length,
      text: 'APPROVAL DRAFT\nItems (' + rows.length + '): ' + rows.join(', ') + '\nChannels (' + ch.length + '): ' + ch.join(', ') +
        '\nTotal posts: ' + rows.length * ch.length + '\nStatus: DRAFT — abhi kuch publish nahi hua.'
    };
  }

  // ---- GitHub read-only (PR board, spend). GET only. ----
  var GH = 'https://api.github.com';
  var BACKEND_REPO = 'wise-hands-company/whos-backend';

  function ciState(runs) {
    var list = (runs && runs.check_runs) || [];
    if (!list.length) return 'no checks';
    if (list.some(function (c) { return c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'cancelled'; })) return 'FAIL';
    if (list.some(function (c) { return c.status !== 'completed'; })) return 'chal raha';
    return 'PASS';
  }

  function reviewVerdict(reviews) {
    var latest = {};
    (reviews || []).forEach(function (r) {
      if (r.state === 'COMMENTED' || r.state === 'PENDING') return;
      latest[(r.user && r.user.login) || '?'] = r.state;
    });
    var v = Object.keys(latest).map(function (k) { return latest[k]; });
    if (v.indexOf('CHANGES_REQUESTED') >= 0) return 'changes requested';
    if (v.indexOf('APPROVED') >= 0) return 'approved';
    return 'review nahi';
  }

  async function loadPrBoard(fetchImpl, ghToken) {
    var list = await request(fetchImpl, GH + '/repos/' + BACKEND_REPO + '/pulls?state=open&per_page=10', ghToken);
    if (!list.ok) return { error: describeGh('PR board', list) };
    var out = [];
    for (var i = 0; i < list.data.length; i++) {
      var pr = list.data[i];
      var base = GH + '/repos/' + BACKEND_REPO;
      var runs = await request(fetchImpl, base + '/commits/' + pr.head.sha + '/check-runs?per_page=50', ghToken);
      var revs = await request(fetchImpl, base + '/pulls/' + pr.number + '/reviews?per_page=50', ghToken);
      out.push({
        number: pr.number, title: pr.title, draft: !!pr.draft, sha: pr.head.sha.slice(0, 7),
        ci: runs.ok ? ciState(runs.data) : 'CI ?(' + runs.status + ')',
        review: revs.ok ? reviewVerdict(revs.data) : 'review ?(' + revs.status + ')'
      });
    }
    return { prs: out };
  }

  function describeGh(label, res) {
    if (res.status === 404 || res.status === 401 || res.status === 403)
      return '⛔ ' + label + ': permission nahi [HTTP ' + res.status + ']. Private repo hai — read-only GitHub token (sirf Settings mein, memory mein) chahiye.';
    return describeError(label, res);
  }

  async function loadSpend(fetchImpl, ghToken, org) {
    if (!ghToken) return { error: '⛔ Kharcha: GitHub read-only token chahiye (Settings).' };
    var r = await request(fetchImpl, GH + '/organizations/' + org + '/settings/billing/usage/summary', ghToken, { headers: { 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!r.ok) return { error: describeGh('GitHub Actions kharcha', r) };
    var items = (r.data && r.data.usageItems) || [];
    var actions = items.filter(function (u) { return /actions/i.test(u.product || ''); });
    var net = actions.reduce(function (s, u) { return s + (Number(u.netAmount) || 0); }, 0);
    return { actionsNetUsd: Math.round(net * 100) / 100, lines: actions.length };
  }

  var OWNER_KAAM = [
    { id: 'pr816', title: 'Backend PR #816 (Meta duplicate-post guard) merge karna', text: 'Owner kaam: wise-hands-company/whos-backend PR #816 (Meta duplicate-post guard) ka exact-head review dekh kar merge ka faisla karein. Jab tak merge nahi, Publish All band rehta hai.' },
    { id: 'i163', title: 'Issue #163 provenance (wisehands1)', text: 'Owner kaam: Issue #163 par exact-head provenance wisehands1 se post karwayein, taake Supreme gate khul sake.' },
    { id: 'perm', title: 'Projects/Tasks permission check', text: 'Owner kaam: BASHIR_OWNER account ko Projects aur Tasks dekhne ki permission hai ya nahi, WHOS admin se confirm karwayein. App sirf "permission nahi (403)" dikhayegi; access koi change nahi hota.' },
    { id: 'ghtok', title: 'GitHub read-only token (optional)', text: 'Owner kaam: PR board aur kharcha dekhne ke liye sirf read-only GitHub token banayein aur app Settings mein daalein. Token sirf phone ki memory mein rehta hai.' }
  ];

  var api = {
    PUBLISH_UNLOCKED: PUBLISH_UNLOCKED, redact: redact, escapeHtml: escapeHtml, describeError: describeError,
    request: request, normalizeList: normalizeList, renderRows: renderRows, tokenExpiryMs: tokenExpiryMs,
    buildApprovalDraft: buildApprovalDraft, ciState: ciState, reviewVerdict: reviewVerdict,
    loadPrBoard: loadPrBoard, loadSpend: loadSpend, OWNER_KAAM: OWNER_KAAM, BACKEND_REPO: BACKEND_REPO
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ShaheenLib = api;
})(typeof self !== 'undefined' ? self : this);
