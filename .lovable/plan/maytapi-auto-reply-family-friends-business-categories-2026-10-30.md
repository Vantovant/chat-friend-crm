# Maytapi auto-reply + Family/Friends/Business categories

Context loaded. Here's the plan. Nothing is built until you approve.

## 1. Maytapi auto-reply (backend)
- In `maytapi-webhook-inbound`, 1:1 inbound branch only (groups and Group Guard untouched): after the message is logged, call the existing `whatsapp-auto-reply` with `channel: "maytapi"`. No second bot.
- `whatsapp-auto-reply`: add an `isMaytapiChannel` path that reuses the trainer-replies and knowledge logic, then sends through `maytapi-send-direct` (which already handles the daily cap, freeze switch and link previews).
- Prospect reply rules are enforced by a shared post-processor (`_shared/prospect-reply-rules.ts`):
  - puts https://getwellafrica.com/get-advice on the first line
  - removes every heart emoji (all colours)
  - keeps at most one supplement disclaimer, and drops it if one was sent to that contact in the last 7 days
  - Twilio replies are unchanged unless you ask for it.

## 2. Gate: never reply to the wrong people
Checks run in this order. If any check fails, the bot stays silent and the message gets an inbox flag.
1. Kill switch `maytapi_auto_reply_enabled` (default **off**) and mode `log_only` | `live` (default `log_only` so you can review first).
2. The person messaged first: we have never sent them anything, or their message is the newest in the chat. No reply if Vanto sent a personal 1:1 message in the last 24h.
3. Contact category is new, `prospect` or `unclassified`. Family, friend, business, customer, distributor, downline, a protected manual tag, or do_not_contact means silence.
4. An AI intent check reuses the `contact-intent-tag` / `lead-intent-classify` model, with phone and email redacted. It needs intent in {products, prices, joining, health_support} with confidence ≥ 0.80, and must not be personal or business chat. If unsure, it stays silent.
5. Caps: Maytapi daily cap, `outbound_frozen`, a limit of one auto-reply per contact per 24h, and the excluded-phones list (+234 and the owner numbers).

## 3. New categories: Family, Friends, Business
- Reuse the existing contact category column (added for Soundtech) and add the values `family`, `friend` and `business`. Data is not changed.
- Call Sheet: `call_list_cards` excludes these contacts. They show in "Not on the sheet" with the reason "Belongs in VantoOS". Phase 3 follow-ups (`phase3-detect` / `phase3-tick`), prospect-invite and nurture flows skip them too.
- UI: a category selector on the contact panel, and a "Belongs in VantoOS" badge plus a filter in Contacts.
- MCP: `update_contact` gets an optional `category` (family | friend | business | prospect | service | personal). Version bumps to v1.17.0. The tool never touches consent or do_not_contact.
- **VantoOS sync (proposal only, not built):** add `belongs_in_vantoos=true` to the existing `hub_outbox` / `enqueue_hub_contact_sync` payload. VantoOS (project 4b19e05a…) moves them to its Google Contacts-backed record keyed by phone. Hub keeps a read-only stub and drops them from prospecting. This needs a matching change on the VantoOS side, which I'll draft separately if you want it.

## 4. Safety and review log
- New table `maytapi_auto_reply_log` (owner RLS): contact, inbound text (redacted), intent, confidence, decision (`sent` | `skipped_<reason>` | `log_only`), reply body, provider message id, and time.
- New inbox flag "Needs your reply (bot stayed silent)", stored in that same log.
- New review page under Reports: "Maytapi auto-replies".
- New MCP read tool `list_maytapi_auto_replies`.
- No test messages are sent. You switch it to `live` when you're ready.

## Files I'll touch
**Backend functions**
- `supabase/functions/maytapi-webhook-inbound/index.ts` (1:1 hook only)
- `supabase/functions/whatsapp-auto-reply/index.ts` (Maytapi path and gate)
- `supabase/functions/_shared/prospect-reply-rules.ts` (new)
- `supabase/functions/_shared/maytapi-autoreply-gate.ts` (new)
- `supabase/functions/phase3-detect/index.ts`, `phase3-tick/index.ts` (category skip)
- `supabase/functions/maytapi-prospect-invite-tick/index.ts` (category skip)
- `maytapi-send-direct` is read only, with no change unless a source tag is needed

**Database (one migration)**
- category values, the `maytapi_auto_reply_log` table with grants and RLS, settings rows, the `call_list_cards` view update, and the outbox payload flag

**Frontend**
- `src/components/vanto/reports/CallSheet.tsx`
- `src/components/vanto/ReportsModule.tsx` (+ new `reports/MaytapiAutoReplyLog.tsx`)
- the contact detail and Contacts list components (category selector and badge)

**MCP**
- `src/lib/mcp/tools/update-contact.ts`, new `src/lib/mcp/tools/list-maytapi-auto-replies.ts`, `src/lib/mcp/index.ts` (v1.17.0), then manifest extraction and Publish

## Not touched
Twilio bot behaviour, groups and Group Guard, the dispatcher, Facebook, sign-and-win, reactivation, and the older bridge connector.

## Rollback
Set `maytapi_auto_reply_enabled=false`. That instantly restores today's behaviour. The category values and log table are additive.

## Open questions
1. Should Twilio replies also get the new reply rules, or only Maytapi?
2. Start in `log_only` for a few days, or go `live` straight away?
3. Should customer, distributor and downline also get the "Belongs in VantoOS" flag, or only Family, Friends and Business?
