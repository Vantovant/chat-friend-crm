# Group Campaigns Module — Detailed Specification

> Module: Group Campaigns  
> File: `src/components/vanto/GroupCampaignsModule.tsx` (258 lines)  
> Last Updated: 2026-03-13

---

## 1. Purpose

Schedule and manage bulk message campaigns to WhatsApp groups. The Chrome Extension auto-poster polls for due campaigns and executes them by simulating UI actions on WhatsApp Web.

---

## 2. Architecture

| Layer | Detail |
|-------|--------|
| Component | `GroupCampaignsModule` |
| Tables | `whatsapp_groups`, `scheduled_group_posts` |
| Realtime | Channel `group-posts-realtime` on `scheduled_group_posts` |
| Chrome Extension | Polls every 60s via `chrome.alarms`; executes via content script |
| RLS | Strict user-scoped: `user_id = auth.uid()` on both tables |

---

## 3. Database Schema

### `whatsapp_groups` Table
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | PK |
| `user_id` | uuid | — | FK → profiles.id |
| `group_name` | text | — | Captured from WhatsApp Web |
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
| `status` | text | `'pending'` | `pending` → `sent` or `failed` |
| `created_at` | timestamptz | `now()` | Auto |

**RLS Policies:** Same pattern as `whatsapp_groups` — all CRUD scoped to `auth.uid() = user_id`.

---

## 4. Campaign Scheduler Form

### 4.1 Fields
| Field | Type | Source | Validation |
|-------|------|--------|------------|
| Target Group | `<Select>` dropdown | `whatsapp_groups` table | Required |
| Message Content | `<Textarea>` (4 rows) | User input | Required, non-empty |
| Schedule Time | `<Input type="datetime-local">` | User input | Required, must be future |

### 4.2 Empty State
When no groups are captured:
- Shows Users icon (32px, muted)
- Message: "No groups captured yet"
- Instructions: "Open WhatsApp Web with the Vanto Chrome Extension active, then click on a group chat to capture it."

### 4.3 Submit Flow
1. Validate all fields filled
2. Validate `scheduled_at` is in the future
3. Get authenticated user
4. Insert to `scheduled_group_posts` with `status: 'pending'`
5. Clear form on success
6. Refresh data

---

## 5. Campaigns Dashboard

### 5.1 Table Structure
| Column | Content | Width |
|--------|---------|-------|
| Group | `target_group_name` | Auto |
| Message | Truncated preview | max 200px |
| Scheduled | `format(scheduled_at, 'MMM d, HH:mm')` | Nowrap |
| Status | Color-coded badge | Auto |
| Actions | Delete button (pending only) | 60px |

### 5.2 Status Badges
| Status | Style |
|--------|-------|
| `pending` | Amber background, amber text |
| `sent` | Emerald background, emerald text |
| `failed` | Red background, red text |

### 5.3 Delete
- Only available for `pending` posts
- Ghost button with Trash2 icon
- Calls `supabase.from('scheduled_group_posts').delete().eq('id', id)`

---

## 6. Chrome Extension Flow

### 6.1 Group Capture (content.js)
1. Extension detects `@g.us` chat IDs in WhatsApp Web DOM
2. Extracts group name from chat header
3. Sends message to background.js
4. background.js upserts to `whatsapp_groups` table
5. Displays "Group Chat Captured!" banner in sidebar

### 6.2 Polling Engine (background.js)
```
chrome.alarms.create('vanto-group-poster', { periodInMinutes: 1 })

On alarm:
  1. Fetch from scheduled_group_posts WHERE status='pending' AND scheduled_at <= NOW()
  2. For each due post:
     a. Find active WhatsApp Web tab
     b. Send VANTO_EXECUTE_GROUP_POST message to content script
     c. Wait for response
     d. Update status to 'sent' or 'failed'
```

### 6.3 Execution Engine (content.js)
When receiving `VANTO_EXECUTE_GROUP_POST`:
1. Open WhatsApp search
2. Type group name to search
3. Wait for search results
4. Click matching group chat
5. Wait for chat to load
6. Find message input box (`div[contenteditable="true"]`)
7. Focus and inject text: `document.execCommand('insertText', false, messageContent)`
8. Find and click Send button (`span[data-icon="send"]`)
9. Return success/failure to background.js

### 6.4 Permissions
Manifest V3 permissions required:
- `alarms` — for 1-minute polling
- `activeTab` — for tab detection
- Host permission: `https://web.whatsapp.com/*`

---

## 7. Realtime Updates

Channel: `group-posts-realtime`
- Listens for all events (`*`) on `scheduled_group_posts`
- Triggers full data refetch on any change
- Ensures dashboard reflects Chrome Extension status updates instantly

---

## 8. Data Flow Diagram

```
┌─────────────────┐     Click group     ┌──────────────────┐
│  WhatsApp Web   │ ──────────────────▶ │  content.js      │
│  (Browser Tab)  │                     │  (Chrome Ext)    │
└─────────────────┘                     └────────┬─────────┘
                                                 │ Upsert group
                                        ┌────────▼─────────┐
                                        │  background.js   │
                                        │  (Chrome Ext)    │
                                        └────────┬─────────┘
                                                 │ Supabase API
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
                                        │  background.js   │──▶ content.js ──▶ WhatsApp Web
                                        │  (Polls DB)      │◀── status ◀──── (simulates send)
                                        └────────┬─────────┘
                                                 │ Update status
                                        ┌────────▼─────────┐
                                        │ scheduled_group  │
                                        │ _posts → 'sent'  │
                                        └──────────────────┘
```

---

*End of Group Campaigns Module Specification*
