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

## Ecosystem Lock (OD-0064, 2026-11-26)

The Owner ordered a comprehensive audit and lock of the WHOS ecosystem (Tesla, Uber dispatch, Alibaba model). The canonical text is `docs/WHOS_ECOSYSTEM_LOCK_ROLES_ROADMAP_V4.md` in `wise-hands-company/whos-backend` (the roadmap, the five phases and targets, the Drive Gate every role runs before work, strict orders for each role, and the anti-drift duty). Read it there before any task; there is deliberately no copy here, because a second copy is a second source of truth. About 99% of work is by API or event, and a PR is for code only. This section adds no authority and lowers no rule: only payment / transfer, plan subscription, buying, delete and sending email need the Owner's exact words, and a Maker never PASSes its own work.

