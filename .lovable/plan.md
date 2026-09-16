# Facebook Page posting tools for Claude (MCP)

## (a) Token scope check — done, live against Facebook

Both stored Page tokens are valid, non-expiring Page tokens on app 949132717953322.

| Page | pages_manage_posts | Can post? |
|---|---|---|
| Get Well Africa (102068582816960) | Yes (granular, scoped to this page) | Yes |
| Matilda Wellness & APLGO (1012653741928888) | **No** | No — will fail with a permissions error |

Get Well Africa also carries business_management, pages_manage_engagement, pages_read_engagement, pages_read_user_content, pages_manage_metadata, pages_messaging, pages_show_list. Matilda's token has the same set **minus** pages_manage_posts and business_management.

## (b) Blockers

1. **Matilda's Page cannot post until reconnected.** The connect flow (`facebook-oauth-start`) never requests `pages_manage_posts` — Get Well Africa has it only because that token came from a different/earlier grant. Fix: add `pages_manage_posts` to the requested scopes (and to the Meta Business Login configuration, since `META_LOGIN_CONFIG_ID` overrides the code-side scope list), then have Matilda reconnect her Page from Settings.
2. **Page tokens are server-only.** The `page_access_token` column is not readable by `authenticated`, so the MCP tool cannot call Graph directly — it must go through an edge function using the service role, exactly like `reply_to_fb_comment` → `fb-reply-comment`.
3. **Scheduling window.** Facebook requires `scheduled_publish_time` to be 10 minutes–75 days ahead; validate before calling Graph so Claude gets a clear error rather than a Graph rejection.
4. **Image posts.** `image_url` must go to `/{page_id}/photos` (with `url` + `caption`), not `/feed`. Scheduled photo posts use the same `published=false` + `scheduled_publish_time` pattern.

## (c) Proposed approach

**New table `fb_outbound_posts`** — our record of every post attempted through the tool: `id`, `user_id`, `page_id`, `message`, `image_url`, `fb_post_id`, `status` (`scheduled` | `published` | `failed`), `scheduled_publish_time`, `published_at`, `graph_error` (jsonb), `created_at`. RLS: owner can read their own rows; admins read all; only the service role writes. Explicit GRANTs for `authenticated` (select) and `service_role` (all).

**New edge function `fb-create-post`** (service role, JWT validated in code):
- Verify the caller is authenticated, and that the target `page_id` is an active connection the caller owns (admins may use any active Page).
- Resolve the Page token via the existing `_shared/fb-page-token.ts` `resolvePageToken()`.
- Pre-flight the token's granular scopes via `debug_token`; if `pages_manage_posts` is absent, return a clear "reconnect this Page with posting permission" error **before** calling Graph.
- Post to `/{page_id}/feed` (or `/photos` when `image_url` is set), then write the result row.

**Tool 1 — `create_fb_post`** (`src/lib/mcp/tools/create-fb-post.ts`)
- Inputs: `page_id`, `message`, optional `scheduled_publish_time` (ISO 8601), optional `image_url`, optional `publish_now` (boolean).
- Safety gate, matching the `create_broadcast` draft pattern: if `scheduled_publish_time` is omitted **and** `publish_now` is not literally `true`, the tool refuses and returns an explanatory error — it never publishes by accident. The two paths are mutually exclusive; supplying both is an error.
- Returns `{ post_id, page_id, page_name, status, scheduled_publish_time }`.
- Annotations: `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true`.

**Tool 2 — `list_fb_posts`** (`src/lib/mcp/tools/list-fb-posts.ts`)
- Read-only, `supabaseForUser(ctx)` under RLS. Filters: `page_id`, `status`, `since`, `until`, `limit` (1–100, default 25).
- Reads `fb_outbound_posts` and merges organic posts from `fb_source_posts` (tagged `origin: "organic"` vs `"mcp"`), sorted newest-first by scheduled/published time, so "what's scheduled for the next few days" is one call.

**Registration:** both tools added to `src/lib/mcp/index.ts`, server version bumped, instructions extended with the `publish_now` rule and the per-Page posting-permission caveat. Legacy `mcp-bridge` and the Railway proxy are not touched.

## Open question

Do you want me to also add `pages_manage_posts` to the connect flow and ask Matilda to reconnect in this same change, or ship the tools first with Get Well Africa working and handle Matilda separately?
