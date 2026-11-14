# Momentum Phase A tests
Real Postgres (>=15) + the real edge-function handlers with a scripted Maytapi. No network or production access.

    # one-time: a throwaway local Postgres (live is PostgreSQL 17.6; the suite passes on 17.6 and 16.15), plus `npm i pg` somewhere (TEST_NODE_MODULES points at its folder)
    PGHOST=/tmp PGPORT=54329 TEST_NODE_MODULES=/path/with/node_modules node --test --test-concurrency=1 tests/momentum/*.test.mjs

- `baseline_schema.sql`: live-matching tables/triggers (trigger bodies copied read-only from production on 2026-11-13).
- `sql.test.mjs`: ledger, cap, SAST day, fail-closed settings, concurrency, trigger/source gate, seed hashes, backfill, permissions, rollback.
- `handlers.test.mjs`: send-group, send-direct, google-calendar-create, Group Guard, route-coverage scan.
- DM_JID in the tests is a TEST PLACEHOLDER. The real Duplication Movement JID is still unverified and is not in any file.
- `compat.test.mjs`: deployment order. Runs the CURRENTLY DEPLOYED code (git archive of baseline 0cd907b) against the migrated DB (database-first), and the NEW code against an un-migrated / rolled-back DB (must fail closed).
- `freeze.test.mjs`: freeze blocks every send route on old and new code; pending / in-flight rows through a deployment window; route inventory of the deployed code.
- Also in sql.test.mjs: S12* migration makes zero zazi-sync-all calls (incl. as a non-superuser owner); in handlers.test.mjs: RL* per-contact limiter fails closed, H15* calendar link-preview correctness, HC* cap-aware holds.
- Type-check (not part of `node --test`): `deno check --config <import map: esm.sh supabase-js -> npm:@supabase/supabase-js@2.49.4> --node-modules-dir=none supabase/functions/<fn>/index.ts`.
- (v4) `ticks.test.mjs`: recovery-tick / demographics-recovery-tick / fb-cadence-tick against the REAL send-direct handler + real ledger/cap SQL. U* = pure classifier/backoff/refusal-contract tests; S1 = structured 423; T1-T12 run once per tick (success, cap exhaustion, midnight SAST rollover, freeze/unfreeze, emergency pause, limiter outage, ambiguous, thrown call, permanent failure, concurrent runs, batch stop, escalation); R* = tick-specific safeguards; V1 = held-sends view.
- (v4) `baseline_ticks.sql`: live column lists/constraints for the tick tables (read-only query 2026-11-13) and VERBATIM copies of the existing cadence-slot and demographics-lock functions. `helpers.mjs` adds a controllable clock (`setClockSast`) because the ticks have SAST quiet hours; the DATABASE keeps real time, so a midnight rollover is simulated by shifting ledger `sast_day` back one day.
- (v4) the loader stubs four modules the ticks import but v4 does not change (should-send-followup, group-invite, intent-links, ai-fallback); their own logic is out of scope here.

## v4.1 additions
- `ticks.test.mjs` L1-L6: B1 — the three ticks reserve the per-contact slot with `failClosed:true`; a limiter outage (error / null / garbled reply) sends nothing, consumes no cap, keeps the step, defers with backoff+jitter and recovers; ordinary per-contact limits unchanged; call-site/source evidence that no request-body flag can bypass freeze, emergency pause or the cap.
- `ticks.test.mjs` P1-P12: B2 — `release_parked_campaign_item()` (admin-only, service-role-only, idempotent, concurrency-safe, audited, never sends), outcome/action matrix, wrong-target refusals, baseline (0cd907b) ticks cannot reprocess parked items before/after the rollback script.
- The baseline commit is extracted with `git archive` (needs the repo's git history; those two tests skip if it is unavailable).
