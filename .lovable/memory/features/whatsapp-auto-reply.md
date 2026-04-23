---
name: WhatsApp Auto-Reply v5.3
description: Knowledge-first answering: helper files demoted, Product Reference auto-included for wellness, source-usage diag
type: feature
---
v5.3 Knowledge-First Source Priority (2026-04-23):
- HELPER_FILE_TITLES set ("Topics and Links", "ZAZI CRM", "ZAZI Final Override", "Bank Code", "Backoffice training") are filtered OUT of answer chunks. They may only feed the link extractor — never the AI's answer source.
- scoreKnowledgeChunk: products/compensation/orders collections get +4 boost; "Product Reference"/"Product Guide" titles get +5; helpers get -100 penalty so they cannot win.
- Wellness/products/detected-product queries now ALWAYS pull the canonical "Product Reference" doc by title via loadFileChunksByTitle, so it can outrank ts_rank winners on vague queries like "What helps with stress?".
- New diag fields per call: `answer_source` (static_greeting | static_handoff | knowledge_pricing_doc | deterministic_extract | ai_grounded_chunks | raw_chunk_snippets | honest_fallback), `source_files`, `top_chunk_title`. Visible in Edge Function logs as `[auto-reply] DIAG: ...` for source-usage audit.
- Greeting and menu_3/handoff branches remain static by design (TASK 3) — tagged answer_source=static_*.

v5.2 Grounding Hardening (retained):
- Menu 1/2 load canonical pricing doc directly via title.
- Strict collections enforce STRICT_MIN_RELEVANCE = 0.05 gate.
- extractDirectPricingAnswer matches `- NRM (Blood sugar balance): R433.13` and reads PV from collection header.

v5.1 Inbox Stabilization (retained):
- Cooldown 15s, daily limit 40. maytapi-webhook-inbound handles both group ack + 1-on-1. send-message routes via last inbound provider.

Source-priority order (factual answers):
1. Deterministic extract from approved doc (e.g. NRM price from Pricing Quick Reference)
2. AI grounded on STRICT collection chunks (products/compensation/orders) — boosted scoring
3. AI grounded on Product Reference (forced-included for wellness/products)
4. AI grounded on opportunity/general chunks (assisted mode)
5. Honest fallback ("couldn't verify") — never bluff, never use helper files as primary source

Helper files are link-only:
- Topics and Links → searched separately, only injected as "Helpful next steps" links
- ZAZI Final Override / ZAZI CRM / Bank Code / Backoffice training → -100 score, filtered out of answer pool
