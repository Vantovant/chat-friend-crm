# Own-AI-key fallback + credit protection

## What's really happening (plain language)
- The yearly payment covers the **Pro plan** (features, monthly credit allowance). It does not cover unlimited usage.
- Your app runs lots of automations 24/7 (10-minute new-joiner runs, daily check-ins, auto-replies, summaries, digests). Each one uses **Cloud hosting** and, in 21 places, **built-in AI**. Both draw from the same credit balance.
- Before, the app was smaller, so usage fit inside the free allowance. It has grown a lot since, so it now burns through credits.
- This period: 226 credits used, all on this account. When the balance hit zero, the backend was paused.

## Important limit
Switching AI to your own OpenAI/Gemini/Claude key stops **AI** from eating credits. It does **not** cover the hosting itself (database, logins, scheduled jobs) — that always runs on Lovable Cloud. So a small top-up or a monthly budget will still be needed, but a much smaller one.

## What I'll build
1. **Settings > Integrations: "My AI keys"** — save your own OpenAI, Gemini and/or Claude key (stored as hidden secrets, admin-only, never shown back).
2. **Choose the order** — e.g. "Use my Gemini first, then built-in AI" or "Built-in first, fall back to my key when out of credits".
3. **Automatic fallback** — if built-in AI says "out of credits" or "too busy", the same request is retried on your own key, so auto-replies and summaries keep working.
4. **Usage note per request** — which provider answered, so you can see savings.
5. **Cut hosting waste** — review the 10-minute jobs and slow them where safe (e.g. new-joiner check every 30 min instead of 10) — only with your approval per job.

## Technical details
- New shared helper `supabase/functions/_shared/ai.ts`: `chat({messages, model, json})` → tries providers in configured order; on 402/429/5xx moves to next. Maps models (gemini-flash ↔ gpt-4o-mini ↔ claude-haiku).
- Keys as secrets `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`; order stored in `integration_settings.ai_provider_order` (no new table, existing RLS).
- Replace the direct gateway `fetch` in the 21 functions with the helper (behaviour unchanged when no key set).
- Rollback: set order to `lovable` only; helper then behaves exactly like today.

## Needs from you
- The backend must be resumed (top-up) before any of this can be deployed.
- Which key(s) you have: OpenAI, Gemini, Claude.
