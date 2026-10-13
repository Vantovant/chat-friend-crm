# Fully separate Matilda's Messenger inbox from Vanto's

## What is actually happening (checked live, 13 Oct)
- Matilda's team removal worked. Everything in her inbox (32 chats) comes from **her own** Facebook Page "Matilda Wellness & APLGO". None come from Get Well Africa.
- The mix-up is the **automatic replies**. Our bot answers people who message her Page as if it were Vanto: "Welcome to Get Well Africa — I'm Vanto", Vanto's WhatsApp link (wa.me/27790831530), the getwellafrica.com shop link, and the follow-up nudges ("Just checking in…"). So her inbox is full of Vanto's messages.
- It also works the other way: as super admin, Vanto can see and reply in her chats. One reply on 12 Oct, "Hi 🙏 It's Vanto…", was sent by Vanto's account inside one of her chats.

Category: backend (bot routing) + permissions/RLS.

## Fix
1. **Stop the bot on Pages Vanto doesn't own.** Messages to Matilda's Page still arrive in her inbox, but the welcome message, trainer replies, AI auto-replies and timed follow-ups no longer send anything there. She answers her own customers herself. Nothing changes on Get Well Africa.
2. **Hide her chats from Vanto's inbox.** Admin accounts only see chats that have no owner (all existing WhatsApp/Twilio chats) or that they own. Her 32 chats and those contacts disappear from Vanto's Inbox, Facebook Inbox and Contacts. Vanto's 960 chats stay visible.
3. **Block cross-account replies.** The send function refuses to send into a chat owned by another account, even for super admins.

Not touched: Matilda's Page connection, her data, Vanto's sending, Group Guard, WhatsApp groups, Twilio/Maytapi automations.

## Technical details
- `fb-messenger-inbound`: when `ownerUserId !== VANTO_USER_ID`, log the inbound message and skip calling whatsapp-auto-reply or trainer replies.
- `whatsapp-auto-reply`: early exit `skipped_foreign_page` when the conversation's `owner_user_id` is set and isn't the owner.
- `phase3-tick`: the pre-send gate skips with `skipped_foreign_owner` for those conversations; their open missed-inquiry cases close as `stopped / foreign_page_owner`.
- `send-message`: refuses with `foreign_owner` when `conversations.owner_user_id` is set and isn't the caller.
- Migration: new `SECURITY DEFINER` helper `public.is_foreign_owned_contact(contact_id)`. Admin SELECT/UPDATE/DELETE policies on conversations add `(owner_user_id IS NULL OR owner_user_id = auth.uid())`, messages get the same rule through their conversation, and admin contact policies add `NOT public.is_foreign_owned_contact(id)`. Agent policies stay as they are.
- Rollback: one migration that restores the previous policy text (saved before the change) and drops the helper; redeploy the four functions from the previous commit.
- Verify by reading the data as each user's role, and run phase3-tick once with no sends due.
