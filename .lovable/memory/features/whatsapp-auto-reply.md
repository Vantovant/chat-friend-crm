---
name: WhatsApp Auto-Reply v6.2
description: Two-layer system — TRUTH LAYER (hybrid retrieval + raw_text fallback + memory) + SALES INTELLIGENCE LAYER with mandatory intent→product inference
type: feature
---
v6.2 Knowledge-First Inference + Strict Sales Shape (2026-04-23):

System prompt upgrades (file: supabase/functions/whatsapp-auto-reply/index.ts, generateAIAnswer):
- KNOWLEDGE-FIRST RULE: model MUST answer from any partial/related context (benefit, ingredient, category match). Refusing is only allowed when context is truly empty on the subject. Eliminates premature "I don't have a verified answer".
- INTENT → PRODUCT INFERENCE (mandatory): explicit mapping table baked into the prompt — stress/anxiety/sleep → RLX, tired/fatigue → PWR/GRW, joints → SLD, sugar/cravings → NRM, immunity → DOX/GTS, focus → BRN. Inference must still be supported by context (benefits found in chunks).
- RESPONSE SHAPE (strict 2–4 lines): Line 1 direct confident answer, Line 2 short reason from knowledge, Line 3 next-step question. Replaces the looser DIRECT_FACT/CLARIFY/RECOMMEND mode picker.
- TONE: confident, decisive, no permission-asking ("should I check…"), no "Based on the provided context", no robotic refusals. Always ends with one next-step question.
- STRICT MODE softened to "hard facts (price/PV/bonus%/dose) must appear in context — but related benefits MUST be used to answer". Prevents over-refusal in product/wellness queries.

Honest-fallback copy (only fires when chunks.length===0 AND raw_text fallback also empty):
- Old: "I don't have a verified answer for that yet 🤔" (defeated tone)
- New: "Hmm, I don't have that one in our approved info just yet." + "Want me to share our product menu, or connect you with Vanto directly?"

PRESERVED FROM v6.1 (unchanged):
- Hybrid retrieval: chunk_search → raw_text_fallback → honest fallback ladder
- rawTextFallback() pulling full doc bodies via keyword/tag match
- loadDocsByKeywords() with title.ilike + tags overlap
- Helper-file penalty -10 (soft demotion, still surfaceable)
- TOP_K = 12 for strict-likely queries
- loadConversationMemory() — last 6 turns injected as chat history
- STRICT_MIN_RELEVANCE = 0.05 gate (bypassed when raw_text path produces chunks)
- Deterministic NRM-style price regex extraction (extractDirectPricingAnswer)
- Static greeting + handoff + menu_1/menu_2 paths
- Diagnostics: retrieval_path, raw_text_fallback_attempted, forced_doc_titles, memory_turns, top_k_used, answer_source, source_files, top_chunk_title, top_relevance, effective_mode, fallback_reason
- Model: google/gemini-2.5-pro, temperature 0.6

Source-priority order (factual answers, v6.2 — same as v6.1):
1. Static greeting / handoff
2. Deterministic price extract from approved doc
3. AI grounded on chunk-search hits (now with mandatory inference)
4. AI grounded on raw_text fallback
5. Honest fallback — only when chunks AND raw_text both empty
