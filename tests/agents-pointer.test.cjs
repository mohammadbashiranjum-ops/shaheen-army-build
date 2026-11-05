const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

test('AGENTS.md points at OD-0015 and both V2 docs by path', () => {
  assert.match(agents, /OD-0015/);
  assert.match(agents, /docs\/WHOS_OWNER_WORKING_CRITERIA_V2\.md/);
  assert.match(agents, /docs\/WHOS_AGENT_WORKING_ORDER_V2\.md/);
  assert.match(agents, /whos-backend` \(branch `main`\)/);
  assert.doesNotMatch(agents, /claude\/mission-rules-upgrade/);
});
test('AGENTS.md keeps the exact-Owner-approval gates and no-self-PASS rule', () => {
  for (const g of ['Payment', 'secrets/access', 'migrations', 'external publish/send', 'legal commitment', 'destructive delete', 'never PASSes its own work'])
    assert.ok(agents.toLowerCase().includes(g.toLowerCase()), g);
});
test('CLAUDE.md imports AGENTS.md instead of forking it', () => {
  assert.match(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md$/m);
});

function standingOrdersSection() {
  const lines = agents.split('\n');
  const start = lines.findIndex((l) => /^## Owner standing orders — OD-0016/.test(l));
  assert.ok(start >= 0, 'OD-0016/OD-0017 standing-orders section is missing');
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}
test('AGENTS.md points at OD-0016, OD-0017 and their canonical paths', () => {
  for (const s of ['OD-0016', 'OD-0017', 'config/whos_owner_directives_v1.json',
    'docs/WHOS_AGENT_WORKING_ORDER_V2.md', 'docs/WHOS_CC_COMMAND_CENTER_RUNBOOK.md'])
    assert.ok(agents.includes(s), s);
});
test('standing-orders pointer copies no rule text', () => {
  assert.doesNotMatch(agents, /IQ ?200|Hawk'?s Eye|Uber[- ]style|smart router|zero tolerance/i);
});
test('standing-orders section is 12 lines or fewer', () => {
  const sec = standingOrdersSection();
  assert.ok(sec.length <= 12, `section is ${sec.length} lines`);
});
test('standing-orders section names all six protected gates', () => {
  const sec = standingOrdersSection().join(' ').replace(/\s+/g, ' ').toLowerCase();
  for (const g of ['payment', 'secrets or access', 'migration', 'external publish or send', 'legal commitment', 'permanent delete'])
    assert.ok(sec.includes(g), g);
});
