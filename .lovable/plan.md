# AI Intent Auto-Tagger — Plan

## Current state (checked live, 13 Oct)
- 1,178 live contacts; 1,116 (95%) are `lead_type = prospect` because the column defaults to `'prospect'`.
- `lead_type` enum: prospect, registered, buyer, vip, expired — no "unclassified" value yet.
- 24 phone numbers have more than one live contact (Matilda included).
- An `lead-intent-classify` function already exists (hybrid rules + AI, read-only, writes to `ai_suggestions`). It uses a different intent list for conversion scoring. The new tagger will **reuse its AI call path (`_shared/ai-fallback.ts`, so your own-key fallback still works)** rather than build a second AI stack, but keep its own intent list.
- The Lead Call Report reads Twilio messages only; Maytapi threads are loaded for context but don't qualify a contact.

## 1. Data model (backend, permissions/RLS)
- New table `contact_tags`: contact_id, tag, kind (`source` | `intent` | `protected` | `system`), origin (`ai` | `manual` | `system`), confidence (0–1), reason (one line), based_on_message_id, created_by, created_at, updated_at. Unique on (contact_id, tag).
  - RLS: same visibility as the parent contact (reuses the existing contact-access helper). Only service role writes `ai`/`system` rows; users write only `manual` rows.
  - DB guard trigger: an `ai` write can never update or delete a `manual` row.
- New table `contact_tag_proposals` for the backfill preview (contact, proposed tags, reason, confidence, status pending/approved/rejected). Owner/admin-only RLS.
- `contacts`: add `prospect_verified boolean default false` (fast filter for the report) and keep `tags[]` mirrored for backward compatibility with existing screens and filters.
- Add `unclassified` to the `lead_type` enum and change the default to `unclassified`. Existing rows are **not** changed.
- Settings in `integration_settings`: `intent_tagger_enabled` (kill switch, starts true in log-to-tags mode), `intent_tagger_min_confidence` = 0.75.

## 2. Edge function `contact-intent-tag`
- Input: contact_id, conversation_id, message_id, channel, `dry_run` flag.
- Steps: load contact + manual tags → if a protected tag exists, stop (record reason, no AI call) → load new message + last 10 messages → redact phone/email before the AI call (workspace PII rule) → AI returns one primary intent + confidence + reason (structured output) → confidence ≥ threshold applies the intent tag, otherwise only `needs_review` → recompute `prospect:verified`.
- `prospect:verified` = has a source tag AND intent in {distributor, buyer, info, health_inquiry} AND no protected tag. Recomputed on every run, so "unclear" can later become a prospect (and lose it if a protected tag is added).
- `health_inquiry` also sets a `careful_handling` flag shown in the UI; the tagger itself never writes replies.
- Read/tag only: no sends, no automation triggers, no cascade to hot-lead-escalate.
- Dedupe: skip if this message id was already tagged; skip outbound and group messages.

## 3. Hooks into inbound handlers (fire-and-forget, non-fatal)
- `twilio-whatsapp-inbound`: after message insert → call tagger. On new contact creation → `source:twilio_inbound`.
- `maytapi-webhook-inbound` (1:1 branch only; group, Group Guard and welcome branches untouched): on new contact → `source:google_ad_whatsapp`; after message insert → tagger.
- `fb-messenger-inbound`: tagger after message insert, Vanto's own Page only (same owner gate as the auto-reply). Existing `source:facebook_ad` logic kept.
- Website form source: I couldn't find a website-form intake in this app. Assumption: tag `source:website_form` wherever that intake is identified — please tell me which form/function feeds contacts.
- Source tags are written once (insert-if-absent), never overwritten.

## 4. Existing team / customer (Get Well Grow)
- Workspace rule: no direct Hub→Grow connection; cross-app lookups go through the VantoOS synced record. Assumption: if that synced record is reachable from this project, the tagger checks it by phone and tags `existing:team`/`existing:customer`; if not, these tags are set manually for now and flagged as a dependency. Needs your confirmation.

## 5. Duplicates
- Inbound handlers already find-before-insert by normalized phone; I'll audit all three paths (and Messenger contacts that later share a phone) so a new contact is never created for an existing number.
- New "Duplicates for review" list (the 24 phones) in Contacts — opens the existing Merge modal. No auto-merge.

## 6. UI
- Contact view: tag chips with AI reason + confidence on hover; one-click buttons for Family / Friend / Team / Customer / Distributor; manual tags marked with a lock.
- Lead Call Report: "Prospects only" toggle (on by default); includes Maytapi-sourced contacts; new "Source" and "Why a prospect" columns. Existing date filters, summaries and stage edits unchanged.
- Backfill review screen (Reports tab): table of contact, proposed tags, reason, confidence; approve selected / approve all high-confidence / reject. Nothing written to `contact_tags` until approved.

## 7. MCP
- `get_lead_call_report`: new params `prospects_only`, `source_tag`, `intent_tag`; returns tags, intent reason, source. Version bump; goes live on your Publish.

## 8. Backfill (preview first)
- Runs the tagger in `dry_run` over existing contacts with inbound messages, in small batches to respect AI rate limits, writing only to `contact_tag_proposals`. Contacts with protected tags or `do_not_contact` are skipped untouched. Rough size: ~1,100 AI calls, billed to workspace credits (or your own key per fallback mode). I'll report the count before starting.

## Safety (unchanged behaviour)
- No message sending, cadence, follow-up, Group Guard, welcome sequence, sign-and-win or posting changes. Personal-contact exclusion and `do_not_contact` stay as they are.

## Risks
- **Lead-type default change**: any code that assumes new contacts are `prospect` (CRM pipeline, cadences, follow-up eligibility, Zazi/VantoOS sync validation) may skip "unclassified" contacts. I'll grep and list each before switching; Zazi sync may need mapping `unclassified → prospect` to avoid sync mismatch — **flagged as a cross-app schema change**.
- AI cost per inbound message; mitigated by skipping protected contacts and dedupe.
- PII: message text goes to the AI; phones/emails redacted, health content is sent — needs your OK.
- Grow/VantoOS lookup may not be available (section 4).

## Rollback
- Kill switch `intent_tagger_enabled=false` stops all tagging instantly. New tables are additive; hooks are non-fatal. Default can be set back to `prospect` in one migration; enum value stays harmlessly.

## Open questions
1. Which form feeds `source:website_form`?
2. OK to map `unclassified → prospect` for the Zazi/VantoOS sync?
3. OK to send message text (with phone/email redacted) to the AI, including health messages?
