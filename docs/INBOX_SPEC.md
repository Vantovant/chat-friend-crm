# Shared Inbox Module — Detailed Specification

> Module: Shared Inbox  
> File: `src/components/vanto/InboxModule.tsx` (933 lines)  
> Last Updated: 2026-03-13

---

## 1. Purpose

Real-time WhatsApp messaging interface providing conversation management, agent-to-contact messaging via Twilio, team assignment workflows, AI-assisted reply drafting, and delivery tracking with structured error handling.

---

## 2. Architecture

| Layer | Detail |
|-------|--------|
| Component | `InboxModule` |
| Tables | `conversations`, `messages`, `contacts`, `contact_activity` |
| Realtime | Supabase Realtime channel `inbox-messages` |
| Edge Functions | `send-message` |
| AI Integration | Zazi Copilot sidebar (`CopilotSidebar`), AI auto-reply |
| Hooks | `useProfiles()`, `useCurrentUser()`, `useIsMobile()` |

---

## 3. Layout Structure

### Desktop (3-Panel)
```
┌────────────┬──────────────────────┬────────────┐
│ Conv List  │   Chat Thread        │ Info/AI    │
│ (320px)    │   (flex-1)           │ (288-320px)│
│            │                      │            │
│ Search     │ Header               │ Contact    │
│ Filters    │ Messages             │ Details    │
│ List Items │ Input                │ or Copilot │
└────────────┴──────────────────────┴────────────┘
```

### Mobile (Single Panel Toggle)
- Shows either conversation list OR chat thread
- Back arrow (`←`) to return to list
- Info and Copilot panels hidden

---

## 4. Conversation List (Left Panel)

### 4.1 Search
- Real-time filter by contact name or phone number
- Input with Search icon

### 4.2 Filter Tabs
| Tab | Filter Logic |
|-----|-------------|
| `All` | All conversations (no filter) |
| `My Leads` | `contact.assigned_to === currentUser.id` |
| `Unassigned` | `contact.assigned_to` is null |

### 4.3 List Item (`ConvListItem`)
Each row displays:
- **Avatar** with initials (gradient background)
- **Unread badge** (red circle with count, positioned top-right of avatar)
- **Contact name** (truncated)
- **Last message preview** (truncated, 1 line)
- **Timestamp** (relative time)
- **Temperature badge** (HOT/WARM/COLD with color coding)
- **Assignment indicator** (mini avatar + name tooltip)

### 4.4 Sorting
Conversations sorted by `last_message_at` descending (most recent first).

### 4.5 Unread Counter
Header displays total unread count across all conversations with pulsing green dot.

---

## 5. Chat Thread (Center Panel)

### 5.1 Header Bar
| Element | Detail |
|---------|--------|
| Back arrow | Mobile only — returns to conversation list |
| Contact avatar | Gradient initials circle |
| Contact name | Bold, truncated |
| Phone number | Formatted via `displayPhone()` |
| Temperature badge | Colored pill (HOT/WARM/COLD) |
| Assignment dropdown | All users can reassign; select from profiles list |
| Phone button | Opens `tel:{phone}` |
| Video button | Opens `https://wa.me/{phone}` |
| AI Reply button | Sends AI-generated follow-up message |
| Copilot toggle | Opens/closes Zazi Copilot panel |
| Info toggle | Opens/closes contact info panel |
| More options | Placeholder for future actions |

### 5.2 Message Bubbles
| Property | Outbound | Inbound |
|----------|----------|---------|
| Alignment | Right | Left |
| CSS Class | `message-bubble-out` | `message-bubble-in` |
| Max Width | 70% | 70% |
| AI Badge | Shows if `message_type === 'ai'` | N/A |

### 5.3 Delivery Status Icons
| Status | Display |
|--------|---------|
| `queued` | Spinning loader |
| `sent` | Single checkmark (✓) muted |
| `delivered` | Double checkmark (✓✓) muted |
| `read` | Double checkmark (✓✓) primary color |
| `failed` | ⚠ AlertTriangle + error code |

### 5.4 Failed Message Handling
- Parses error codes from format `[TWILIO_63007] description`
- Tooltip shows full error details on hover
- **Retry button** resends via `send-message` edge function
- Common errors: `TWILIO_63007` (24h window), `TWILIO_21610` (unsubscribed)

### 5.5 24-Hour Window Modal
Triggered when `send-message` returns `template_required`:
- Explains WhatsApp's 24-hour freeform messaging window
- Step-by-step instructions for sending approved templates via Twilio Console

---

## 6. Message Sending

### 6.1 Input Area
- Textarea with auto-resize (1 row)
- Enter to send, Shift+Enter for newline
- Disabled while sending
- Paperclip button (attachment — placeholder)
- Emoji button (placeholder)
- Send button with gradient styling

### 6.2 Optimistic Update Flow
```
User types message → Enter
  ├── 1. Create temp message (id: temp-{timestamp}, status: queued)
  ├── 2. Append to messages array immediately
  ├── 3. Update conversation list preview
  ├── 4. Call send-message edge function
  │     ├── Success: Replace temp with real message
  │     └── Failure: Remove temp, show error toast
  └── 5. Scroll to bottom
```

---

## 7. Agent Assignment

### 7.1 Reassignment Flow
1. Agent selects new assignee from dropdown
2. Optimistic update to conversation list
3. `contacts.assigned_to` updated in DB
4. Activity logged to `contact_activity` table:
   - `type: 'conversation_reassigned'`
   - `metadata: { from: oldId, to: newId }`
5. Toast confirmation with new assignee name
6. On failure: rollback to previous assignment

### 7.2 Access Control
- All authenticated users can reassign (RLS handles permissions)
- Admin/super_admin: see all conversations
- Agent: see assigned + unassigned conversations

---

## 8. Zazi Copilot Panel

| Feature | Detail |
|---------|--------|
| Component | `CopilotSidebar` |
| Width | 320px (desktop only) |
| Insert Draft | Populates message input with AI text |
| Send Draft | Sends AI reply directly with full optimistic flow |
| Toggle | Brain (🧠) icon in chat header |
| Context | Receives `conversationId` and `contactName` |

---

## 9. Realtime Subscriptions

Channel: `inbox-messages`

| Event | Table | Handler |
|-------|-------|---------|
| INSERT | `messages` | If matches current thread: append message, scroll. Always: update conversation list preview and unread count |
| UPDATE | `messages` | Update delivery status in place (delivery receipts from Twilio) |
| INSERT | `conversations` | Full conversation list refresh |

**Deduplication:** Messages checked by ID before appending to prevent duplicates from optimistic + realtime.

---

## 10. Database Schema

### `conversations` Table
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `contact_id` | uuid | FK → contacts |
| `status` | comm_status enum | `active`, `closed`, `pending` |
| `unread_count` | integer | Reset to 0 when opened |
| `last_message` | text | Preview text |
| `last_message_at` | timestamptz | For sorting |
| `last_inbound_at` | timestamptz | 24h window tracking |
| `last_outbound_at` | timestamptz | Response time tracking |

### `messages` Table
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `conversation_id` | uuid | FK → conversations |
| `content` | text | Message body |
| `is_outbound` | boolean | true = sent by agent |
| `message_type` | enum | `text`, `image`, `ai` |
| `status` | enum | `queued`, `sent`, `delivered`, `read`, `failed` |
| `status_raw` | text | Raw Twilio status string |
| `error` | text | Error details (e.g., `[TWILIO_63007] ...`) |
| `sent_by` | uuid | FK → profiles |
| `provider_message_id` | text | Twilio SID for tracking |

### RLS Policies Summary
| Table | Admin | Agent |
|-------|-------|-------|
| `conversations` | ALL | SELECT/UPDATE where contact is assigned or unassigned |
| `messages` | ALL (SELECT/UPDATE/DELETE) | SELECT where conversation accessible |
| `contacts` | ALL | SELECT/UPDATE where assigned or unassigned |

---

## 11. Sub-Components

| Component | Lines | Purpose |
|-----------|-------|---------|
| `AssignmentControl` | ~30 | Dropdown for reassigning contacts to team members |
| `ConvListItem` | ~55 | Individual conversation row with avatar, preview, badges |
| `MiniAvatar` | ~10 | Small colored circle with single initial |
| `ContactAvatar` | ~15 | Larger avatar with gradient background and initials |
| `ActionBtn` | ~20 | Reusable icon button with optional label and primary styling |
| `ContactInfoPanel` | ~100 | Full contact detail sidebar |

---

*End of Shared Inbox Module Specification*
