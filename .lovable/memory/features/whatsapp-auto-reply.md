---
name: WhatsApp Auto-Reply v5.1
description: Stabilized auto-reply with provider-aware routing, 15s cooldown, Maytapi inbound handling
type: feature
---
v5.1 Inbox Stabilization (2026-04-23):
- Cooldown reduced 120s → 15s; daily limit 20 → 40 per conversation (allow natural follow-ups)
- maytapi-webhook-inbound now handles BOTH ack callbacks (group posts, untouched) AND inbound 1-on-1 messages (NEW branch)
  - Inbound branch: find/create contact by phone_normalized, find/create conversation, insert inbound message, trigger whatsapp-auto-reply
- send-message detects preferred provider from most recent inbound message: maytapi inbound → reply via maytapi-send-direct; twilio inbound → reply via Twilio (default)
- Outbound message row stores provider field correctly so subsequent replies stay on the same channel
- Group Campaigns flow untouched (ack handling preserved)

Earlier v5.0 design retained:
- 3-part structure: Direct Answer → Smart Next Steps → Human Contact Footer
- AI-first freeform answers; product alias recognition (NRM, HTR, ICE, PWR…)
- Topic-to-link routing via "Topics and Links" knowledge doc
- Intents: menu 1/2/3, CALL ME, WHATSAPP ME, I'M AVAILABLE AT [time]
- PRODUCT_LINKS map for APLGO product guide URLs
