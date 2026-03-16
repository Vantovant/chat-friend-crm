# Vanto CRM Chrome Extension v6.0 - LOVABLE Edition

## ⚠️ This Version Is For:

| Setting | Value |
|---------|-------|
| **Dashboard** | https://chat.onlinecourseformlm.com |
| **Supabase** | https://nqyyvqcmcyggvlcswkio.supabase.co (OLD) |
| **Anon Key** | YOUR_OLD_SUPABASE_ANON_KEY_HERE |

## Configuration Required

Before using this extension, you MUST add your OLD Supabase Anon Key:

1. Go to https://supabase.com/dashboard
2. Select project: **nqyyvqcmcyggvlcswkio**
3. Go to **Settings → API**
4. Copy the **anon public** key
5. Open `background.js` and find line 8:
   ```javascript
   const SUPABASE_ANON_KEY = 'YOUR_OLD_SUPABASE_ANON_KEY_HERE';
   ```
6. Replace with your actual key

## Installation

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this folder
5. Navigate to https://web.whatsapp.com
6. Click the Vanto CRM extension icon → Log in

## What's New in v6.0

### Microstage Timeouts

| Stage | Old | New |
|-------|-----|-----|
| open_search | 5s | 10s |
| search_group | 8s | 15s |
| select_group | 5s | 8s |
| wait_chat_open | 8s | 12s |
| find_input | 5s | 10s |
| inject_message | 5s | 8s |
| find_send_button | 5s | 10s |
| click_send | 5s | 8s |
| confirm_sent | 8s | 12s |
| **Total** | **45s** | **90s** |

### Enhanced Logging

Each stage logs progress with execution IDs:
```
[EXEC 1] Stage: open_search - START
[EXEC 1] Stage: open_search - SUCCESS
[EXEC 1] Stage: search_group - START
[EXEC 1] FAILED at stage: find_input
```

## Troubleshooting

Open Chrome DevTools (F12) → Console tab and look for:
- `[VANTO BG (Lovable)]` - Background worker logs
- `[VANTO CS (Lovable)]` - Content script logs
- `[VANTO CS ERROR (Lovable)]` - Errors with details

## Support

- Dashboard: https://chat.onlinecourseformlm.com
- Lovable App: https://chat-friend-crm.lovable.app
