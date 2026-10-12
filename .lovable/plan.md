# Isolate Vanto and Matilda accounts (Facebook Page + website)

## What I found
- **Facebook connections are already stored per person.** Matilda: "Matilda Wellness & APLGO" (page 1012653741928888, active). Vanto: Get Well Africa (102068582816960, active). Nothing to re-attach.
- **The mixing comes from built-in defaults.** The Facebook helper falls back to Get Well Africa (102068582816960) and Vanto's env token whenever a page isn't given. `fb-ingest`, `fb-reply-comment`, `fb-messenger-inbound`, `fb-create-post`, `fb-verify-subscription` and the MCP `create_fb_post` all default to that page id.
- **No "my website" setting exists for anyone.** getwellafrica.com is written into 20+ places: message links (UTM tagging, product catalogue, welcome bundle, auto-reply, copilot, cadence, recovery drafts, nurture, reactivation). So every user's links point to Vanto's site.
- **integration_settings has no owner column.** Every setting is global and shared.

## Plan
1. **Database (additive only, nothing deleted)**
   - New `user_brand_settings` table: user_id (owner), website_url, shop_url, facebook_page_url, brand_name. Users can only read and write their own row.
   - Fill in Vanto's row with today's values (getwellafrica.com, /shop, facebook.com/GetWellAfrica) so nothing changes for him. Matilda's row starts empty.
2. **Settings page:** new "My brand links" card (website, shop, Facebook Page link) next to the existing Facebook Page connect card. When nothing is set, it shows "Not set — add your link".
3. **Facebook helper:** `resolvePageToken` only uses the Get Well Africa env token when the page is 102068582816960. Any other page, or a missing page, comes back "not connected". Callers pass the page that belongs to the calling user or the row being worked on. Functions that serve one user (create post, verify subscription) look up that user's own active connection, with no default.
4. **Links in messages:** a shared `getBrandLinks(svc, userId)` gives the sending user's own website and shop. When the user has none set, product links are left out of the message; Vanto's site is never used for them. Automations that run as Vanto keep his values.
5. **MCP tools:** `create_fb_post`, `list_fb_posts` and `list_fb_comments` use `supabaseForUser(ctx)` and the caller's own connections. Any page_id the caller doesn't own is refused. The default page id is removed.
6. **RLS audit:** check the owner column and policies on contacts, conversations, messages, fb_comments, fb_source_posts, fb_generated_posts, fb_outbound_posts, scheduled_group_posts, plan_tasks/reminders/meetings/notes, and integration_settings. I'll report the gaps, and fix the ones that only need a policy change.
   - Flag first: `fb_source_posts`, `fb_comments` and `integration_settings` have no owner column today. I'll add a nullable `owner_user_id` and fill it in from page_id or Vanto. I won't make any column required in this change.
   - Your team's admin role still sees everything by design (VantoOS is the CEO layer). Tell me if Matilda should not be an admin.

## Not touched
Vanto's connection, token, settings, cron jobs, Group Guard, sign-and-win and the sending paths, apart from adding the brand-links lookup.

## Rollback
Drop the new table and columns. The helper change goes back to a single line.

## Technical details
- Files: `_shared/fb-page-token.ts`, new `_shared/brand-links.ts`, `_shared/utm.ts` callers (utm.ts itself unchanged; the domain gets passed in from the caller instead), the fb-* functions listed above, `src/lib/mcp/tools/*fb*`, `src/lib/recovery-drafts.ts`, SettingsModule plus a new BrandLinksCard.
- Marketing pages (Suite, MarketingLayout) are Vanto's public site and stay as they are.
