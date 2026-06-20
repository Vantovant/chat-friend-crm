---
name: Proof URL preview suspended
description: Distributor proof-page link preview (vanto-zazi-bloom / chat.onlinecourseformlm.com/proof) is suspended in outbound messages — identity carried by intro line instead
type: constraint
---
As of 2026-06-20, do NOT prepend the distributor_proof_url at the top of outbound WhatsApp messages. The link-preview card was not rendering reliably for recipients.

Replacement: every wrapped outbound starts with an identity intro line:
"Hi, this is *Vanto from K12 Africa* — an accredited APLGO distributor."
For Twilio-channel first-touch, append the bridge line about Twilio campaign number / local SA number.

Applied in:
- supabase/functions/maytapi-send-direct/index.ts (buildTrustWrap)
- supabase/functions/whatsapp-auto-reply/index.ts (IDENTITY_INTRO, buildFirstTouch, product_info + price_no_context templates)

`integration_settings.distributor_proof_url` still exists but is no longer rendered. Do not re-introduce the proof URL on top of messages without explicit user approval. **Why:** preview card failed → looks broken to recipients.
