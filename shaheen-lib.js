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

  // ---------------------------------------------------------------------
  // IT Workshop — the customer-facing status/track surface.
  //
  // This mirrors the WHOS IT lane exactly, so the site can never disagree with
  // the operator screen about whether a job is done:
  //   - `isOperatorSuccess` is the one place success is decided, and it decides
  //     it from the server's own state (`VERIFIED_PASS`), never a UI flag.
  //   - `presentLane` reads the server's state and nothing else.
  //   - `customerReading` translates that answer into the customer's words and
  //     names the one manual step staff take. It re-answers nothing.
  // The states below mirror whos-frontend src/itServiceLane.ts and the backend
  // src/it-service/it-lane.types.ts. A test pins all eleven.
  // ---------------------------------------------------------------------

  var IT_LANE_STATES = [
    'INTAKE_ONLY', 'AUTHORITY_MISSING', 'PROTECTION_MISSING', 'EXECUTION_MISSING',
    'EXECUTION_UNSUCCESSFUL', 'EXECUTION_INDETERMINATE', 'VERIFICATION_MISSING',
    'VERIFICATION_FAILED', 'EVIDENCE_UNREADABLE', 'SYNTHETIC_ONLY', 'VERIFIED_PASS'
  ];

  // The single success rule. Reads the server's answer; no other line decides.
  function isOperatorSuccess(state) { return state === 'VERIFIED_PASS'; }

  // How each state reads. `tone` drives styling only.
  var LANE_PRESENTATION = {
    INTAKE_ONLY: { tone: 'pending', headline: 'Job open, nothing requested', nextAction: 'Raise an execution request for the work this job needs.' },
    AUTHORITY_MISSING: { tone: 'blocked', headline: 'Not authorised to run', nextAction: 'Get an approved, in-scope, unexpired execution request before any work starts.' },
    PROTECTION_MISSING: { tone: 'blocked', headline: 'Recovery protection not proven', nextAction: 'Record a baseline, and for destructive work actually perform a restore from it.' },
    EXECUTION_MISSING: { tone: 'pending', headline: 'Authorised and protected, waiting on the station', nextAction: 'Run the approved action and relay the station result.' },
    EXECUTION_UNSUCCESSFUL: { tone: 'failed', headline: 'The outcome was not achieved', nextAction: 'This needs rework and a fresh approval, not sign-off.' },
    // Deliberately 'unproven', not 'failed': the station declined to say whether
    // its change applied, and 'failed' would assert it did not happen.
    EXECUTION_INDETERMINATE: { tone: 'unproven', headline: 'The station cannot say whether the change applied', nextAction: 'Read the device back before requesting anything further.' },
    VERIFICATION_MISSING: { tone: 'unproven', headline: 'Station reported success, nothing independent confirmed it', nextAction: 'Have a different station or engineer verify the outcome on the device itself.' },
    VERIFICATION_FAILED: { tone: 'failed', headline: 'An independent check found the outcome was not achieved', nextAction: 'Read the finding and rework; do not re-run the same approval.' },
    EVIDENCE_UNREADABLE: { tone: 'unproven', headline: 'Confirmed, but the evidence no longer reads back', nextAction: 'Restore the evidence, or re-verify. Until then this is not a pass.' },
    SYNTHETIC_ONLY: { tone: 'unproven', headline: 'Proven against a fixture, not the customer\u2019s device', nextAction: 'Verify on the real device with a real observation before telling the customer anything.' },
    VERIFIED_PASS: { tone: 'passed', headline: 'Outcome proven on the customer\u2019s device', nextAction: 'Nothing outstanding. The job can be closed and reported.' }
  };

  // The safe reading of an unknown state is never "it worked".
  function unknownStatePresentation(state) {
    return { tone: 'unproven', headline: 'This job is in a state this screen does not recognise', nextAction: 'Treat the job as unproven and check the lane record directly.', success: false };
  }

  function presentLane(view) {
    var state = view && view.lane && view.lane.state;
    var known = LANE_PRESENTATION[state];
    if (!known) return unknownStatePresentation(String(state));
    return { tone: known.tone, headline: known.headline, nextAction: known.nextAction, success: isOperatorSuccess(state) };
  }

  // The five actions a customer asks for, in the customer's own words.
  var WORKSHOP_ACTIONS = [
    { id: 'diagnose', icon: '\uD83D\uDD0E', label: 'Diagnose', ask: 'Masla kya hai, maloom karein.' },
    { id: 'repair', icon: '\uD83D\uDD27', label: 'Repair', ask: 'Kharabi theek karein.' },
    { id: 'backup', icon: '\uD83D\uDCBE', label: 'Backup', ask: 'Pehle mera data mehfooz jagah copy karein.' },
    { id: 'update', icon: '\u2B06\uFE0F', label: 'Update', ask: 'Software ko naya karein.' },
    { id: 'report', icon: '\uD83D\uDCC4', label: 'Report', ask: 'Mujhe likha hua natija dein.' }
  ];

  // The device families the workshop takes.
  var WORKSHOP_DEVICES = [
    { id: 'mobile', icon: '\uD83D\uDCF1', label: 'Mobile ya tablet' },
    { id: 'computer', icon: '\uD83D\uDCBB', label: 'Computer ya laptop' },
    { id: 'network', icon: '\uD83D\uDCF6', label: 'Network device' },
    { id: 'vehicle', icon: '\uD83D\uDE97', label: 'Gaari' },
    { id: 'boat', icon: '\u26F5', label: 'Kashti' }
  ];

  var ACTION_BY_STAGE = { INTAKE: 'diagnose', AUTHORITY: 'diagnose', PROTECTION: 'backup', EXECUTION: 'diagnose', VERIFICATION: 'repair', OUTCOME: 'report' };
  function iconForStage(stage) {
    var id = ACTION_BY_STAGE[stage];
    for (var i = 0; i < WORKSHOP_ACTIONS.length; i++) if (WORKSHOP_ACTIONS[i].id === id) return WORKSHOP_ACTIONS[i].icon;
    return '\uD83D\uDEE0\uFE0F';
  }

  // The one manual step per state. Every state has exactly one; there is no
  // state where staff are told to wait with nothing to do. `customerDetail` is
  // customer-safe; `action` is what the site can drop into the chat input as a
  // fallback. Nothing here posts or mutates on its own.
  var MANUAL_STEPS = {
    INTAKE_ONLY: { label: 'Record what the customer asked for', customerDetail: 'Tell the counter exactly what you need and we will start the work.', action: 'IT job intake: record the requested work' },
    AUTHORITY_MISSING: { label: 'Get the work authorised', customerDetail: 'A second person signs the work off before we touch the device. This is a check, not a delay.', action: 'IT job: raise and approve the execution request' },
    PROTECTION_MISSING: { label: 'Take the safety copy', customerDetail: 'We take a safety copy of your data before any risky step, and we prove the copy can be restored.', action: 'IT job: record the safety copy and rehearse a restore' },
    EXECUTION_MISSING: { label: 'Run the work on the device', customerDetail: 'The work is authorised and protected; it is waiting to be carried out on your device.', action: 'IT job: run the approved action and relay the result' },
    EXECUTION_UNSUCCESSFUL: { label: 'Re-plan the repair', customerDetail: 'The first attempt did not achieve the result. We will plan the next attempt with fresh approval.', action: 'IT job: plan a fresh attempt' },
    EXECUTION_INDETERMINATE: { label: 'Read the device back first', customerDetail: 'We cannot yet say whether the last step took effect, so we read the device before doing anything else.', action: 'IT job: read the device back' },
    VERIFICATION_MISSING: { label: 'Have someone check the device', customerDetail: 'The work reported success; a different person now confirms it on the device itself.', action: 'IT job: get an independent check on the device' },
    VERIFICATION_FAILED: { label: 'Rework from the finding', customerDetail: 'An independent check found the result was not achieved, so we rework it. Nothing is closed on an unproven result.', action: 'IT job: rework from the independent finding' },
    EVIDENCE_UNREADABLE: { label: 'Restore the evidence', customerDetail: 'The job was confirmed, but the record behind it must be restored before we rely on it again.', action: 'IT job: restore the evidence and re-verify' },
    SYNTHETIC_ONLY: { label: 'Verify on the real device', customerDetail: 'The result has been proven on a test setup, not yet on your device. One check on your device completes it.', action: 'IT job: verify on the real device' },
    VERIFIED_PASS: { label: 'Hand the device back', customerDetail: 'The result has been confirmed on your device. Nothing is outstanding.', action: 'IT job: close and hand over the written report' }
  };

  // Customer words per state. Engine vocabulary never reaches these.
  var CUSTOMER_HEADLINES = {
    INTAKE_ONLY: 'We have your request',
    AUTHORITY_MISSING: 'Being checked before we start',
    PROTECTION_MISSING: 'Taking your safety copy',
    EXECUTION_MISSING: 'Ready to work on your device',
    EXECUTION_UNSUCCESSFUL: 'First attempt did not work',
    EXECUTION_INDETERMINATE: 'Reading your device back',
    VERIFICATION_MISSING: 'Checking the result on your device',
    VERIFICATION_FAILED: 'An independent check asked for rework',
    EVIDENCE_UNREADABLE: 'Restoring the record',
    SYNTHETIC_ONLY: 'Proven on a test setup, not yet on your device',
    VERIFIED_PASS: 'Done and confirmed on your device'
  };

  var CUSTOMER_MESSAGES = {
    INTAKE_ONLY: 'We have your request. No work has started on the device yet.',
    AUTHORITY_MISSING: 'A second person is signing the work off before we touch your device.',
    PROTECTION_MISSING: 'We are making and testing a safety copy of your data before any risky step.',
    EXECUTION_MISSING: 'Your job is approved and protected, and is ready to be carried out on the device.',
    EXECUTION_UNSUCCESSFUL: 'The attempt did not achieve the result. We will plan the next attempt properly.',
    EXECUTION_INDETERMINATE: 'We cannot yet say whether the last step took effect, so we read the device before continuing.',
    VERIFICATION_MISSING: 'The work reported success. A different person now confirms it on the device itself.',
    VERIFICATION_FAILED: 'An independent check found the result was not achieved, so the work goes back for rework.',
    EVIDENCE_UNREADABLE: 'The job was confirmed, but the record behind it has to be restored before we rely on it.',
    SYNTHETIC_ONLY: 'The result is proven on a test setup, but not yet on your device. One real check completes it.',
    VERIFIED_PASS: 'The result has been confirmed on your device. Nothing is outstanding.'
  };

  // The customer reading of a job, derived from the server's own lane answer.
  function customerReading(view) {
    var state = view && view.lane && view.lane.state;
    var stage = view && view.lane && view.lane.reachedStage;
    var presentation = presentLane(view);
    return {
      icon: iconForStage(stage),
      tone: presentation.tone,
      headline: CUSTOMER_HEADLINES[state] || presentation.headline,
      message: CUSTOMER_MESSAGES[state] || presentation.headline,
      success: presentation.success,
      engineNote: presentation.success
        ? 'WHOS recorded the whole job, so the report is backed by evidence, not a verbal promise.'
        : 'WHOS is tracking this job. You do not need to follow anything \u2014 the counter will tell you the next step.',
      manualStep: MANUAL_STEPS[state] || MANUAL_STEPS.INTAKE_ONLY
    };
  }

  // The plain-language report a customer is handed. Never rounds an unproven
  // job up to "done".
  function customerReportText(input) {
    var reading = input.reading;
    var status = reading.success ? 'OUTCOME PROVEN' : 'NOT YET PROVEN \u2014 ' + String(reading.headline).toUpperCase();
    return [
      'IT SERVICE REPORT',
      'Job: ' + input.jobCode,
      'Device: ' + input.deviceLabel,
      'Status: ' + status,
      'What this means: ' + reading.message,
      'Next step: ' + reading.manualStep.label + ' \u2014 ' + reading.manualStep.customerDetail
    ].join('\n');
  }

  // Read-only fetch of the IT job work list. GET only; the site never writes.
  async function loadItJobs(fetchImpl, token, baseUrl) {
    var url = String(baseUrl || '').replace(/\/$/, '') + '/api/v1/it-service/jobs';
    var r = await request(fetchImpl, url, token, { method: 'GET' });
    if (!r.ok) return { error: describeError('IT jobs', r), status: r.status };
    var rows = normalizeList(r.data);
    return { jobs: Array.isArray(rows) ? rows : [] };
  }

  var api = {
    PUBLISH_UNLOCKED: PUBLISH_UNLOCKED, redact: redact, escapeHtml: escapeHtml, describeError: describeError,
    request: request, normalizeList: normalizeList, renderRows: renderRows, tokenExpiryMs: tokenExpiryMs,
    buildApprovalDraft: buildApprovalDraft, ciState: ciState, reviewVerdict: reviewVerdict,
    loadPrBoard: loadPrBoard, loadSpend: loadSpend, OWNER_KAAM: OWNER_KAAM, BACKEND_REPO: BACKEND_REPO,
    IT_LANE_STATES: IT_LANE_STATES, isOperatorSuccess: isOperatorSuccess, presentLane: presentLane,
    customerReading: customerReading, customerReportText: customerReportText, loadItJobs: loadItJobs,
    WORKSHOP_ACTIONS: WORKSHOP_ACTIONS, WORKSHOP_DEVICES: WORKSHOP_DEVICES, MANUAL_STEPS: MANUAL_STEPS,
    CUSTOMER_HEADLINES: CUSTOMER_HEADLINES, CUSTOMER_MESSAGES: CUSTOMER_MESSAGES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ShaheenLib = api;
})(typeof self !== 'undefined' ? self : this);
