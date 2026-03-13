# Vanto CRM — Detailed Module Specifications

> Generated: 2026-03-13  
> Version: 1.0  
> Covers: Integrations, Inbox, Group Campaigns, Workflows, Playbooks, Automations, Knowledge Vault, API Console

---

## Table of Contents

1. [Integrations Module](#1-integrations-module)
2. [Shared Inbox Module](#2-shared-inbox-module)
3. [Group Campaigns Module](#3-group-campaigns-module)
4. [Workflows Module](#4-workflows-module)
5. [Playbooks Module](#5-playbooks-module)
6. [Automations Module](#6-automations-module)
7. [Knowledge Vault Module](#7-knowledge-vault-module)
8. [API Console Module](#8-api-console-module)

---

## 1. Integrations Module

**File:** `src/components/vanto/IntegrationsModule.tsx` (422 lines)  
**Purpose:** Central hub for managing all third-party connections, webhook configuration, and sync operations.

### 1.1 Architecture

| Layer | Detail |
|-------|--------|
| Data Source | `integration_settings` table (key-value pairs) |
| Auth | RLS-protected; settings scoped to authenticated users |
| Edge Functions | `push-to-zazi-webhook`, `test-webhook` |

### 1.2 Integration Registry

Nine integrations are defined in the `integrationDefs` array:

| ID | Name | Category | Status Toggle |
|----|------|----------|---------------|
| `whatsapp` | WhatsApp Business | Messaging | ✅ |
| `chrome` | Chrome Extension | Browser | ✅ |
| `openai` | OpenAI GPT-4 | AI | ✅ |
| `zazi` | Zazi CRM | CRM | ✅ |
| `stripe` | Stripe | Payments | ✅ |
| `zapier` | Zapier | Automation | ✅ |
| `sheets` | Google Sheets | Productivity | ✅ |
| `calendly` | Calendly | Scheduling | ✅ |
| `hubspot` | HubSpot CRM | CRM | ✅ |

Each integration's status is stored as `integration_{id}` in the `integration_settings` table with values `connected` or `disconnected`.

### 1.3 Chrome Extension Panel

- Highlighted card with "Install Extension" CTA
- Modal with 4-step manual installation guide (Developer Mode → Load Unpacked)
- Links to `chrome://extensions`

### 1.4 Twilio Health Panel

- Embedded `<TwilioHealthPanel />` component
- Displays real-time health status of WhatsApp Business API connection
- Shows Twilio account SID, messaging service SID, and phone number configuration

### 1.5 Inbound Webhook (Zazi → Vanto)

**Editable fields stored in `integration_settings`:**
- `inbound_webhook_url` — Endpoint URL
- `inbound_webhook_secret` — Secret sent as `x-webhook-secret` header

**Supported Actions:**
| Action | Description |
|--------|-------------|
| `sync_contacts` | Bulk upsert array of contacts by phone (idempotent) |
| `upsert_contact` | Create or update a single contact |
| `log_chat` | Log a WhatsApp message & create a conversation |

**Test Button:** Invokes `test-webhook` edge function to simulate a sample contact upsert. Result displayed as success/failure badge.

### 1.6 Outbound Push (Vanto → Zazi)

**Editable fields:**
- `outbound_webhook_url` — Zazi webhook endpoint
- `outbound_webhook_secret` — Shared secret

**Pre-Push Validation (runs automatically before push):**
1. Checks for duplicate `phone_normalized` groups
2. Checks for contacts missing both phone and email
3. Checks for phone numbers with < 10 digits
4. Blocks push if any issues found; displays issue list

**Push Flow:**
1. Calls `push-to-zazi-webhook` edge function
2. Displays `ResultBadge` with synced/skipped/total counts
3. Detects 401/unauthorized responses → shows "Secret Mismatch" alert

### 1.7 UI Components

- `CopyField` — Read-only field with clipboard copy button
- `EditableField` — Inline-editable field with save button and loading state
- `ResultBadge` — Colored badge showing sync results with error details

---

## 2. Shared Inbox Module

**File:** `src/components/vanto/InboxModule.tsx` (933 lines)  
**Purpose:** Real-time WhatsApp messaging interface with conversation management, agent assignment, and AI assistance.

### 2.1 Architecture

| Layer | Detail |
|-------|--------|
| Tables | `conversations`, `messages`, `contacts`, `contact_activity` |
| Realtime | Supabase Realtime on `messages` (INSERT, UPDATE) and `conversations` (INSERT) |
| Edge Functions | `send-message` |
| AI Integration | Zazi Copilot sidebar, AI auto-reply via `send-message` with `message_type: 'ai'` |

### 2.2 Conversation List (Left Panel)

- **Width:** 320px on desktop, full-width on mobile
- **Search:** Filters by contact name or phone number
- **Filter Tabs:**
  - `All` — All conversations
  - `My Leads` — Conversations where `contact.assigned_to === currentUser.id`
  - `Unassigned` — Conversations where `contact.assigned_to` is null
- **List Item Shows:** Contact avatar, name, last message preview, timestamp, unread badge, temperature badge (HOT/WARM/COLD), assignment indicator
- **Sort:** By `last_message_at` descending

### 2.3 Chat Thread (Center Panel)

**Header:**
- Contact name, phone number (formatted via `displayPhone`)
- Temperature badge
- Assignment dropdown (all authenticated users can reassign)
- Action buttons: Phone call, WhatsApp video, AI Reply, Copilot toggle, Info toggle

**Message Display:**
- Outbound messages: right-aligned with green bubble styling (`message-bubble-out`)
- Inbound messages: left-aligned with neutral bubble styling (`message-bubble-in`)
- AI messages: labeled with Bot icon and "AI Response" badge
- **Delivery Status Icons:**
  - `queued` → spinning loader
  - `sent` → single checkmark (✓)
  - `delivered` → double checkmark (✓✓) in muted color
  - `read` → double checkmark (✓✓) in primary color
  - `failed` → AlertTriangle with error code tooltip
- **Failed Message Handling:**
  - Parses error codes from `[TWILIO_63007]` format
  - Shows expandable tooltip with error details
  - "Retry" button to resend via `send-message` edge function

**Message Input:**
- Textarea with Enter-to-send (Shift+Enter for newline)
- Paperclip attachment button (placeholder)
- Emoji button (placeholder)
- Send button with loading state

### 2.4 Optimistic Updates

All message sends use optimistic rendering:
1. Temp message inserted immediately with `queued` status
2. On success: replaced with real message from server
3. On failure: temp message removed, error toast shown

Conversation list updated optimistically with new `last_message` and `last_message_at`.

### 2.5 24-Hour Window Handling

When the `send-message` edge function returns `template_required` or `TEMPLATE_REQUIRED`:
- Opens a modal explaining WhatsApp's 24-hour messaging window
- Provides step-by-step instructions for sending a pre-approved template via Twilio Console

### 2.6 Contact Info Panel (Right Panel, Desktop Only)

- **Width:** 288px
- Shows: Contact details, tags, notes, lead type, interest level, assigned agent
- `ContactInfoPanel` sub-component

### 2.7 Zazi Copilot Panel (Right Panel, Desktop Only)

- **Width:** 320px
- `CopilotSidebar` component
- **Insert Draft:** Populates the message input with AI-generated text
- **Send Draft:** Sends the AI-generated reply directly (with optimistic updates)
- Toggled via Brain icon in chat header

### 2.8 Mobile Responsiveness

- Uses `useIsMobile()` hook
- Mobile shows either conversation list OR chat thread (not both)
- Back arrow button to return to list
- Info and Copilot panels hidden on mobile

### 2.9 Realtime Subscriptions

Channel: `inbox-messages`

| Event | Table | Behavior |
|-------|-------|----------|
| INSERT | `messages` | Appends to current thread if matching; updates conversation list preview and unread count |
| UPDATE | `messages` | Updates delivery status in place (delivery receipts) |
| INSERT | `conversations` | Refreshes full conversation list |

### 2.10 Sub-Components

| Component | Purpose |
|-----------|---------|
| `AssignmentControl` | Dropdown to reassign contacts to team members |
| `ConvListItem` | Individual conversation row with avatar, preview, badges |
| `MiniAvatar` | Colored circle with initials for assignment display |
| `ContactAvatar` | Larger avatar with gradient background |
| `ActionBtn` | Reusable icon button with optional label and primary styling |
| `ContactInfoPanel` | Full contact detail view in right sidebar |

---

## 3. Group Campaigns Module

**File:** `src/components/vanto/GroupCampaignsModule.tsx` (258 lines)  
**Purpose:** Schedule and manage bulk message campaigns to WhatsApp groups via the Chrome Extension auto-poster.

### 3.1 Architecture

| Layer | Detail |
|-------|--------|
| Tables | `whatsapp_groups`, `scheduled_group_posts` |
| Realtime | Supabase Realtime on `scheduled_group_posts` for live status updates |
| Chrome Extension | Polls `scheduled_group_posts` every 60s; executes posts by simulating WhatsApp Web UI actions |
| RLS | `user_id = auth.uid()` on both tables |

### 3.2 Database Schema

**`whatsapp_groups`:**
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, auto-generated |
| `user_id` | uuid | FK → profiles.id |
| `group_name` | text | Captured from WhatsApp Web via Chrome Extension |
| `created_at` | timestamptz | Auto |

**`scheduled_group_posts`:**
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | FK → profiles.id |
| `target_group_name` | text | Must match a captured group name |
| `message_content` | text | The message body |
| `image_url` | text | Optional image attachment (future) |
| `scheduled_at` | timestamptz | When to send |
| `status` | text | `pending` → `sent` or `failed` |
| `created_at` | timestamptz | Auto |

### 3.3 Campaign Scheduler Form

**Fields:**
1. **Target Group** — `<Select>` dropdown populated from `whatsapp_groups` table
2. **Message Content** — `<Textarea>` (4 rows)
3. **Schedule Time** — `<Input type="datetime-local">` with `min` set to now + 1 minute

**Validation:**
- All three fields required
- `scheduled_at` must be in the future
- User must be authenticated

**Empty State:** When no groups are captured, shows instructions: "Open WhatsApp Web with the Vanto Chrome Extension active, then click on a group chat to capture it."

### 3.4 Campaigns Dashboard

**Table columns:**
| Column | Content |
|--------|---------|
| Group | `target_group_name` |
| Message | Truncated preview (max 200px) |
| Scheduled | Formatted date (`MMM d, HH:mm`) |
| Status | Color-coded badge |
| Actions | Delete button (pending posts only) |

**Status Badges:**
- 🟢 `sent` — Emerald green
- 🔴 `failed` — Red
- 🟡 `pending` — Amber

### 3.5 Chrome Extension Flow

1. **Group Capture:** Extension detects `@g.us` chat IDs in WhatsApp Web → upserts to `whatsapp_groups`
2. **Polling:** `chrome.alarms` fires every 60 seconds → background.js fetches due posts
3. **Execution:** content.js searches for group → clicks to open → injects text via `document.execCommand('insertText')` → clicks Send button
4. **Status Update:** background.js updates post status to `sent` or `failed`

### 3.6 Realtime Updates

Channel: `group-posts-realtime`
- Listens for `*` events on `scheduled_group_posts`
- Triggers full data refetch on any change

---

## 4. Workflows Module

**File:** `src/components/vanto/WorkflowsModule.tsx` (306 lines)  
**Purpose:** Reusable multi-step automation playbooks for sales processes.

### 4.1 Architecture

| Layer | Detail |
|-------|--------|
| Table | `workflows` |
| Data Model | `steps` stored as JSONB array of `{ type, label }` objects |

### 4.2 Trigger Types

| Value | Label |
|-------|-------|
| `lead_type_changed` | Lead Type Changed |
| `lead_type_to_prospect` | Lead → Prospect |
| `lead_type_to_registered` | Lead → Registered_Nopurchase |
| `lead_type_to_buyer` | Lead → Purchase_Nostatus |
| `lead_type_to_vip` | Lead → Purchase_Status |
| `lead_type_to_expired` | Lead → Expired |
| `stage_changed` | Pipeline Stage Changed |
| `inbound_message` | Inbound Message Received |
| `manual` | Manual Trigger |

### 4.3 Step Types

| Value | Label | Icon | Color Theme |
|-------|-------|------|-------------|
| `send_message` | Send Message | MessageSquare | Blue |
| `assign_owner` | Assign Owner | UserPlus | Violet |
| `add_tag` | Add Tag | Tag | Primary |
| `wait` | Wait | Clock | Secondary/muted |
| `ai_suggest_reply` | AI Suggest Reply | Zap | Amber |

### 4.4 Workflow Card UI

Each workflow displays:
- Name with ACTIVE/INACTIVE badge
- Description
- Contact count
- Visual flow diagram: trigger → step₁ → step₂ → ... (arrow-connected badges)
- Toggle (Play/Pause) and Delete buttons

### 4.5 Create Workflow Dialog

**Fields:**
1. **Name** (required)
2. **Description** (optional)
3. **Trigger** — dropdown from `TRIGGER_TYPES`
4. **Steps** — dynamic list builder
   - Add steps via button row (one per step type)
   - Each step has an editable inline label
   - Steps can be reordered (not implemented) or removed
   - Trigger is automatically prepended as step 0

**Persistence:** Inserts to `workflows` table with `steps` as JSON, `active: false`, and `created_by` set to current user.

---

## 5. Playbooks Module

**File:** `src/components/vanto/PlaybooksModule.tsx` (250 lines)  
**Purpose:** Sales script library organized by objection/scenario categories with usage and conversion tracking.

### 5.1 Architecture

| Layer | Detail |
|-------|--------|
| Table | `playbooks` |
| Tracking | `usage_count` and `conversion_count` columns |

### 5.2 Categories

| ID | Label | Icon |
|----|-------|------|
| `price_question` | Price Question | 💰 |
| `skeptical` | Skeptical / Scam Fear | 🤔 |
| `wants_results` | Wants Results Fast | ⚡ |
| `medical_concern` | Medical Concern | 🩺 |
| `business_plan` | Business Plan | 📊 |
| `general` | General | 💬 |

### 5.3 Playbook Card UI

Each card shows:
- Category icon + Title + Version number
- Approval badge: ✓ Approved (green) or Draft (amber)
- Script content preview (4-line clamp)
- **Usage Stats:**
  - Total uses count
  - Conversion rate (%) = `conversion_count / usage_count * 100`
- **Actions:** Approve/Unapprove toggle, Edit, Delete

### 5.4 Category Filter Bar

- Horizontal scrollable pill buttons
- "All" filter + one per category
- Active filter highlighted with primary color

### 5.5 Create/Edit Dialog

Uses shadcn `<Dialog>` component.

**Fields:**
1. **Title** (required)
2. **Category** (required, dropdown)
3. **Script Content** (required, textarea, 8 rows)

**On Create:** Sets `approved: true` by default, `created_by` to current user.

---

## 6. Automations Module

**File:** `src/components/vanto/AutomationsModule.tsx` (293 lines)  
**Purpose:** Simple trigger-action automation rules for repetitive CRM tasks.

### 6.1 Architecture

| Layer | Detail |
|-------|--------|
| Table | `automations` |
| Execution | Serverless (edge functions on trigger events) |

### 6.2 Trigger Options

| Trigger |
|---------|
| New contact added |
| Lead type changed to Prospect |
| Lead type changed to Registered_Nopurchase |
| Lead type changed to Purchase_Nostatus |
| Lead type changed to Purchase_Status |
| Lead type changed to Expired |
| Temperature set to hot |
| Inbound message received |
| Contact tagged |
| Pipeline stage changed |

### 6.3 Action Options

| Action |
|--------|
| Send WhatsApp message |
| Assign to team member |
| Add tag |
| Change lead type |
| Move to pipeline stage |
| Notify via email |
| AI auto-reply |

### 6.4 Quick Templates

| Template Name | Trigger | Action |
|---------------|---------|--------|
| Welcome Series | New contact added | Send WhatsApp message |
| Re-engagement | Temperature set to hot | Assign to team member |
| Appointment Reminder | Pipeline stage changed | Send WhatsApp message |
| Purchase Follow-Up | Lead type → Purchase_Nostatus | Send WhatsApp message |
| Expired Re-activation | Lead type → Expired | Send WhatsApp message |

### 6.5 Stats Dashboard

Three stat cards at top:
- **Active** — count of automations where `active === true` (primary color)
- **Total Runs** — sum of all `run_count` values (amber)
- **Total** — total automation count (blue)

### 6.6 Automation Card UI

Each automation shows:
- Toggle switch (active/inactive)
- Icon (colored based on active state)
- Name with ACTIVE badge
- Trigger → Action flow: `When: {trigger}` → `Then: {action}` in pill badges
- Run count and last run time (relative: Xm/Xh/Xd ago)
- Hover-reveal: Pause/Play and Delete buttons

### 6.7 Create Automation Dialog

**Fields:**
1. **Name** (required)
2. **When (Trigger)** — dropdown from `TRIGGER_OPTIONS`
3. **Then (Action)** — dropdown from `ACTION_OPTIONS`

**Defaults:** Can be pre-populated from template selection.  
**On Create:** Sets `active: false`, `created_by` to current user.

### 6.8 Workflows vs. Automations

| Feature | Automations | Workflows |
|---------|-------------|-----------|
| Complexity | Single trigger → single action | Multi-step sequences |
| Steps | 1 | Unlimited |
| Visual | Trigger → Action text | Arrow-connected flow diagram |
| Use Case | Quick rules | Complex sales funnels |

---

## 7. Knowledge Vault Module

**File:** `src/components/vanto/KnowledgeVaultModule.tsx` (515 lines)  
**Purpose:** Document repository that provides grounding context for the Zazi Copilot AI. Supports text ingestion with client-side chunking and full-text search.

### 7.1 Architecture

| Layer | Detail |
|-------|--------|
| Tables | `knowledge_files`, `knowledge_chunks` |
| Search | `search_knowledge` Postgres function (full-text search via `tsvector`) |
| Edge Function | `knowledge-search` |
| Chunking | Client-side, ~2000 chars per chunk with 200-char overlap |

### 7.2 Collections

| ID | Label | Mode | Description |
|----|-------|------|-------------|
| `general` | General Knowledge & App Manual | Assisted | AI can paraphrase and expand |
| `opportunity` | Business Opportunity | Strict | AI must quote verbatim |
| `compensation` | Compensation | Strict | No paraphrasing allowed |
| `products` | Product Prices & Benefits | Strict | Exact pricing required |
| `orders` | Orders & Deliveries | Strict | Factual accuracy critical |
| `motivation` | MLM & Wellness Motivation | Assisted | AI can elaborate freely |

**Mode Semantics:**
- **Strict:** Zazi Copilot must only quote directly from chunks. No hallucination allowed. Marked with 🛡️ Shield icon.
- **Assisted:** Zazi can paraphrase and elaborate on the content.

### 7.3 Upload Flow

**Two Upload Modes:**

1. **Paste Text** — User pastes content directly into textarea
2. **File Upload** — Accepts `.txt`, `.md`, `.csv`, `.json` files (read as text)

**Processing Pipeline:**
1. Read raw text from paste or file
2. For JSON files: pretty-print
3. `cleanText()` — Remove null bytes, control chars, normalize whitespace
4. Validate minimum 10 characters
5. Create `knowledge_files` record with `status: 'processing'`
6. `chunkText()` — Split into ~2000-char chunks with 200-char overlap, breaking on sentence boundaries
7. Insert chunks to `knowledge_chunks` in batches of 50
8. Update file status to `approved` (success) or `rejected` (failure)

**Upload Form Fields:**
1. **Title** (required)
2. **Collection** (dropdown)
3. **Upload Mode** toggle (Paste / File)
4. **Content** (textarea for paste, file input for upload)
5. **Effective Date** (optional, date input)
6. **Expiry Date** (optional, date input)

### 7.4 Files Tab

Displays all uploaded knowledge files with:
- Collection icon
- Title + file name + version + collection label
- Status icon: ✅ Approved / ⏳ Processing / ❌ Rejected
- Mode badge: `STRICT` in amber if applicable
- Expiry badge: `EXPIRED` in red if past expiry date
- Date metadata (created, effective, expiry)
- **Actions:** Re-index (placeholder), Delete (removes chunks then file)

### 7.5 Search Tab

- Full-text search input with Enter-to-search
- Collection filter applied to search
- Results display: file icon, title, collection badge, relevance score, chunk text preview (500 chars)
- Calls `knowledge-search` edge function with `{ query, collection, max_results: 10 }`

### 7.6 Chunking Algorithm

```
function chunkText(text, maxChars=2000, overlap=200):
  while start < text.length:
    end = min(start + maxChars, text.length)
    if end < text.length:
      find last period before end (but after midpoint)
      break at sentence boundary if found
    add chunk
    advance start by (end - overlap)
  filter out chunks < 10 chars
```

Each chunk stores:
- `file_id` — parent file reference
- `chunk_index` — sequential order
- `chunk_text` — the text content
- `token_count` — estimated as `ceil(chunk.length / 4)`

---

## 8. API Console Module

**File:** `src/components/vanto/APIConsoleModule.tsx` (256 lines)  
**Purpose:** Developer tools interface for testing backend edge functions and viewing webhook event history.

### 8.1 Architecture

| Layer | Detail |
|-------|--------|
| Table | `webhook_events` |
| API Layer | Direct `fetch()` to edge function URLs with session JWT |

### 8.2 Endpoint Registry

| Name | Path | Method | Description |
|------|------|--------|-------------|
| Twilio Inbound | `/functions/v1/twilio-whatsapp-inbound` | POST | Receives inbound WhatsApp messages from Twilio |
| Twilio Status | `/functions/v1/twilio-whatsapp-status` | POST | Receives message delivery status callbacks |
| CRM Webhook | `/functions/v1/crm-webhook` | POST | Inbound sync from Zazi CRM |
| Save Contact | `/functions/v1/save-contact` | POST | Chrome extension contact capture |
| Send Message | `/functions/v1/send-message` | POST | Send outbound WhatsApp message via Twilio |
| AI Chat | `/functions/v1/ai-chat` | POST | AI agent powered by Lovable AI gateway |
| Push to Zazi | `/functions/v1/push-to-zazi-webhook` | POST | Push contacts outbound to Zazi CRM |

### 8.3 Sample Payloads

Pre-configured JSON payloads for four endpoints:
- `crm-webhook`: `sync_contacts` with sample contact
- `save-contact`: Name + phone + whatsapp_id
- `send-message`: conversation_id + content
- `ai-chat`: Messages array with user prompt

### 8.4 Request Panel

- **URL Display:** Full endpoint URL with copy button
- **Request Body Editor:** Monospace textarea (10 rows) for JSON payload editing
- **Send Button:** Executes `fetch()` with:
  - Method: POST
  - Headers: `Content-Type: application/json`, `Authorization: Bearer {session_token}`, `apikey: {anon_key}`
  - Body: Parsed JSON payload
- **JSON Validation:** Validates payload before sending; shows error toast on invalid JSON

### 8.5 Response Panel

Appears after request completes:
- Status code badge (green < 300, red ≥ 300)
- Response body in monospace pre-formatted block
- Auto-formats JSON responses
- Scrollable (max-height 320px)

### 8.6 Webhook Events Log (Desktop Sidebar)

- **Width:** 288px (desktop only; dropdown selector on mobile)
- Loads last 20 events from `webhook_events` table
- Each event shows:
  - Status indicator (green for `processed`, red for error)
  - Action name
  - Source + timestamp
- Auto-refreshes after each API request

### 8.7 Mobile Responsiveness

- Endpoint list replaced with `<select>` dropdown on mobile
- Request/response panel takes full width
- Events log hidden (accessible via future mobile event viewer)

---

## Cross-Module Dependencies

```
┌─────────────┐     ┌───────────┐     ┌──────────────┐
│ Integrations│────▶│  Contacts │◀────│  Shared Inbox│
│             │     │  Table    │     │              │
└─────────────┘     └─────┬─────┘     └──────┬───────┘
                          │                   │
                    ┌─────▼─────┐       ┌─────▼──────┐
                    │ Workflows │       │  Messages  │
                    │           │       │  Table     │
                    └─────┬─────┘       └────────────┘
                          │
                    ┌─────▼──────┐     ┌──────────────┐
                    │Automations │     │  Knowledge   │
                    │            │     │  Vault       │
                    └────────────┘     └──────┬───────┘
                                              │
                                        ┌─────▼──────┐
                                        │Zazi Copilot│
                                        │(AI Agent)  │
                                        └────────────┘
```

### Shared Services

| Service | Used By |
|---------|---------|
| `supabase.auth.getUser()` | All modules |
| `supabase.auth.getSession()` | API Console, Inbox |
| `useProfiles()` hook | Inbox, Workflows |
| `useCurrentUser()` hook | Inbox |
| `useIsMobile()` hook | Inbox, API Console |
| `toast()` | All modules |
| Supabase Realtime | Inbox, Group Campaigns |

---

## Security Model Summary

| Module | RLS Policy | Scope |
|--------|-----------|-------|
| Integrations | Authenticated users | Global settings (shared) |
| Inbox | Permissive read, scoped write | Admins see all; agents see assigned + unassigned |
| Group Campaigns | `user_id = auth.uid()` | User sees only own groups and posts |
| Workflows | Authenticated users | Shared across team |
| Playbooks | Authenticated users | Shared across team |
| Automations | Authenticated users | Shared across team |
| Knowledge Vault | Authenticated users | Shared across team |
| API Console | Authenticated users | Shared webhook events |

---

*End of Module Specifications*
