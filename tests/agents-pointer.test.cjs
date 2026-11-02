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
});
test('AGENTS.md keeps the exact-Owner-approval gates and no-self-PASS rule', () => {
  for (const g of ['Payment', 'secrets/access', 'migrations', 'external publish/send', 'legal commitment', 'destructive delete', 'never PASSes its own work'])
    assert.ok(agents.toLowerCase().includes(g.toLowerCase()), g);
});
test('CLAUDE.md imports AGENTS.md instead of forking it', () => {
  assert.match(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md$/m);
});
