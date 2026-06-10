## Vanto CRM — AI Agent Upgrade (PhD Partner Mode)

**User priority:** the AI Agent must be **fully able to read WhatsApp chats** from both the Twilio inbox (`messages`/`conversations`) and the Maytapi inbox (`maytapi_messages`). The PDF spec is the broader target; this plan ships the WhatsApp-reading capability first inside a non-destructive new mode.

Issue category: **Backend (edge function + retrieval) + UI (new tab in AI Agent page)**.

### Preservation rule (from spec §5)
- `AIAgentModule.tsx` and `ai-chat` edge function stay **untouched**.
- New work ships as a second tab inside the AI Agent page → "PhD Partner".

---

### Phase 1 — WhatsApp-aware retrieval (this turn)

**1. New edge function `crm-ai-partner`**
- Validates JWT via `supabase.auth.getUser()`.
- Server-side intent detection (regex packs from spec §10) → modes: `daily_review`, `inbox_only`, `trainer` (admin), default `crm_strategist`.
- Parallel retrieval (`Promise.all`, 10 KB cap, PII redaction for phone/email/IDs):
  1. `contacts` (filter `is_deleted=false`, optional tag/segment filter)
  2. `pipeline_stages` counts
  3. **`messages` (Twilio 1:1)** — last 100, joined to `contacts` for name, with `direction`, `body`, `created_at`, 24h-window flag
  4. **`maytapi_messages`** — last 100, with `group_name`, `from_name`, `body`, `direction`, `timestamp`
  5. `conversations` — last 50 with `unread_count`, `last_message`, `status`
  6. `ai_suggestions` (pending Master Prospector drafts)
  7. `ai_trainer_rules` (admin only)
  8. `knowledge_files` + `search_knowledge` RPC (explicit `@doc:` / `refer to "X"` detection)
  9. `lead_call_summaries` (last 30 days)
  10. `plan_tasks` / `plan_reminders` / `plan_meetings`
- Inbox-only mode skips everything except the two WhatsApp sources.
- Stream via SSE: `{type:"text"}` deltas + final `{type:"retrieval_meta"}` frame.
- Model: `google/gemini-2.5-flash` (chat). Handle 429/402 explicitly.
- System prompt = CRM Strategist variant from spec §1.5 (13 rules, retargeted at CRM modules).

**2. DB migration — thread persistence**
- `crm_partner_threads` (id, user_id, title, pinned, archived, last_message_at, timestamps)
- `crm_partner_messages` (id, thread_id, user_id, role, content, retrieval_meta jsonb, created_at)
- RLS: every row scoped to `auth.uid()`. Grants for `authenticated` + `service_role`.

**3. UI — new tab in AI Agent page**
- `src/components/vanto/ai-agent/PhDPartnerTab.tsx` — chat panel with:
  - Threads sidebar (list, new, pin, archive, auto-title from first prompt)
  - SSE streaming renderer (reuse react-markdown)
  - Context-tag chips: `@all-contacts`, `@inbox`, `@maytapi`, `@knowledge`, `@trainer` (admin), inline tag parsing
  - Retrieval-meta badges under each assistant message ("Sources: inbox, maytapi, knowledge_base")
  - Reuse `DictationMic` for voice input
- `AIAgentModule.tsx` gets a `Tabs` wrapper: **Classic AI Agent** (unchanged) | **PhD Partner**.

**Acceptance for Phase 1:**
- Ask "summarise my WhatsApp inbox today" → answer cites real Twilio + Maytapi messages from the database.
- Ask "what's happening in group X" → pulls Maytapi messages for that group.
- Existing Classic AI Agent tab works exactly as before.
- Threads persist across reload, RLS-scoped.

---

### Phase 2 (later, not this turn)
- Structured tool-call modes: `weekly_pipeline_focus`, `pipeline_scan`, `compare_segments`.
- `crm_partner_scores` + `crm_partner_score_history` + Scores tab.
- `crm_partner_briefing_settings` + Briefing tab (weekly digest via WA/email).
- Central Brain admin mode.

I will start with the DB migration, then the edge function, then the UI tab.
