---
name: WhatsApp Auto-Reply v5.2
description: Grounded auto-reply with deterministic menu routing, strict-mode min-relevance gate, verbatim pricing extraction
type: feature
---
v5.2 Grounding Hardening (2026-04-23):
- Menu 1/2 now load the canonical "APLGO Product Pricing Quick Reference (ZAR)" doc directly via title (loadPricingDocChunks) — no ts_rank guessing.
- Strict collections (products/compensation/orders) enforce STRICT_MIN_RELEVANCE = 0.05 gate. Below threshold → honest "couldn't verify" fallback, no bluffing.
- AI prompt strict-mode block tightened: forbids invented prices/PV/benefits, requires verbatim quoting, mandates "couldn't verify" phrasing on miss.
- extractDirectPricingAnswer regex fixed to match real chunk format `- NRM (Blood sugar balance): R433.13`. PV is now read from the COLLECTION header (e.g. `DAILY COLLECTION (20 PV each, ...)`) rather than the first PV match in chunk.
- Honest fallback path replaces NO_ANSWER_FALLBACK dump when retrieval fails — short, owns the gap, offers handoff.

v5.1 Inbox Stabilization (2026-04-23):
- Cooldown 120s → 15s, daily limit 20 → 40 (natural follow-up Q&A).
- maytapi-webhook-inbound handles both group ack callbacks AND inbound 1-on-1 messages (parser hardened: nested body / caption / conversation).
- send-message routes via the same provider as last inbound (maytapi vs twilio).
- maytapi-send-direct trims env vars (fixes "invalid instance ID").

v5.0 retained:
- 3-part response: Direct Answer → Smart Next Steps → Human Contact Footer.
- Product alias recognition (NRM, HTR, ICE, PWR…).
- Topic-to-link routing via "Topics and Links" doc.
- Intents: 1/2/3, CALL ME, WHATSAPP ME, I'M AVAILABLE AT [time].
- PRODUCT_LINKS map for APLGO product guide URLs.

Grounding routing rules:
- greeting → static GREETING_REPLY (no retrieval)
- menu_1 → load PRICING_DOC_TITLE chunks → strict AI summary
- menu_2 → load PRICING_DOC_TITLE chunks → strict AI benefits summary
- menu_3 / call_me / whatsapp_me / available_at → static handoff
- pricing q + detectedProduct → search products → extractDirectPricingAnswer (deterministic, no AI) → AI fallback
- compensation q → search compensation (strict) → AI grounded
- opportunity q → search opportunity + general (assisted) → AI grounded
- wellness/freeform → search products + general → AI grounded
- zero chunks OR (strict AND top_relevance < 0.05) → honest fallback + handoff
