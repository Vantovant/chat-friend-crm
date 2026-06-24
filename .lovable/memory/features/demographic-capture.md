---
name: Demographic Capture (email / city / province)
description: Prospector demographic-capture flow across Maytapi + Twilio inbound — what is captured, where it lives, when Vanto asks
type: feature
---
Vanto now captures prospect demographics (email, city, province) automatically on every WhatsApp inbound (Maytapi + Twilio).

**Storage:** `contacts.email`, `contacts.city`, `contacts.province`, plus `contacts.demographics_asked_at` and `contacts.demographics_captured_at`. Indexed on city + province (partial, NOT NULL) for future demographic reports.

**Helper:** `supabase/functions/_shared/demographics.ts`
- `parseDemographics(text)` — regex + ZA province dictionary (Gauteng, Western Cape, KwaZulu-Natal, etc. including abbreviations like GP/KZN/WC when labelled).
- `extractAndSaveDemographics(svc, contactId, text)` — only fills empty fields; stamps `demographics_captured_at`.
- `maybeAppendDemographicAsk(svc, contactId, replyText)` — appends ONE polite ask line; stamps `demographics_asked_at` so we never ask twice.

**Wiring:** `supabase/functions/whatsapp-auto-reply/index.ts`
1. Extraction runs early (before the auto-reply mode check) so demographics are harvested even when auto-reply is OFF.
2. Ask is appended after the intent-invite block when the prospect signaled interest (`yes_interest`, `menu_1/2/3`, or any detected distributor/opportunity/training/sponsor intent) AND demographics are missing AND we haven't asked yet.

Auto-reply is invoked by BOTH `twilio-whatsapp-inbound` and `maytapi-webhook-inbound`, so wiring once in auto-reply covers both channels.

**Ask copy:** "<First name>, to make sure you receive the right info from GetWellAfrica, could you share your <missing fields>? (Just reply, e.g. 'Email: you@email.com, City: Pretoria, Province: Gauteng')"
