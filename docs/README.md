# Suite Bridge — GetWell Hub Spoke Bundle

**Spoke:** GetWell Hub  
**Domain:** getwellhub.dev  
**APP_KEY:** `getwell_hub`  
**Hub:** VantoOS (vantoos.com)  
**Phase:** A (signed ping/pong only)

---

## Install (5 minutes)

### 1. Create the edge function
Path in this project: `supabase/functions/suite-bridge-spoke/index.ts`  
Paste the contents of **`suite-bridge-spoke.ts`** from this bundle. `APP_KEY` is already set to `getwell_hub` — do not change it.

### 2. Register in `supabase/config.toml`
Append:
```toml
[functions.suite-bridge-spoke]
verify_jwt = false
```

### 3. Add the shared secret
In this Lovable/Supabase project, add a runtime secret:

- **Name:** `SUITE_BRIDGE_SECRET`
- **Value:** the exact same random string that was pasted into VantoOS under `SUITE_BRIDGE_SECRET_GETWELL_HUB`.

> Same value both sides. If you don't have it, generate one with `openssl rand -hex 32`, paste it here, and update the VantoOS slot to match.

### 4. Deploy
Lovable auto-deploys edge functions on save. Confirm the function `suite-bridge-spoke` shows as Active.

---

## Verify from VantoOS

From VantoOS, the hub will call:
```
POST https://<this-spoke-supabase>/functions/v1/suite-bridge-spoke
```
with body `{ "kind": "ping" }` and HMAC-signed headers.

**Expected spoke response:**
```json
{ "ok": true, "app": "getwell_hub", "kind": "pong", "ts": <epoch_ms> }
```

---

## Errors and fixes

| Error                     | Fix                                                                       |
|---------------------------|---------------------------------------------------------------------------|
| `spoke_missing_secret`    | Add `SUITE_BRIDGE_SECRET` in this project.                                |
| `bad_signature`           | Secret on this spoke ≠ secret VantoOS holds. Re-paste identical value.    |
| `unexpected_sender`       | Only VantoOS may call this endpoint. Reject other origins.                |
| `stale_timestamp`         | Clock drift > 5 min. Very rare on Supabase — retry.                       |

---

## Do NOT build yet (Phase B+)
No AI proposals, no campaign handlers, no writes triggered by hub. This bundle is bridge-only. Wait for the "GO PHASE B" instruction from VantoOS before extending `index.ts`.

— Part of the **VantoOS Suite**. © VantoOS.
