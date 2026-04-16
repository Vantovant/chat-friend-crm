---
name: Group Campaigns Maytapi Migration
description: Group Campaigns now use Maytapi REST API instead of Chrome Extension DOM autoposter
type: feature
---
Group Campaigns engine migrated from Chrome Extension 9-stage DOM autoposter to Maytapi REST API.

Architecture:
- Twilio remains for 1-on-1 Inbox messaging (unchanged)
- Maytapi handles all group campaign outbound via 3 edge functions:
  - `maytapi-send-group`: processes `scheduled_group_posts` queue, sends via Maytapi sendMessage API
  - `maytapi-webhook-inbound`: receives Maytapi delivery callbacks, updates post status
  - `maytapi-health`: checks Maytapi phone connection status for UI indicator

Secrets: MAYTAPI_PRODUCT_ID, MAYTAPI_PHONE_ID, MAYTAPI_API_TOKEN

DB changes: `scheduled_group_posts` gained `provider_message_id` and `target_group_jid` columns.

UI: Chrome heartbeat removed. Maytapi health indicator added. "Send Due" button triggers manual processing. Status flow: pending → executing → sent/delivered/failed.

Webhook URL to register in Maytapi dashboard:
`https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/maytapi-webhook-inbound`
