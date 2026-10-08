// whos-connector.js
const WHOS_URL = "https://whos-backend-production.up.railway.app";

const CANDIDATE_ENDPOINTS = [
  "/api/v1/health", "/api/health", "/healthz", "/v1/health",
  "/api/v1/missions", "/api/missions", "/missions",
  "/api/v1/agents", "/api/agents", "/agents",
  "/api/v1/tools", "/api/tools", "/tools"
];

let WORKING_ENDPOINTS = JSON.parse(localStorage.getItem('whos_ep') || '{}');

async function probe(path) {
  try {
    const r = await fetch(WHOS_URL + path, { method: 'GET' });
    if (r.status !== 404) return { path, status: r.status };
  } catch(e) {}
  return null;
}

async function discoverEndpoints() {
  const found = {};
  for (const ep of CANDIDATE_ENDPOINTS) {
    const res = await probe(ep);
    if (res) {
      const key = ep.split('/').pop();
      found[key] = res.path;
    }
  }
  WORKING_ENDPOINTS = found;
  localStorage.setItem('whos_ep', JSON.stringify(found));
  return found;
}

async function whosCall(endpointKey, method = "GET", body = null) {
  const path = WORKING_ENDPOINTS[endpointKey];
  if (!path) return { ok: false, error: "Endpoint not discovered: " + endpointKey };
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(WHOS_URL + path, opts);
    return { ok: r.ok, status: r.status, data: await r.json() };
  } catch(e) { return { ok: false, error: e.message }; }
}

async function whosStartMission(idea) {
  for (const ep of ['missions']) {
    const r = await fetch(WHOS_URL + WORKING_ENDPOINTS[ep], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea, source: 'shaheen-army' })
    });
    if (r.status < 400) return await r.json();
  }
  return { error: 'Mission endpoint not found' };
}

// Auto-run on load
discoverEndpoints().then(f => console.log('WHOS Endpoints found:', f));
