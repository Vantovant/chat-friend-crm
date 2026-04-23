---
name: WhatsApp Auto-Reply v6.0
description: Two-layer system — TRUTH LAYER (knowledge grounding) + SALES INTELLIGENCE LAYER (elite WA consultant persona)
type: feature
---
v6.0 Sales Intelligence Upgrade (2026-04-23):
- Two-layer architecture: TRUTH LAYER (v5.3 grounding preserved) + SALES INTELLIGENCE LAYER on top.
- Upgraded system prompt: elite WhatsApp sales consultant for *Online Course For MLM* (APLGO ZA), African market aware, warm + sharp + concise + persuasive. Speaks on behalf of Vanto Vanto.
- Response-mode policy baked into prompt: DIRECT_FACT / CLARIFY / RECOMMEND / SALES_ADVANCE / HONEST_FALLBACK. AI must pick one mode per reply.
- AI must always end with one short, natural follow-up question (sales advance) — except in pure fallback.
- Model upgraded to `google/gemini-2.5-pro` (temperature 0.6) for stronger reasoning + persona fidelity.
- Static greeting slimmed dramatically: "Hey 👋 Vanto here from Online Course For MLM. What can I help you with — a product, a price, or the business opportunity?" — no menu dump.
- Heavy `HUMAN_CONTACT_FOOTER` block REMOVED from grounded factual replies. Only ONE relevant product link is appended (or one Topics-and-Links link). Footer is now a slim single-line WA fallback only.
- Menu_1 / menu_2: still deterministic-loaded from canonical pricing doc, but AI now ends with a sales-advance question ("Which one would you like more info on?").
- Honest fallback shortened and warmer — invites rephrasing or handoff in 2 lines, not a 5-line link block.

TRUTH LAYER (preserved from v5.3):
- HELPER_FILE_TITLES filtered out of answer chunks (Topics and Links, ZAZI CRM, ZAZI Final Override, Bank Code, Backoffice training).
- scoreKnowledgeChunk: products/compensation/orders +4, Product Reference/Guide +5, helpers -100.
- Wellness/products queries always force-load canonical "Product Reference" doc by title.
- STRICT_MIN_RELEVANCE = 0.05 gate for strict collections.
- extractDirectPricingAnswer regex matches `- NRM (Blood sugar balance): R433.13` and reads PV from collection header.
- Diag fields: `answer_source` (static_greeting | static_handoff | knowledge_pricing_doc | deterministic_extract | ai_grounded_chunks | raw_chunk_snippets | honest_fallback), `source_files`, `top_chunk_title`.

Source-priority order (factual answers, unchanged):
1. Deterministic extract from approved doc (e.g. NRM price)
2. AI grounded on STRICT collection chunks (products/compensation/orders) — boosted scoring
3. AI grounded on Product Reference (forced-included for wellness/products)
4. AI grounded on opportunity/general chunks (assisted mode)
5. Honest fallback — never bluff, never use helper files as primary source

Sales-layer behaviors (new in v6.0):
- "Hi" → short warm greeting + one open question, no menu dump
- "1" → 4-5 product/price lines + "Which one would you like more info on?"
- "How much is NRM?" → exact deterministic price + "Want the order link?" follow-up
- "What helps with stress?" → grounded RLX recommendation from Product Reference + next-step Q
- "I want to join" → grounded onboarding answer + "Want the registration link or quick explanation first?"
- Fallback ("Tell me about Bitcoin") → honest, warm, offers rephrase or handoff in 2 lines
