# Per-User Facebook Page Connection

Goal: any user (e.g. Matilda) connects their own Facebook Page from Settings, instead of the whole app running off one hardcoded admin Page token.

## What changes

**1. Database (new table + tagging)**
- New `facebook_page_connections` table: `user_id`, `page_id`, `page_name`, `page_access_token`, `token_expires_at`, `status` (active/revoked/error), `connected_at`, `last_webhook_confirmed_at`, unique on `(user_id, page_id)`.
- RLS: a user can read/update/delete only their own rows; the token column is never exposed to the browser (client reads go through a view/column selection that omits it). Only the service role writes tokens during OAuth callback.
- `fb_comments` already stores `page_id`. Add `page_id` to `conversations` (nullable) so Messenger threads can be attributed to the owning Page.

**2. OAuth connect flow**
- Settings gets a "Facebook Page" card: Not connected → "Connect Facebook Page"; connected → Page name, connected date, Disconnect.
- Connect redirects to Facebook's OAuth dialog with `state` = signed value tied to the logged-in user (not a raw user id, so the callback can't be forged).
- New edge function `facebook-oauth-callback`: validate state → code→short-lived token→long-lived token → `/me/accounts` → store each Page + its Page Access Token → subscribe the Page to `feed`, `messages`, `messaging_postbacks` → redirect back to Settings with success/error.
- Disconnect sets `status='revoked'` and unsubscribes the Page.

**3. Multi-tenant ingest + reply**
- `fb-ingest` / `fb-messenger-inbound`: resolve `page_id` from the incoming payload, look up the owning connection, and tag ingested comments/conversations/contacts with that `page_id` (and owner). Unknown Page ids fall back to today's admin behaviour so nothing currently working breaks.
- `fb-reply-comment` and the Messenger send path in `send-message`: derive `page_id` from the comment/conversation being replied to and use that Page's stored token. Falls back to the existing env token when the Page has no connection row (keeps the admin account working exactly as now).

**4. Facebook Inbox filtering**
- The inbox panel only shows rows whose `page_id` belongs to the current user's active connections; the admin/legacy Page stays visible to admins so nothing disappears.

## Notes and limits
- `pages_messaging` and `pages_manage_engagement` are still gated per Page by Meta: a newly connected Page can only reply once that Facebook account is a Tester on the app, or after App Review goes live. Connecting will work; replying stays blocked until then — same gate the admin account is in now.
- No existing campaign, WhatsApp, or contact logic is touched.

## Rollback
Single migration (drop table + drop `conversations.page_id`); edge functions keep their env-token fallback path, so reverting the frontend alone restores current behaviour.
