# Part 1 Investigation — Facebook Connect "Can't load URL"

Investigation only. No code, config, or deploys changed.

## What I checked

1. Read `supabase/functions/facebook-oauth-start/index.ts` in full.
2. Probed the live Facebook dialog with this app's real App ID (949132717953322) and the
   exact redirect URI the function sends, plus two control URIs, and read the raw
   HTTP response headers from Facebook.

## Finding 1 — the app is a "Facebook Login for Business" app

Facebook's own 302 response to our authorization URL ends with:

```text
...&display=page&locale=sv_SE&pl_dbl=0&is_business_login=1
```

`is_business_login=1` is Facebook echoing back that this App ID is configured with
**Facebook Login for Business**, not classic Facebook Login. That is the key difference the
spec suspected, and it is now confirmed from Facebook's side rather than assumed.

For Login for Business, the authorization request must carry a **`config_id`** — the id of a
Business Login configuration created in the Meta App Dashboard (Facebook Login for Business →
Configurations). In that mode:

- `config_id` selects the permission set, the asset type (Pages), and the token type.
- The `scope` parameter is ignored (permissions come from the configuration).
- Requests without `config_id` are handled inconsistently and commonly dead-end on the
  "Can't load URL" / invalid-request screen after login.

## Finding 2 — how the URL is currently built

`facebook-oauth-start` builds:

```text
https://www.facebook.com/v19.0/dialog/oauth
  ?client_id=<META_APP_ID>
  &redirect_uri=https://<project>.supabase.co/functions/v1/facebook-oauth-callback
  &scope=pages_show_list,pages_read_engagement,pages_read_user_content,
         pages_manage_metadata,pages_manage_engagement,pages_messaging
  &response_type=code
  &state=<HMAC-signed>
```

So: correct endpoint host and path, correct `response_type`, signed `state` — but
**no `config_id`**, and it relies purely on `scope`. That matches a classic Facebook Login
app, not this one.

Note the API version: the request is pinned to `v19.0` while Facebook's response header
reports `facebook-api-version: v25.0`. Not the cause of the error, but worth aligning.

## What I could NOT confirm

Whether the redirect URI is present in **Valid OAuth Redirect URIs**. Facebook defers that
validation until after login — a deliberately invalid control URI
(`https://example.com/definitely-not-allowed`) produced the exact same 302 to `login.php` as
our real one, so an unauthenticated probe cannot distinguish them. Reading it requires either
the App Dashboard or an app-access-token read, and the earlier `fb-app-settings` attempt
showed writes are blocked by Error #10. So the redirect-URI allow-list remains a second
possible contributor and must be verified in the dashboard.

## Proposed fix (not implemented — awaiting approval)

1. **You (dashboard, no code):** In the Meta App Dashboard → Facebook Login for Business →
   Configurations, create (or open the existing) configuration with:
   - Access type: **Business** (Page assets)
   - Permissions: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`,
     `pages_manage_metadata`, `pages_manage_engagement`, `pages_messaging`
   - Token type: **User access token** (so `/me/accounts` still returns Page tokens, which is
     what `facebook-oauth-callback` already expects — no callback change needed)

   Then send me the **Configuration ID**.

2. **You (dashboard):** Confirm
   `https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/facebook-oauth-callback` is listed
   verbatim under Valid OAuth Redirect URIs.

3. **Me (one small change, on approval):** Add a `META_LOGIN_CONFIG_ID` secret and append
   `&config_id=<id>` to the dialog URL in `facebook-oauth-start`. Keep `scope` as a fallback
   for when the secret is absent, so nothing changes if the config id is not set. Optionally
   bump `v19.0` → `v23.0`.

   Blast radius: `facebook-oauth-start` only. `fb-ingest`, `fb_comments`, `messages`,
   `conversations`, and the live ad campaign are untouched.

4. **Verify:** run the connect flow end to end and confirm a row lands in
   `facebook_page_connections` with a Page name.

If step 1 shows there is no Business Login configuration and one cannot be created, the
alternative is switching the app's login product back to classic Facebook Login — a bigger,
riskier dashboard change I would not recommend while the ad campaign is live.
