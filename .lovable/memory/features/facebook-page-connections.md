---
name: Per-user Facebook Page connections
description: Users connect their own FB Page via OAuth; ingest/reply resolve tokens per page_id with env fallback
type: feature
---
Table `facebook_page_connections` (user_id, page_id, page_name, page_access_token, status). Token column is not granted to `authenticated` — server-only.

Flow: Settings → Facebook Page card → `facebook-oauth-start` (HMAC-signed state) → Facebook dialog → `facebook-oauth-callback` (code → long-lived user token → /me/accounts → store Page tokens → subscribe feed,messages,messaging_postbacks) → redirect back with `?fb_connect=`.

`supabase/functions/_shared/fb-page-token.ts` → `resolvePageToken(svc, pageId)`: connected Page token first, else legacy env token derived from META_PAGE_ACCESS_TOKEN(_NEW). Used by fb-reply-comment, send-message (Messenger route), fb-messenger-inbound. `conversations.page_id` and `fb_comments.page_id` carry ownership; Facebook Inbox filters to the user's active Pages (admins see all).

Meta setup requirement: `{SUPABASE_URL}/functions/v1/facebook-oauth-callback` must be listed in the app's Valid OAuth Redirect URIs. Replies per Page still gated by pages_manage_engagement / pages_messaging (Tester role or App Review).
