# Group Campaigns Module — Detailed Specification

> Module: Group Campaigns  
> Files: `src/components/vanto/GroupCampaignsModule.tsx` (528 lines), `content.js` (auto-poster), `background.js` (polling engine)  
> Last Updated: 2026-03-16

---

## 1. Purpose

Schedule and manage bulk message campaigns to WhatsApp groups. The Chrome Extension auto-poster polls for due campaigns and executes them by simulating UI actions on WhatsApp Web via a 9-stage execution pipeline.

---

## 2. Architecture

| Layer | Detail |
|-------|--------|
| Component | `GroupCampaignsModule` (528 lines) |
| Tables | `whatsapp_groups`, `scheduled_group_posts`, `integration_settings` |
| Realtime | Channel `group-posts-realtime` on `scheduled_group_posts` |
| Chrome Extension | Polls every 60s via `chrome.alarms`; executes via 9-stage content script pipeline |
| RLS | Strict user-scoped: `user_id = auth.uid()` on both tables |
| Health Monitoring | Heartbeat via `integration_settings` key `chrome_extension_heartbeat`, polled every 15s from UI |

---

## 3. Database Schema

### `whatsapp_groups` Table
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | PK |
| `user_id` | uuid | — | FK → profiles.id |
| `group_name` | text | — | Captured from WhatsApp Web |
| `group_jid` | text | null | Stable WhatsApp group JID (`…@g.us`) |
| `created_at` | timestamptz | `now()` | Auto |

**RLS Policies:**
| Policy | Command | Rule |
|--------|---------|------|
| Users can select own | SELECT | `auth.uid() = user_id` |
| Users can insert own | INSERT | `auth.uid() = user_id` |
| Users can update own | UPDATE | `auth.uid() = user_id` |
| Users can delete own | DELETE | `auth.uid() = user_id` |

### `scheduled_group_posts` Table
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | PK |
| `user_id` | uuid | — | FK → profiles.id |
| `target_group_name` | text | — | Must match a captured group |
| `message_content` | text | — | Message body |
| `image_url` | text | null | Future: image attachments |
| `scheduled_at` | timestamptz | — | When to send |
| `status` | text | `'pending'` | `pending` → `executing` → `sent` or `failed` |
| `failure_reason` | text | null | Stage-specific error message on failure |
| `last_attempt_at` | timestamptz | null | Timestamp of last execution attempt |
| `attempt_count` | integer | `0` | Number of execution attempts |
| `created_at` | timestamptz | `now()` | Auto |

**RLS Policies:** Same pattern as `whatsapp_groups` — all CRUD scoped to `auth.uid() = user_id`.

---

## 4. Extension Health Panel

The UI displays real-time extension health status in a prominent card:

| State | Indicator | Color |
|-------|-----------|-------|
| Connected | `Wifi` icon + "Chrome Extension Connected" | Emerald |
| Disconnected | `WifiOff` icon + "Chrome Extension Not Detected" | Amber |
| WhatsApp Ready | "WhatsApp Web Ready" | Emerald |
| WhatsApp Not Ready | "WhatsApp Web Not Ready" | Amber |

**Detection Logic:**
- Queries `integration_settings` where `key = 'chrome_extension_heartbeat'`
- Parses `{ last_seen, whatsapp_ready }` from value
- Connected = `last_seen` within last 5 minutes
- Polled every 15 seconds

---

## 5. Campaign Scheduler Form

### 5.1 Modes

| Mode | Toggle | Description |
|------|--------|-------------|
| **Single Post** | Switch OFF (default) | Schedule one post at a specific date & time |
| **Smart Bulk Campaign** | Switch ON | Schedule across a date range with multiple time slots |

### 5.2 Single Post Fields
| Field | Type | Source | Validation |
|-------|------|--------|------------|
| Target Group | `<Select>` dropdown | `whatsapp_groups` table | Required |
| Date | Calendar popover | User input | Required, must be today or future |
| Time | `<Input type="time">` | User input, default `09:00` | Required |
| Message Content | `<Textarea>` (4 rows) | User input | Required, non-empty |

### 5.3 Bulk Campaign Fields
| Field | Type | Source | Validation |
|-------|------|--------|------------|
| Target Group | `<Select>` dropdown | `whatsapp_groups` table | Required |
| Date Range | Calendar range popover (2 months) | User input | Required, from & to must be set |
| Posting Times | Checkboxes | Predefined slots | At least one selected |
| Master Script | `<Textarea>` (6 rows) | User input | Required, non-empty |

**Time Slots:**
| Slot ID | Label | Hour | Minute |
|---------|-------|------|--------|
| `morning` | Morning (08:00) | 8 | 0 |
| `midday` | Mid-day (13:00) | 13 | 0 |
| `evening` | Evening (18:00) | 18 | 0 |

### 5.4 Empty State
When no groups are captured:
- Shows Users icon (32px, muted)
- Message: "No groups captured yet"
- Instructions: "Open WhatsApp Web with the Vanto Chrome Extension active, then click on a group chat to capture it."

### 5.5 Submit Flow
1. Validate all fields filled
2. Validate dates/times are in the future
3. Get authenticated user via `supabase.auth.getUser()`
4. For bulk: generate one row per day × time slot, skip past slots
5. Insert to `scheduled_group_posts` with `status: 'pending'`
6. Clear form on success
7. Show toast with count of scheduled posts

---

## 6. Campaigns Dashboard

### 6.1 Table Structure
| Column | Content | Width |
|--------|---------|-------|
| Group | `target_group_name` | Auto |
| Message | Truncated preview | max 200px |
| Scheduled | `format(scheduled_at, 'MMM d, HH:mm')` | Nowrap |
| Status | Color-coded badge + failure detail panel | Auto |
| Actions | Retry + Delete buttons | 100px |

### 6.2 Status Badges
| Status | Style |
|--------|-------|
| `pending` | Amber background, amber text |
| `sent` | Emerald background, emerald text |
| `failed` | Red background, red text |

### 6.3 Failure Detail Panel
When `status === 'failed'` and `failure_reason` is present:
- Red-tinted card below badge
- `AlertTriangle` icon
- `failure_reason` text (word-wrapped, preserves whitespace)
- Attempt count + last attempt timestamp

### 6.4 Actions
| Action | Availability | Behavior |
|--------|-------------|----------|
| **Retry** | `failed` posts only | Resets `status` to `pending`, clears `failure_reason` and `last_attempt_at` |
| **Delete** | `pending` or `failed` posts | Deletes from `scheduled_group_posts` |

---

## 7. Chrome Extension Execution Flow

### 7.1 Group Capture (content.js)
1. Extension detects `@g.us` in chat `data-id` attributes
2. Extracts group name from chat header via selector cascade
3. Sends `VANTO_UPSERT_GROUP` message to background.js
4. background.js upserts to `whatsapp_groups` table
5. Sidebar displays group banner with "Save Group" button

### 7.2 Polling Engine (background.js)
```
chrome.alarms.create('vanto-group-poll', { periodInMinutes: 1 })

On alarm:
  1. refreshTokenIfNeeded()
  2. Fetch scheduled_group_posts WHERE status='pending' AND scheduled_at <= NOW()
  3. For each due post:
     a. Find WhatsApp Web tab (3 retries, 2s delay)
     b. ensureContentScriptInjected(tabId)
     c. Send VANTO_EXECUTE_GROUP_POST to content script
     d. Race with 90s timeout
     e. Update status to 'sent' or 'failed' with failure_reason
```

### 7.3 9-Stage Execution Engine (content.js)

| # | Stage | Timeout | Operation |
|---|-------|---------|-----------|
| 1 | `open_search` | 10s | Find/click search input |
| 2 | `search_group` | 15s | Type group name, wait 1.5s for results |
| 3 | `select_group` | 8s | Match: exact → partial → first result |
| 4 | `wait_chat_open` | 12s | Poll for `#main header` |
| 5 | `find_input` | 10s | Locate message compose box |
| 6 | `inject_message` | 8s | Focus, clear, `execCommand('insertText')` + InputEvent |
| 7 | `find_send_button` | 10s | Locate send button |
| 8 | `click_send` | 8s | Click send |
| 9 | `confirm_sent` | 12s | Verify input cleared |

**Total safety timeout:** 90 seconds

### 7.4 Permissions
Manifest V3 permissions required:
- `alarms` — for 1-minute polling
- `tabs` — for tab detection
- `scripting` — for programmatic content script injection
- Host permission: `https://web.whatsapp.com/*`

---

## 8. Realtime Updates

Channel: `group-posts-realtime`
- Listens for all events (`*`) on `scheduled_group_posts`
- Triggers full data refetch on any change
- Ensures dashboard reflects Chrome Extension status updates instantly

---

## 9. Data Flow Diagram

```
┌─────────────────┐     Click group     ┌──────────────────┐
│  WhatsApp Web   │ ──────────────────▶ │  content.js      │
│  (Browser Tab)  │                     │  (Chrome Ext)    │
└─────────────────┘                     └────────┬─────────┘
                                                 │ VANTO_UPSERT_GROUP
                                        ┌────────▼─────────┐
                                        │  background.js   │
                                        │  (Chrome Ext)    │
                                        └────────┬─────────┘
                                                 │ REST API POST
                                        ┌────────▼─────────┐
                                        │  whatsapp_groups  │
                                        │  (Database)      │
                                        └──────────────────┘

┌─────────────────┐    Schedule post    ┌──────────────────┐
│  Vanto CRM UI   │ ──────────────────▶ │ scheduled_group  │
│  (React App)    │                     │ _posts (Database)│
└─────────────────┘                     └────────┬─────────┘
                                                 │ Poll every 60s
                                        ┌────────▼─────────┐
                                        │  background.js   │
                                        │  (Polls DB)      │
                                        └────────┬─────────┘
                                                 │ ensureContentScript
                                                 │ + VANTO_EXECUTE_GROUP_POST
                                        ┌────────▼─────────┐
                                        │  content.js      │
                                        │  9-Stage Pipeline │
                                        └────────┬─────────┘
                                                 │ Simulates WhatsApp UI
                                        ┌────────▼─────────┐
                                        │  WhatsApp Web    │
                                        │  (Send message)  │
                                        └────────┬─────────┘
                                                 │ Result: success/failure
                                        ┌────────▼─────────┐
                                        │  background.js   │
                                        │  PATCH status    │
                                        └────────┬─────────┘
                                                 │
                                        ┌────────▼─────────┐
                                        │ scheduled_group  │
                                        │ _posts → sent/   │
                                        │ failed           │
                                        └──────────────────┘

┌─────────────────┐    Heartbeat (1min) ┌──────────────────┐
│  background.js  │ ──────────────────▶ │ integration_     │
│  (Chrome Ext)   │                     │ settings         │
└─────────────────┘                     └────────┬─────────┘
                                                 │ Polled every 15s
                                        ┌────────▼─────────┐
                                        │  CRM UI          │
                                        │  Health Panel    │
                                        └──────────────────┘
```

---

*End of Group Campaigns Module Specification*
