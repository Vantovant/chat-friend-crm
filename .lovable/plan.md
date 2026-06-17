# Phase 2a — Google Sheets Two-Way Pipeline Sync

Category: **Backend (Edge Functions) + Infra (cron + connector)**.
Scope: Sheets only. Drive (2b) follows after approval.

## Goal

- **Out:** Nightly export of the 9-stage lead pipeline from `contacts` → a Google Sheet leadership can read/edit.
- **In:** Edits leadership makes in the Sheet (stage changes, "won", notes) sync back into `contacts` without overwriting fresher CRM data and without loop-flapping.
- Zero schema changes. Zero touching of WhatsApp inbox, auto-reply, calendar.

## Components

```text
                  ┌───────────────────────────────────────┐
                  │  pg_cron (02:00 SAST nightly)         │
                  │  → POST /functions/v1/sheets-sync     │
                  │       { mode: "export" }              │
                  └──────────────┬────────────────────────┘
                                 │
   ┌─────────────────────────────▼──────────────────────────────┐
   │  Edge Function: sheets-sync   (NEW, verify_jwt=false)      │
   │                                                            │
   │   mode = "export"   → CRM → Sheet (full refresh tab)       │
   │   mode = "import"   → Sheet → CRM (delta apply)            │
   │   mode = "sync"     → import then export (manual button)   │
   │                                                            │
   │   Uses Lovable Google Sheets connector via gateway:        │
   │     https://connector-gateway.lovable.dev/google_sheets/v4 │
   │   Headers: Authorization Bearer LOVABLE_API_KEY            │
   │            X-Connection-Api-Key GOOGLE_SHEETS_API_KEY      │
   └─────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
                ┌──────────────────────────────────┐
                │ Google Sheet (leadership)        │
                │  Tabs:                           │
                │   • Pipeline  (editable)         │
                │   • _Meta     (hidden, audit)    │
                └──────────────────────────────────┘
```

## Sheet layout — `Pipeline` tab

| Col | Header              | Source                                | Editable by leadership |
| --- | ------------------- | ------------------------------------- | ---------------------- |
| A   | `contact_id` (uuid) | `contacts.id`                         | NO (locked key)        |
| B   | `name`              | `contacts.full_name`                  | NO                     |
| C   | `phone`             | `contacts.phone_normalized`           | NO                     |
| D   | `lead_type`         | `contacts.lead_type`                  | YES                    |
| E   | `pipeline_stage`    | `contacts.pipeline_stage` (1 of 9)    | YES                    |
| F   | `status`            | `contacts.status` (e.g. "won","lost") | YES                    |
| G   | `owner_email`       | profile of `contacts.assigned_to`     | NO                     |
| H   | `notes_leadership`  | free text                             | YES                    |
| I   | `crm_updated_at`    | `contacts.updated_at` (ISO)           | NO                     |
| J   | `sheet_touched_at` | written by leadership edit (formula or import-time stamp) | auto |
| K   | `human_origin`      | TRUE if a person edited the row       | auto                   |

Hidden `_Meta` tab stores: last export run id, last import run id, row count, hash of exported snapshot, last error.

## Loop prevention (the critical bit)

Two independent guards, both must pass before a Sheet → CRM write happens:

1. **`human_origin = TRUE`** on the row. The export pass always writes `human_origin = FALSE`. Only a human edit (or our import that detects a real diff) flips it TRUE. Rows with FALSE are ignored on import.
2. **Timestamp dominance:** apply the Sheet value only if `sheet_touched_at > crm_updated_at + 60s` skew. Otherwise CRM is fresher — discard and re-export that row to correct the Sheet.

After a successful CRM write we set `human_origin = FALSE` and refresh `crm_updated_at` so the same edit cannot replay.

No new DB columns needed: `updated_at` already exists on `contacts`; `human_origin` and `sheet_touched_at` live only in the Sheet.

## Edge Function: `supabase/functions/sheets-sync/index.ts`

- `verify_jwt = false` (called by pg_cron and by an internal admin button).
- Auth: requires header `x-dispatcher-token` matching the existing `DISPATCHER_TOKEN` secret. No other caller can invoke it.
- Reads `integration_settings` key `sheets_pipeline_spreadsheet_id` (Admin-set in Integrations UI, no schema change — `integration_settings` is k/v).
- Uses Google Sheets connector gateway only — never the provider SDK direct.
- Operations:
  - **Export:** `batchGet` current `Pipeline!A2:K`, build a map by `contact_id`, fetch all in-pipeline contacts (`lead_type IN (...)` per project rules), compute the new matrix, then `values.update` `Pipeline!A2:K{n}` in one call. Preserves leadership-only columns (D, F, H) when their row is `human_origin=TRUE` and newer than CRM.
  - **Import:** read `Pipeline!A2:K`, filter rows where `human_origin = TRUE` AND `sheet_touched_at > crm_updated_at`, update `contacts` (only columns D/E/F/H map back), write a `contact_activity` row `type='sheet_sync_import'` with the before/after diff, then clear `human_origin` to FALSE via `values.batchUpdate`.
- Returns `{ exported, imported, skipped, errors[] }` and logs a `sync_runs` row (table already exists).

## Scheduling

- `pg_cron` job `sheets-sync-nightly` at `0 0 * * *` UTC (02:00 SAST) calling the function with `{mode:"sync"}` (import first so leadership wins ties, then export). Created via `supabase--insert` SQL using the project URL + anon key (per the schedule-jobs instructions) — no migration.
- Manual "Sync Now" button can be added later in `IntegrationsModule.tsx`; not in this phase.

## Connector + secret prerequisites

- Link the **Google Sheets** connector to this project (it's gateway-enabled). Will request via `standard_connectors--connect` after you approve this plan.
- Add one new `integration_settings` row (key=`sheets_pipeline_spreadsheet_id`, value=the Sheet ID). No new Supabase secret needed.
- Leadership Sheet must be shared with the connected Google account as **Editor**.

## Out of scope (explicitly)

- No edits to: `whatsapp-auto-reply`, `maytapi-*`, `twilio-*`, `inbox` UI, `calendar-webhook`, `google-calendar-create`, `MeetingQuickAdd.tsx`.
- No schema changes. No new tables. No new columns.
- Drive ingest (Phase 2b) is a separate function and a separate plan.

## Risks / mitigations

- **Concurrent leadership edits during export** → export is single `values.update` after read; worst case a human edit made mid-run gets overwritten and they redo it. Cron runs nightly so window is tiny. Acceptable for v1.
- **Connector token expiry** → handled by gateway auto-refresh.
- **Sheet deleted / wrong ID** → function returns 422, logs to `sync_runs`, no CRM mutation.

## Deliverables for 2a

1. `supabase/functions/sheets-sync/index.ts` (new).
2. `integration_settings` row for spreadsheet ID (manual insert or via Integrations UI later).
3. pg_cron job `sheets-sync-nightly`.
4. Google Sheets connector linked.

Approve and I'll (1) request the connector link, then (2) ship the function + cron, then (3) move to Phase 2b Drive plan.
