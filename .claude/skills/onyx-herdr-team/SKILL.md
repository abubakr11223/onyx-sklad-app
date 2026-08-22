---
name: onyx-herdr-team
description: "Onyx multi-agent Herdr team — Claude Planner (op) + grok workers o1–o4. Use when HERDR_ENV=1 in the Onyx repo: verify the team, restart missing agents, dispatch work via herdr CLI. Triggers: 'herdr jamoa', 'grok agentlar', 'jamoani tayyor qil', team setup, wave dispatch, QA dispatch."
---

# Onyx Herdr Team

Claude (this session) is the **Planner (P)** — plans, dispatches, reviews, approves. Grok agents in neighboring panes are the workers. Planner writes NO product code.

## HERDR_ENV (check first)

```bash
test "${HERDR_ENV:-}" = 1 || { echo "Not inside Herdr"; exit 1; }
```

If not inside Herdr: tell the user to open a new terminal window, run `cd ~/Desktop/Onyx && herdr`, start `claude` in a pane there, and repeat the request. Stop.

## TAXMIN QILMA (hard rule — all roles)

- Fayl yo'lini, API shaklini, xatti-harakatni TAXMIN QILMA — kodni o'qi, testni yurit, isbotla.
- Noma'lum → BLOCKED + aniq savol. Yolg'on DONE yo'q.
- «Ishlashi kerak» / «probably» degan gap taqiqlangan — faqat real natija (build/test output).

## Roles

| Name | Kind | Scope | Writes product code? |
|------|------|-------|----------------------|
| `op` | claude (this session) | plan, dispatch, review, approve prep | **no** |
| `o1` | grok | Backend/domain: `src/lib/`, `src/app/**/actions.ts`, validators | yes |
| `o2` | grok | DB/integrations: `prisma/`, Telegram webhook, `src/app/api/` | yes |
| `o3` | grok | Frontend/UI: pages, `src/components/`, `ui/` primitives | yes |
| `o4` | grok | QA: verify, run checks, list FAIL, suggest fix | **no** |

Names are `o1`–`o4`/`op` (not t1–t4) because the Makon Pro workspace lives on the same Herdr server and its live agents already own `t1`–`t4`/`planner` — agent names are unique per server.

## Setup (already built 2026-07-30 — verify, don't rebuild)

The Onyx workspace and agents were created by the outer session on 2026-07-30: workspace `Onyx` with tabs `T1+T2` (o1, o2), `T3+P` (o3, op), `QA` (o4). First action every session:

```bash
herdr agent list
```

If `o1`–`o4` are live → proceed to dispatch. If some are missing (pane closed, grok exited), restart only the missing one in its pane — find the pane by title via `herdr pane list --workspace <ws>` and:

```bash
herdr agent start o1 --kind grok --pane <pane-id> --timeout 60000
```

If `agent start` times out, read the pane (`herdr pane read <id> --source recent-unwrapped --lines 60`) — grok may be asking for login/approval; report to the user, do not guess.

## Planner MUST

1. Dispatch product work to `o1`–`o3` via `herdr agent prompt`; internal subagents are read-only (Explore/review) only.
2. Every worker prompt starts with: TAXMIN QILMA + exact file list to lock + acceptance criteria + verify commands (`npm run build`, `npm test`).
3. Workers lock files in `active_files.md` as `o1`…`o4` (same TTL/protocol as CLAUDE.md); release immediately after.
4. Kanban `active_tasks.md` as usual: TODO → AWAITING REVIEW → DONE. **Approval gate stays ON** — no commit until the user relays `approved <TASK-ID>`.
5. After a worker reports DONE → planner reviews with evidence (diff + own build/test run); no proof = not done.
6. Dependent UI work goes after API/domain work — dispatch in waves.

## Worker prompt / wait / read

```bash
herdr agent prompt o1 "TAXMIN QILMA. <task>… Lock: <files>. Acceptance: … Verify: npm run build && npm test" --wait --timeout 600000
herdr agent wait o4 --until idle --timeout 600000
herdr agent read o1 --source recent-unwrapped --lines 120
herdr agent get o1
```

`blocked` state → `agent read` first, then answer or escalate to the user. Never re-prompt blindly.

## o4 QA MUST

1. Not invent missing APIs or files — read the repo.
2. Run `npm run build` + `npm test` itself, paste real output.
3. Return `VERDICT: PASS|FAIL` + evidence.
4. On FAIL → propose the exact re-prompt for the responsible oN; never implement fixes itself.
