# PLAN Module for Vanto CRM — Build Plan

Adapted from Zazi Mail's Plan spec, fitted to Vanto CRM's domain (WhatsApp/MLM CRM, lead pipeline, reports, contacts, Lovable AI Gateway).

## Goal

Replace the **Maytapi Unmatched** sidebar entry with a new **PLAN** Command Centre that:
- Manages tasks, reminders, meetings, daily notes for the operator.
- Reads **Lead Call Report notes** (and contact notes) to auto-suggest tasks — without overwriting existing notes flow.
- Connects to the existing **AI Agent**, upgraded to a "PhD specialist" on all Vanto modules (Contacts, CRM pipeline, Reports, Inbox, Workflows, Automations, Group Campaigns, Knowledge Vault, Zazi sync).
- Embeds a **PhD Partner** side-panel inside PLAN that uses the upgraded agent.

Maytapi Unmatched stays in the database and remains reachable via Settings (kept, just removed from main nav) — no data loss.

## Phases

### Phase 1 — Database & Backend
1. Migration: create `plan_tasks`, `plan_reminders`, `plan_meetings`, `plan_notes` (4 tables, RLS scoped to `auth.uid()`, GRANTs to authenticated + service_role, `updated_at` triggers, indexes per spec).
2. Add `source_ref jsonb` on `plan_tasks` to link tasks back to a contact / lead_call_summary / message (Vanto-specific addition).
3. Edge function `plan-ai-extract-actions`: takes raw text (note / dictated voice / report summary), returns structured `{tasks[], reminders[], meetings[]}`. Uses Lovable AI Gateway (`google/gemini-3-flash-preview`). POPIA redaction of phone/email before model call.
4. Edge function `plan-suggest-from-notes`: scheduled-callable; reads recent `lead_call_summaries` + `contact_activity` notes for the user, returns suggested tasks (no auto-insert; user confirms).
5. Upgrade existing `ai-chat` edge function: extend system prompt to "PhD specialist" covering all Vanto modules, lead types, MLM pipeline (Prospect → Registered → Purchase_Nostatus → Purchase_Status), Twilio/Maytapi delivery rules, Zazi sync. Add `mode: 'plan_partner'` that injects PLAN context (top 10 pending tasks, next 5 meetings, today's reminders, last 5 lead-call notes).

### Phase 2 — Sidebar swap & route
1. `src/lib/vanto-data.ts`: replace `'maytapi-unmatched'` with `'plan'` in the `Module` union (keep the maytapi-unmatched module type so existing code compiles; just remove from sidebar nav).
2. `AppSidebar.tsx`: replace the Maytapi Unmatched entry with **PLAN** (icon: `CalendarCheck` or `ListTodo`).
3. `Index.tsx`: route `'plan'` → `<PlanModule />`.
4. Add deep route `/plan` in `App.tsx`.

### Phase 3 — PLAN module UI
1. `src/hooks/usePlanData.ts` — `useTasks`, `useReminders`, `useMeetings`, `useNotes` (matching spec §5; dedup guard on task `create`).
2. `src/components/vanto/plan/PlanModule.tsx` — header + tabs (URL-driven `?tab=`): **Today / Tasks / Reminders / Meetings / Calendar / Notes / Suggestions**.
3. Sub-components: `TodayTab`, `TasksTab`, `RemindersTab`, `MeetingsTab`, `CalendarTab`, `NotesTab`, `SuggestionsTab`.
4. `CommandBar` (Cmd+K) overlay — unified search across tasks/reminders/meetings/notes + quick-create + nav.
5. `CommandMic` — voice intent (Web Speech API) → `plan-ai-extract-actions` → confirm card → insert (never auto-commit).
6. `InsiderPanel` → **"PhD Partner"** side rail: chat thread powered by upgraded `ai-chat` with `mode: 'plan_partner'`. Secretary Mode toggle (morning briefing once per day, persisted to localStorage).

### Phase 4 — Reports & Contacts wiring (no-replace)
1. In `LeadCallReport.tsx`: add a **"Suggest tasks from this note"** button next to the existing Notes textarea. Calls `plan-ai-extract-actions` with the note + contact context. Returns confirm card → on accept inserts into `plan_tasks` with `source_ref = {kind:'lead_call', contact_id, summary_id}`. Existing notes-to-contact behaviour is untouched.
2. In `ContactsModule` contact drawer (lightweight): add the same "Suggest tasks" affordance on the notes field.
3. **Suggestions tab** in PLAN: lists pending suggestions from `plan-suggest-from-notes` across all recent notes — user one-click promotes to a real task.

### Phase 5 — AI Agent upgrade
1. `AIAgentModule.tsx`: extend system prompt to PhD-specialist persona; add module-aware tools (lookup contact, lookup pipeline stage, summarise inbox for a number, list today's PLAN items).
2. Knowledge Vault: ensure module spec docs (`docs/MODULE_SPECS.md`, etc.) are seeded as a `vanto_internal` collection so RAG citations work for "how does X work in Vanto?".
3. PhD Partner panel in PLAN consumes the same agent backend — single source of truth.

### Phase 6 — QA & download
1. Smoke test: cross-user RLS, dedup, Cmd+K speed, voice → confirm round-trip, calendar dot rendering, note autosave (~800ms), Suggestion promote → task insert, PhD Partner morning briefing.
2. Generate a downloadable PDF copy of this plan into `/mnt/documents/Vanto_PLAN_Spec_v1.pdf` so you can share it.

## Vanto-specific deltas vs Zazi spec

| Area | Vanto change |
|---|---|
| Source | `plan_tasks.source` adds `'lead_call'` and `'contact_activity'` |
| Linking | `source_ref jsonb` on tasks to reach back to `contacts` / `lead_call_summaries` |
| AI Provider | Lovable AI Gateway (no extra secrets); model `google/gemini-3-flash-preview` |
| Domain prompt | PhD specialist trained on MLM lead types, APLGO product, Twilio + Maytapi delivery rules, Zazi sync |
| Suggestions | Driven by lead-call notes + contact_activity (Vanto's audit trail), not generic email |
| Sidebar | Replace Maytapi Unmatched (kept in DB; not deleted) with PLAN |

## Technical notes

- All 4 PLAN tables use the exact RLS + GRANT pattern from §4.5 of the spec.
- No CHECK constraints with `now()`; use trigger validators if needed.
- Edge functions reuse existing `LOVABLE_API_KEY` secret. No new secrets required.
- `plan-ai-extract-actions` must redact `+\d{7,}` and email regex before sending text to the model.
- Insert workflow always uses a **confirmation card**; never auto-write from voice/AI.
- PhD Partner panel is route-scoped to PLAN — global help button stays unchanged elsewhere.

## Deliverables on approval

- 1 migration (4 tables, policies, grants, triggers, indexes)
- 2 new edge functions + 1 upgraded (`ai-chat`)
- 1 new sidebar entry + 1 route
- ~10 new React files under `src/components/vanto/plan/`
- 1 hook file `usePlanData.ts`
- 2 minor edits: `LeadCallReport.tsx`, `ContactsModule.tsx` (additive only)
- Downloadable spec PDF at `/mnt/documents/Vanto_PLAN_Spec_v1.pdf`

Approve to proceed, or tell me which phases to defer.
