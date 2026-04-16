---
name: WhatsApp Auto-Reply v5.0
description: One-shot AI-first auto-reply with 3-part structure, topic-to-link routing, pricing priority, and CALL ME/WHATSAPP ME intents
type: feature
---
v5.0 One-Shot Design:
- Every response follows 3-part structure: Direct Answer → Smart Next Steps → Human Contact Footer
- AI-first: freeform questions answered directly, no menu-first forcing
- Product alias recognition (NRM, HTR, ICE, PWR etc.) maps to pricing priority search
- Topic-to-link routing uses "Topics and Links" knowledge doc for dynamic URLs
- Topic categories: products, opportunity, compensation, wellness, general
- New intents: "CALL ME", "WHATSAPP ME", "I'M AVAILABLE AT [time]" → human handover
- Menu 1/2/3 kept as backward-compatible fallback only
- Rate limits: 2-min cooldown, 20/day per conversation
- Human contact footer always includes wa.me/27790831530, +27 79 083 1530, registration link
- PRODUCT_LINKS map contains all APLGO product guide URLs from Topics and Links doc
