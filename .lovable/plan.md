# Facebook Multi-Tenant — Scoping & Estimate (no code yet)

Both parts read and understood: Part 1 (OAuth "Can't load URL"), Part 2 (multi-tenant ingestion). Nothing will be implemented, migrated, or deployed until you give explicit go-ahead after this morning's campaign is safely underway.

## URGENT finding — comment ingestion is broken right now (before the ad launches)

Your item 3 is a real, live bug, not a misread and not dead code.

- `supabase/functions/fb-ingest/index.ts` line 242: `await upsertComment(supabase, v, eventPageId)`. `eventPageId` is declared nowhere in that file (only in `fb-messenger-inbound`, a different function).
- It was introduced yesterday, 18 Aug 2026 18:13 UTC (commit 55e384f, part of the multi-tenant groundwork) and is deployed.
- At runtime this throws a ReferenceError the moment a comment event arrives. It is inside the outer try/catch, so the webhook still answers Meta (no retries, no visible alarm), but the comment is silently dropped — and because the throw happens mid-loop, any remaining changes in the same payload are dropped too.
- Data agrees: the newest row in `fb_comments` is 18 Aug 12:33 UTC — nothing since the 18:13 deploy.
- Messenger DMs are unaffected: they are forwarded to `fb-messenger-inbound` earlier in the request, and that function is correct.

Fix is one line (derive the page id from `entry.id`, which is already in the loop scope). ~10 minutes including a redeploy and a live comment test. This is not part of the multi-tenant work and I recommend doing it before or alongside the campaign — say the word and it's the only thing I touch.

## Corrections to the spec's assumptions about the current codebase

- 2.1 partially already done: `fb_comments.page_id` exists and is populated on all 8 rows; `conversations.page_id` exists (2 rows populated). No new column is strictly needed for filtering — ownership can be derived by joining `page_id` to `facebook_page_connections`. A denormalised `owner_user_id` is still worth adding for query simplicity and for rows whose Page has no connection row, but the spec overstates the schema gap.
- 2.5 already done: `fb-reply-comment` and the Messenger path in `send-message` already resolve the per-Page token via `_shared/fb-page-token.ts` (`resolvePageToken`), with env-token fallback for Vanto's Page. No work expected here beyond a regression test.
- 2.2 auto-subscribe already done: `facebook-oauth-callback` already calls `POST /{page-id}/subscribed_apps` with the Page's own token after storing the connection.
- 2.3 partially done: `fb-messenger-inbound` already routes by `entry.id` and resolves owner/token per Page. `fb-ingest` (comments + post enrichment) is the one that is still single-Page hardcoded.
- `facebook_page_connections` has zero rows — correct, so today every path is on the env fallback, which is exactly why Vanto's Page is low-risk during the change.
- Risk the spec doesn't call out: filtering the Facebook Inbox by owner is the one change that can make existing data disappear from a user's view. Backfill must run in the same migration as the filter going live, and admins should keep an unfiltered view.
- Part 1 is likely Meta-side, not code-side. `facebook-oauth-start` builds `redirect_uri` from `SUPABASE_URL` at request time (no caching), and the callback uses the identical string — so a byte-mismatch is unlikely. The remaining candidates are: Facebook Login for Business requires a Business login *configuration* (a config id passed as `config_id`, not plain `scope`), and unverified Business Manager. I can't change Meta dashboard settings from here; that part is investigation plus instructions for you.

## Estimates

- Hotfix `eventPageId`: 10 min, isolated, no schema change. Recommended first.
- Part 1 (OAuth fix): 1–2 h of my time to instrument the start function, log the exact dialog URL, and test a plain-Login config. Realistically half a day elapsed, because resolution may depend on a Meta-side setting or Business verification only you can action.
- Part 2 (multi-tenant ingestion): 3–5 h implementation across one migration (owner_user_id + backfill to Vanto), `fb-ingest` routing, inbox filtering, plus regression checks after each step. Split into three deploys so each is separately reversible; the inbox filter goes last.

Part 1 does block end-to-end testing of Part 2, but not its implementation — Part 2 can be built and verified against Vanto's Page while Part 1 is unblocked with Meta.

## Sequencing I propose

1. (Now, if you approve) one-line `eventPageId` hotfix so the ad campaign's comments actually land.
2. Campaign settles → Part 1 investigation.
3. Part 2 in three reversible deploys: schema + backfill → `fb-ingest` routing → inbox filter.
