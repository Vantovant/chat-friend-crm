# Group Guard — plan (starts in "log only")

## What you get
- Joins and leaves in your groups are picked up the moment they happen, not just every 15 minutes.
- An automatic guard for your 11 active groups:
  - **Country block:** anyone joining from +234 gets removed (unless you've allowed them).
  - **Flood/spam block:** anyone sending more than 5 messages in 60 seconds, the same message 3 times in 10 minutes, or group-invite links within 24 hours of joining gets removed. The guard then tries to delete their messages from the last 10 minutes and blocks them from rejoining.
- One WhatsApp alert to you for each incident, not one for every message.
- It starts in **log only** mode: it records "would have removed", removes nobody, and sends the alert worded "would have removed". You switch it to enforce when you're happy with it.
- Never touched: you, your own number, the excluded admin phones, your allowlist, and group admins.

## Before anything goes live
A check report showing whether your linked WhatsApp number is an admin in each of the 11 groups. It can only remove people and delete messages in groups where it is an admin. The report only tells you; it changes nothing.

## Technical details
- **Database (additive only):** new table `group_guard_actions` (group_jid, phone, reason, mode, action, removed_ok, deleted_count, raw, created_at). It gets a unique index on (group_jid, phone, 10-minute bucket) so each incident fires once. GRANTs to service_role only; RLS enabled, admin-only read through `is_admin_or_super_admin()`. Plus a blocklist in the same table (action = 'blocklisted').
- **Settings (data insert):** group_guard_mode=log_only, country_block_enabled=true, blocked_prefixes=+234, allowlist="", flood_max_msgs=5, flood_window_sec=60, dup_max=3.
- **maytapi-webhook-inbound (additive):**
  - Branch 0 also matches `message.type="info"` with subtype group/add, group/remove or group/leave (mapped to joined, removed or left).
  - If the participant is an @lid id (no phone), the raw id goes in raw_payload and phone checks are skipped.
  - A matching event already logged within 30 minutes (for example by the 15-minute poller) is skipped.
  - Group message logging to maytapi_messages stays exactly as it is now. The guard runs after logging, wrapped in try/catch, so it can never break inbound handling.
- **Maytapi calls:** getGroups/{jid} admins (cached 1 hour in memory and settings), `group/remove`, and delete via sendMessage.
- **Alert:** one WhatsApp message to zazi_group_admin_phone per incident, sent through maytapi-send-direct. It is excluded from the 30/day cap only if you say so; the default is to count it.
- **MCP (src/lib/mcp):** `get_group_guard_status` (read-only: settings, admin status per group, last 20 actions) and `set_group_guard_mode(mode)`. Version 1.11.0. Goes live when you click Publish.
- **Rollback:** set group_guard_mode=off, which stops the guard instantly. The table and settings are left in place and unused.
- **Test:** replay a sample join/flood payload to the webhook in log_only mode, then check the action row and the alert.
