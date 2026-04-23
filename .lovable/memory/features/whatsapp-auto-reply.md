---
name: WhatsApp Auto-Reply v6.1
description: Two-layer system — TRUTH LAYER (hybrid retrieval + raw_text fallback + memory) + SALES INTELLIGENCE LAYER
type: feature
---
v6.1 Knowledge Grounding Hardening (2026-04-23) — applied per VantoOS Fix Report:

TRUTH LAYER upgrades (file: supabase/functions/whatsapp-auto-reply/index.ts):
- FIX 1 — `rawTextFallback()`: when chunk search returns 0 hits OR top relevance < STRICT_MIN_RELEVANCE (0.05), the function now pulls full bodies (concatenated chunks, capped ~10 per doc) of the most likely doc(s) by keyword + tag match. Bypasses the strict gate because we have the actual doc body. New diag fields: `retrieval_path`, `raw_text_fallback_attempted`, `forced_doc_titles`. New `answer_source`: `ai_grounded_raw_text`.
- FIX 3 — Helper-file penalty softened from -100 to -10. Helpers (Topics and Links, Bank Code, ZAZI CRM, etc.) stay demoted but can now surface as last-resort sources instead of being mathematically invisible.
- FIX 4 — `loadDocsByKeywords()`: forced inclusion no longer depends on exact title strings ("Product Reference"). Now resolves docs by `title.ilike.%kw%` keyword set + `tags` array overlap. Books titled "APLGO Wellness Catalogue 2026" or "Stick Range Overview" are now reachable.
- FIX 5 — top-K bumped 8 → 12 for strict-likely queries (products/compensation/orders/pricing). Gemini 2.5 Pro re-ranks in-context. New diag: `top_k_used`.
- FIX 6 — `loadConversationMemory()`: pulls last 6 turns (3 inbound + 3 outbound) from `messages` table and injects them as chat history before the current user message. Follow-ups like "and the price?" now retain product context. New diag: `memory_turns`.
- FIX 7 — Expanded diagnostics on every reply: `retrieval_path`, `raw_text_fallback_attempted`, `forced_doc_titles`, `memory_turns`, `top_k_used`, plus existing `answer_source`, `source_files`, `top_chunk_title`, `top_relevance`, `effective_mode`, `fallback_reason`.

Source-priority order (factual answers, v6.1):
1. Static greeting / handoff (deterministic)
2. Deterministic price extract from approved doc (NRM regex)
3. AI grounded on chunk-search hits (boosted strict-collection scoring)
4. AI grounded on **raw_text fallback** (full doc body via keyword/tag match) ← NEW
5. Honest fallback — only after raw_text path also empty

SALES INTELLIGENCE LAYER (preserved from v6.0):
- Model `google/gemini-2.5-pro`, temperature 0.6, persona "Vanto's WhatsApp sales assistant".
- Response-mode policy: DIRECT_FACT / CLARIFY / RECOMMEND / SALES_ADVANCE / HONEST_FALLBACK.
- Always ends factual replies with one short follow-up question.
- Slim warm greeting; no menu dump.
- One contextual product/topic link appended; no heavy footer.

Preserved deterministic behaviors:
- "1" / "2" load canonical pricing doc by exact title and AI-summarise to ≤ 5 lines.
- NRM-style price regex still primary for explicit product+price questions.
- Strict no-hallucination contract still enforced — but raw_text fallback feeds the model enough evidence to honor it without false silence.
