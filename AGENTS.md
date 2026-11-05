# AGENTS.md

## Working Criteria V2 (OD-0015)

The Owner ratified "Working Criteria V2" as **OD-0015** on 2026-11-02. This repo
follows it by reference; the rules are not copied here. Read them in
`wise-hands-company/whos-backend` (branch `main`):

- `docs/WHOS_OWNER_WORKING_CRITERIA_V2.md` (Owner-facing criteria)
- `docs/WHOS_AGENT_WORKING_ORDER_V2.md` (agent-facing short form)

This section lowers no existing rule. Payment, secrets/access, migrations,
external publish/send, legal commitment and destructive delete stay gated on
exact Owner approval. A Maker never PASSes its own work. Hosted GitHub Actions
CI is unavailable (issue #1296); run `npm test` locally.

## Owner standing orders — OD-0016 (2026-11-03) and OD-0017 (2026-11-05)

Canonical text lives on `whos-backend` `main`: the OD-0016 entry in
`config/whos_owner_directives_v1.json` and the section "Owner standing orders (2026-11-03)" in
`docs/WHOS_AGENT_WORKING_ORDER_V2.md`. OD-0017 and the Command Center runbook
`docs/WHOS_CC_COMMAND_CENTER_RUNBOOK.md` are not on `main` yet (pending on whos-backend).
There is deliberately no copy here, because a second copy is a second source of truth. This
pointer grants no authority and lowers no rule. Payment, secrets or access, migration, external
publish or send, legal commitment, permanent delete and any mutating action on a real device stay
exact-Owner-approval gated; the full list is the Boundary paragraph in
`docs/WHOS_AGENT_WORKING_ORDER_V2.md`. A Maker never judges its own artifact.
