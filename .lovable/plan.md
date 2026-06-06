# Lead Call Report — AI Summarization Plan

## Problem
Current PDF prints every WhatsApp message verbatim (Twilio + Maytapi). 94 contacts → 130 pages. Lots of noise: repeated Vanto/template messages, greetings, link previews. Hard to call from.

## Goal
Replace the raw message dump with a **concise AI summary per contact** (3–6 lines) showing:
- What the prospect asked / their core interest
- What was answered / last position
- Open question or next action
- Distributor intent (Yes/No/Maybe)

Target: ~1 contact per page, full report ≤ ~25 pages for 94 leads.

## Categorization
- **UI (Reports module):** new "Summary" column + new compact PDF layout
- **Backend (Edge Function + Lovable AI):** summarization endpoint
- **DB:** small cache table so we don't re-summarize unchanged threads
- **No DNS / email / RLS infra changes**

## How it will work

### 1. New edge function `summarize-lead-conversation`
- Input: `contact_id`, ordered message list (Twilio + Maytapi merged, deduped)
- Strips: outbound template/Vanto boilerplate repeats, link previews, "•", media-only entries
- Calls Lovable AI (`google/gemini-3-flash-preview`) with a strict prompt returning JSON:
  ```
  { intent, distributor_interest, key_questions[], answers_given[],
    open_items[], last_status, summary_text }
  ```
- Returns compact object; cost ~cheap per lead.

### 2. Cache table `lead_call_summaries`
Columns: `contact_id (pk)`, `summary jsonb`, `last_message_at`, `message_count`, `model`, `generated_at`.
Re-summarize only when `last_message_at` or `message_count` changes. Saves credits + speed.

### 3. UI changes in `LeadCallReport.tsx`
- New **"Summary"** column (replaces the giant per-message expansion in PDF)
- "Generate Summaries" button → batched calls (5 at a time, with progress bar)
- Toggle: **Compact PDF (summaries)** vs **Full PDF (raw messages)** — keeps current behavior available
- Distributor leads still pinned to top; existing filters/sorts preserved

### 4. New PDF layout (compact)
Per contact, one block:
```
#  Name  •  Phone  •  Distributor? Yes  •  Msgs: 14
First inquiry: 2026-05-12   Last msg: 2026-06-04
Interest: ...
Discussion: 3–5 line AI summary
Open / Next: ...
```
≈ 3–4 leads per page → ~25 pages for 94.

## Build order
1. Migration: create `lead_call_summaries` + grants + RLS
2. Edge function `summarize-lead-conversation` (Lovable AI, JSON output)
3. `LeadCallReport.tsx`: Summary column, batched generator, compact PDF mode
4. QA on the attached 94-lead dataset; verify distributor pinning + page count

## Out of scope
- Editing Damage Control / other reports
- Changing Twilio/Maytapi ingestion
- Auto-running summaries on a schedule (manual button for now; can automate later)

Approve and I'll build it.