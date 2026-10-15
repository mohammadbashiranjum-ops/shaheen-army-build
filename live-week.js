// Live status (public GET only) + Marketing Week checklist. fetch/storage injected for tests.
(function (root) {
  'use strict';
  var BASE = 'https://whos-backend-production.up.railway.app/api/v1';
  var STALE_MS = 5 * 60 * 1000;

  // Resolves to {state:'ok'|'error', detail, data}; never throws. No credentials, no auth header.
  async function probe(fetchImpl, path, timeoutMs) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || 8000) : null;
    try {
      var r = await fetchImpl(BASE + path, { method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctl && ctl.signal });
      var data = null;
      try { data = await r.json(); } catch (e) {}
      if (!r.ok) return { state: 'error', detail: 'HTTP ' + r.status };
      return { state: 'ok', data: data };
    } catch (e) {
      return { state: 'error', detail: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally { if (t) clearTimeout(t); }
  }

  async function checkLive(fetchImpl, nowMs) {
    var h = await probe(fetchImpl, '/health');
    var c = await probe(fetchImpl, '/inventory/public/catalog');
    var healthOk = h.state === 'ok' && !!h.data && h.data.status === 'ok';
    var catOk = c.state === 'ok' && Array.isArray(c.data);
    return {
      checkedAt: nowMs,
      health: healthOk ? { ok: true, commit: String(h.data.commit || '').slice(0, 7), uptimeSeconds: h.data.uptimeSeconds } : { ok: false, detail: h.detail || 'bad response' },
      catalog: catOk ? { ok: true, count: c.data.length, items: summarizeItems(c.data) } : { ok: false, detail: c.detail || 'bad response' }
    };
  }

  // Only the fields the card shows; everything else from the API is dropped.
  function summarizeItems(list) {
    return list.map(function (x) {
      var inv = (x && x.inventoryItem) || {};
      return { sku: String(inv.sku || ''), title: String((x && x.title) || ''), price: x && x.publicPrice != null ? String(x.publicPrice) : '', currency: String((x && x.currencyCode) || ''), availability: String((x && x.availability) || '') };
    });
  }

  // Read-only pipeline view of the PUBLIC catalog only. Facebook/Instagram status is not in this API.
  function pipelineSummary(items) {
    var by = {};
    (items || []).forEach(function (i) { by[i.availability || 'UNKNOWN'] = (by[i.availability || 'UNKNOWN'] || 0) + 1; });
    return { total: (items || []).length, byAvailability: by };
  }

  // LIVE only when that check succeeded just now. A failed check never claims LIVE.
  function label(part) { return part && part.ok ? 'LIVE' : 'UNKNOWN'; }

  // Given the newest attempt and the last fully good result, decide what the card says.
  function cardState(latest, lastGood, nowMs) {
    if (!latest) return { kind: 'LOADING' };
    if (latest.health.ok || latest.catalog.ok) return { kind: 'FRESH', health: label(latest.health), catalog: label(latest.catalog) };
    if (lastGood && nowMs - lastGood.checkedAt <= STALE_MS) return { kind: 'STALE', health: 'UNKNOWN', catalog: 'UNKNOWN', lastGoodAt: lastGood.checkedAt };
    return { kind: 'ERROR', health: 'UNKNOWN', catalog: 'UNKNOWN', lastGoodAt: lastGood ? lastGood.checkedAt : null };
  }

  var MARKETING_WEEK = [
    { day: 'Mon', task: 'Naya listing post' },
    { day: 'Tue', task: 'Tip / behind-the-scenes reel' },
    { day: 'Wed', task: 'Customer FAQ story' },
    { day: 'Thu', task: 'Before/after ya demo (sirf wahi jo Owner ne khud check kiya ho)' },
    { day: 'Fri', task: 'Weekend availability roundup' },
    { day: 'Sat', task: 'Community / local Nauru story' },
    { day: 'Sun', task: 'Rest + is hafte ke messages review' }
  ];

  // ISO week key so the checklist restarts each week (localStorage only, non-secret).
  function weekKey(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var n = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - n);
    var y = t.getUTCFullYear();
    var w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return 'shaheen_week_' + y + '-W' + (w < 10 ? '0' : '') + w;
  }
  function loadChecks(storage, key) {
    try { var v = JSON.parse(storage.getItem(key) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }
  function saveChecks(storage, key, checks) {
    try { storage.setItem(key, JSON.stringify(checks)); return true; } catch (e) { return false; }
  }

  var api = { BASE: BASE, STALE_MS: STALE_MS, checkLive: checkLive, cardState: cardState, label: label, summarizeItems: summarizeItems, pipelineSummary: pipelineSummary,
    MARKETING_WEEK: MARKETING_WEEK, weekKey: weekKey, loadChecks: loadChecks, saveChecks: saveChecks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LiveWeek = api;
})(typeof self !== 'undefined' ? self : this);
