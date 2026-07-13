# Backlink Outreach — Vanto CRM Module (Plan C)

Ship a live module that turns the Backlink Outreach Kit v2 into an operational workflow inside Vanto CRM. Everything is agent/admin-only, guarded by the same role model already in the project.

## Deliverables

Two artifacts already shipped (Parts A + B):

- `SEO_Growth_Strategy_v2.pdf` / `.docx`
- `GetWellAfrica_Backlink_Outreach_Kit_v2.pdf` / `.docx`
- `backlink_tracker_v2.csv` (seed data for this module)

This plan is Part C — the CRM module.

## User-facing scope

- New sidebar entry **Backlink Outreach** under a **Growth** section (peer of Group Campaigns).
- Views: **Kanban** (Queued → Contacted → Reply → Negotiating → Published → Dead) and **Table** (sortable, filterable, exportable).
- Per-target drawer: contact info, per-site first-line hook, template picker (A / B / C / D), preview, send, notes, activity feed, backlink URL when published.
- Template library page: edit the 4 canonical templates (A/B/C/D), version-tracked.
- Bulk actions: assign, set status, tag, export CSV.
- CSV import: seed from `backlink_tracker_v2.csv`.
- Dashboard widget on the main Reports page: targets by status, outreach velocity, replies, published backlinks, referring-domain growth.
- Weekly digest email (Monday 08:00 SAST) to admins: last-week activity + this-week queue.

## Guardrails (hard-coded, admin-tunable via `integration_settings`)

- **≤ 5 outreach sends / day / user**
- **≤ 1 send / domain / 14 days**
- **DNC list**: any target flagged DNC is permanently blocked
- **Kill switch**: `integration_settings.key = 'backlink_outreach_enabled'` (default `true`)
- No exact-match anchors in the send form (front-end warning + server-side reject on list of banned anchors)
- Every send writes a full audit row (who, when, template used, hook line, target, result)

## Optional (deferred): Guest Post Draft Assistant

Not built in this plan — proposed as Plan D after C ships and is proven. It would generate 900-word drafts from Knowledge Vault + AI Trainer rules in site-specific tone.

---

## Technical section

### 1. Database (one migration)

New tables in `public`:

- `backlink_targets` — one row per site
  - `id uuid pk`, `name text not null`, `url text not null unique`, `status text not null default 'queued'` (queued / contacted / reply / negotiating / published / dead / dnc), `category text`, `approach text` (A/B/C/D), `contact_url text`, `first_line_hook text`, `assigned_to uuid references auth.users`, `domain_rating int`, `last_send_at timestamptz`, `next_action_at timestamptz`, `published_url text`, `notes text`, `created_by uuid`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`, `is_deleted boolean default false`
- `backlink_templates` — 4 seeded rows (A/B/C/D) + user-added
  - `id uuid pk`, `code text` (A/B/C/D or custom), `name text`, `subject_tpl text`, `body_tpl text`, `active bool default true`, `version int default 1`, `updated_by uuid`, `updated_at timestamptz default now()`
- `backlink_outreach_log` — every send + reply + status change
  - `id uuid pk`, `target_id uuid references backlink_targets on delete cascade`, `template_id uuid references backlink_templates`, `event_type text` (sent / reply / status_change / note), `direction text` (outbound/inbound), `subject text`, `body text`, `metadata jsonb`, `performed_by uuid`, `created_at timestamptz default now()`
- `backlink_settings` — thin table for the kill switch + caps (or reuse `integration_settings`)

**Grants + RLS** in the same migration, following the project pattern:

```sql
grant select, insert, update, delete on public.backlink_targets to authenticated;
grant all on public.backlink_targets to service_role;
-- (repeat for other tables; no anon grants)
alter table public.backlink_targets enable row level security;
create policy "agents+admins can read"  on public.backlink_targets for select to authenticated
  using (public.has_role(auth.uid(),'agent') or public.is_admin_or_super_admin());
create policy "agents+admins can write" on public.backlink_targets for all to authenticated
  using  (public.has_role(auth.uid(),'agent') or public.is_admin_or_super_admin())
  with check (public.has_role(auth.uid(),'agent') or public.is_admin_or_super_admin());
-- similar for backlink_templates, backlink_outreach_log
```

Trigger `enforce_backlink_send_caps()` on `backlink_outreach_log` insert where `event_type='sent'`:
- Reject if today's `sent` rows for `performed_by` ≥ 5
- Reject if any `sent` row exists for `target.url`'s domain in last 14 days
- Reject if `backlink_outreach_enabled` = false in `integration_settings`

Seed `backlink_templates` with A/B/C/D from the Outreach Kit v2.

### 2. Edge functions

- `backlink-send` — POST { target_id, template_id, hook_override? }. Renders subject + body using target + template + first-line hook, opens the user's default mail client via a `mailto:` response, and writes the `sent` log row. (No SMTP in v1 — we open mailto so we don't need email infra; v2 can add real send via existing email connector when the user asks.)
- `backlink-cadence-tick` — runs daily 06:00 SAST via `pg_cron`. Emits reminders in `backlink_outreach_log` for day-4 nudge and day-10 kill.
- `backlink-weekly-digest` — Monday 08:00 SAST. Summarises to admin emails.

### 3. UI (React + Tailwind, matches existing `vanto-card` / `vanto-gradient` tokens)

- `src/components/vanto/BacklinkOutreachModule.tsx` — top-level page
  - Header (title + filters + Import CSV + New Target)
  - Tabs: **Kanban** / **Table** / **Templates** / **Settings**
- `src/components/vanto/backlink/KanbanBoard.tsx` — drag-and-drop columns (reuse patterns from `CRMModule.tsx`)
- `src/components/vanto/backlink/TargetsTable.tsx` — sortable/filterable
- `src/components/vanto/backlink/TargetDrawer.tsx` — target detail + send flow
- `src/components/vanto/backlink/TemplateEditor.tsx`
- `src/components/vanto/backlink/SettingsPanel.tsx` — caps + kill switch

Sidebar addition in `src/components/vanto/AppSidebar.tsx`: new group "Growth" with **Backlink Outreach** under it. Route added to `src/pages/Index.tsx` module switch.

Reports dashboard widget added to `ReportsModule.tsx` with per-week outbound / reply / published counts.

### 4. Seed & import

- Seed script runs once from admin **Settings → Backlink Outreach → Import v2 kit** — parses `backlink_tracker_v2.csv` and inserts all 30 targets with correct status (skips DEAD as `dead`, marks BLOCKED / UNCHECKED normally).
- Also allow arbitrary CSV upload with column mapping.

### 5. Rollout

- Phase 1 (this build): tables + Kanban/Table/Drawer + mailto send + caps trigger + CSV import + sidebar entry
- Phase 2 (follow-up turn): cadence tick + weekly digest + Reports widget + template editor UI polish
- Phase 3 (later, optional): Semrush enrichment (auto-fetch DR / traffic per target) using the existing Semrush connector

### 6. Non-goals

- Not building a full SMTP sender (mailto is sufficient v1; keeps replies in your own inbox)
- Not touching Group Campaigns, Prospector, or Inbox
- No AI generation of first-line hooks in v1 (hooks already exist in seed data; AI drafting is Plan D)

---

**Approve this plan and I will build Phase 1 next turn (single migration + module + sidebar + import). Phases 2–3 are opt-in follow-ups.**
