# Vanto CRM — Page-by-Page Specification

**Date:** 5 April 2026  
**Version:** 2.0

---

## Architecture Overview

Vanto CRM is a **single-page application** (SPA). All modules render under a single route `/` with module switching managed by `activeModule` state in `Index.tsx`. Additional routes exist for auth flows.

### Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `Index.tsx` | Main app shell — renders auth or module based on session |
| `/accept-invite` | `AcceptInvite.tsx` | Team invitation acceptance |
| `/reset-password` | `ResetPassword.tsx` | Password reset flow |
| `*` | `NotFound.tsx` | 404 fallback |

---

## Module: Dashboard (`dashboard`)

**Component:** `src/components/vanto/DashboardModule.tsx` (300 lines)

### Data Sources
| Table | Query |
|-------|-------|
| `contacts` | `select id, temperature, lead_type, created_at` where `is_deleted=false` (limit 1000) |
| `conversations` | `select id, status, unread_count, last_message_at` (limit 1000) |
| `messages` | `select id, created_at, is_outbound` ordered by `created_at desc` (limit 1000) |
| `contact_activity` | `select id, type, contact_id, created_at` ordered desc (limit 20) |

### UI Components
- 4 KPI cards: Total Contacts, Conversations, Messages, Unread
- Temperature breakdown: Hot (Flame icon), Warm (Sun icon), Cold (Snowflake icon)
- Messages-per-day AreaChart (Recharts, 7-day)
- Leads-by-type PieChart (5 APLGO types with color palette)
- Recent activity feed
- Active conversations counter

---

## Module: Inbox (`inbox`)

**Component:** `src/components/vanto/InboxModule.tsx` (933 lines)

### Data Sources
| Table | Query |
|-------|-------|
| `conversations` | Join with `contacts` — select all fields |
| `messages` | Filter by `conversation_id`, ordered by `created_at` |
| `contacts` | Via conversation join |

### UI Layout (3-panel)
1. **Left panel**: Conversation list with search, filter tabs (All/Mine/Unassigned)
2. **Center panel**: Message thread with send box
3. **Right panel**: Contact detail + AI Copilot sidebar

### Features
- Real-time subscription on `conversations` and `messages` tables
- Send messages via `send-message` Edge Function
- Message status badges: queued (clock), sent (check), delivered (double-check), read (blue double-check), failed (red alert)
- Re-send failed messages
- Template message quick-send modal
- AI Copilot sidebar (`CopilotSidebar.tsx`) for reply suggestions
- Conversation assignment via dropdown
- Mark as read on selection
- Mobile: back-arrow navigation between list and thread

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in message |

### Edge Functions Used
- `send-message` — outbound WhatsApp via Twilio
- `zazi-copilot` — AI copilot suggestions

---

## Module: Contacts (`contacts`)

**Component:** `src/components/vanto/ContactsModule.tsx`

### Data Sources
| Table | Query |
|-------|-------|
| `contacts` | Full select where `is_deleted=false`, ordered by `created_at desc` |
| `contact_activity` | For detail drawer activity log |
| `pipeline_stages` | For stage display |

### Features
- Search by name/phone/email
- Filter by temperature, lead type, interest level
- Add / Edit / Soft-delete contacts
- Bulk select: delete, tag, export CSV
- Merge duplicate contacts (`MergeContactsModal.tsx`)
- Contact detail drawer: notes, tags, assignment, activity log
- Phone normalization to E.164 via `phone-utils.ts`

---

## Module: CRM Pipeline (`crm`)

**Component:** `src/components/vanto/CRMModule.tsx`

### Data Sources
| Table | Query |
|-------|-------|
| `pipeline_stages` | All stages ordered by `stage_order` |
| `contacts` | Where `is_deleted=false`, with `stage_id` relationship |

### Features
- Kanban board with drag-and-drop between stages
- Filter by APLGO lead type (5 types)
- Stage statistics (count per stage)
- Contact cards with name, phone, temperature badge, lead type badge
- Add new deals directly to stages

---

## Module: Automations (`automations`)

**Component:** `src/components/vanto/AutomationsModule.tsx`

### Data Sources
| Table | Query |
|-------|-------|
| `automations` | All, ordered by `created_at desc` |

### Features
- Create/edit/delete automations
- Trigger types: new_contact, lead_type_change, temperature_change, inbound_message, tag_added, stage_change
- Action types: send_template, assign_agent, change_temperature, add_tag, move_stage, notify_team
- Toggle active/inactive
- Run count and last-run timestamp

---

## Module: AI Agent (`ai-agent`)

**Component:** `src/components/vanto/AIAgentModule.tsx`

### Edge Functions
- `ai-chat` — Conversational AI endpoint via Lovable AI Gateway

### Features
- Chat interface with message history (session-scoped)
- Suggested prompts: follow-up drafts, pipeline analysis, lead scoring, campaign messages
- Context-aware responses using CRM data
- Knowledge Vault integration

---

## Module: Knowledge Vault (`knowledge`)

**Component:** `src/components/vanto/KnowledgeVaultModule.tsx`

### Data Sources
| Table | Query |
|-------|-------|
| `knowledge_files` | All files with collection filter |
| `knowledge_chunks` | Via file relationship |

### Edge Functions
- `knowledge-ingest` — Upload and chunk files
- `knowledge-search` — Full-text search

### Collections
1. General Knowledge
2. Business Opportunity  
3. Compensation
4. Product Prices
5. Orders & Deliveries
6. MLM Motivation

### Features
- File upload (text/markdown) + paste-as-text
- Two modes: strict (verbatim) / assisted (paraphrase)
- Full-text search with relevance scoring
- File versioning, effective dates, expiry dates
- Status: processing → ready → error
- Delete files and associated chunks

---

## Module: Playbooks (`playbooks`)

**Component:** `src/components/vanto/PlaybooksModule.tsx`

### Data Sources
| Table | Query |
|-------|-------|
| `playbooks` | All, ordered by `created_at desc` |

### Features
- Categories: cold outreach, follow-up, closing, onboarding
- Create/edit/delete playbooks
- Usage count and conversion count tracking
- Approval workflow (approved flag)
- Version tracking

---

## Module: Workflows (`workflows`)

**Component:** `src/components/vanto/WorkflowsModule.tsx`

### Data Sources
| Table | Query |
|-------|-------|
| `workflows` | All, ordered by `created_at desc` |

### Features
- Multi-step workflow definition (JSON `steps` column)
- Active/inactive toggle
- Contact count tracking
- Create/edit/delete workflows

---

## Module: Group Campaigns (`group-campaigns`)

**Component:** `src/components/vanto/GroupCampaignsModule.tsx` (528 lines)

### Data Sources
| Table | Query |
|-------|-------|
| `whatsapp_groups` | All groups ordered by `group_name` |
| `scheduled_group_posts` | All posts ordered by `scheduled_at desc` |
| `integration_settings` | Keys: `ext_heartbeat_at`, `ext_whatsapp_ready` |

### UI Sections
1. **Extension Health Panel**: Connected/disconnected status, last seen, WhatsApp readiness
2. **Captured Groups Table**: Group name, JID, capture date, delete action
3. **Schedule Post Form**: Group selector, message textarea, single date/time or bulk campaign mode
4. **Scheduled Posts Table**: Status, group, message preview, scheduled time, failure reason, retry

### Bulk Campaign Mode
- Date range picker (shadcn Calendar popover with range selection)
- Time slot checkboxes: Morning (08:00), Mid-day (13:00), Evening (18:00)
- Generates one post per day × selected time slots

---

## Module: Integrations (`integrations`)

**Component:** `src/components/vanto/IntegrationsModule.tsx`

### Sub-modules
1. **Twilio WhatsApp**: `TwilioHealthPanel.tsx` — account SID check, webhook URLs, test message sender
2. **Chrome Extension**: Install instructions, connection status
3. **Zazi CRM**: Pull/push/bootstrap sync controls, webhook event log
4. **OpenAI**: BYO API key configuration

### Data Sources
| Table | Query |
|-------|-------|
| `integration_settings` | Twilio config keys |
| `webhook_events` | Event log for Zazi sync |
| `sync_runs` | Sync operation audit |

---

## Module: API Console (`api-console`)

**Component:** `src/components/vanto/APIConsoleModule.tsx`

### Features
- Endpoint registry for testing Edge Functions
- Request/response viewer
- Webhook event log

---

## Module: Settings (`settings`)

**Component:** `src/components/vanto/SettingsModule.tsx` (827 lines)

### Sections

| Section | Features |
|---------|----------|
| **Profile** | Edit full name, email, phone |
| **Team** | Invite members via email, manage roles, view pending invitations, edit roles |
| **AI Provider** | Configure BYO API keys (OpenAI), select model, enable/disable |
| **Auto-Reply** | Configure welcome message, menu options, knowledge-based responses |
| **Notifications** | Toggle: new messages, hot lead alerts, daily summary, AI suggestions |
| **Security** | Password change |

### Edge Functions
- `send-invitation` — Team invitation emails
- `ai-settings-save` — Save AI provider configuration

---

## Auth Page

**Component:** `src/components/vanto/AuthPage.tsx` (200 lines)

### Modes
- Login (email/password)
- Signup (email/password/full name)
- Forgot password (email)

### Features
- Password visibility toggle
- Error/success message display
- Redirect to app on successful auth
- Email redirect URL set to `window.location.origin`

---

## Shared Components

| Component | Purpose |
|-----------|---------|
| `AppSidebar.tsx` | Main navigation — desktop sidebar + mobile top/bottom bars |
| `CopilotSidebar.tsx` | AI copilot panel in Inbox |
| `PageHelpButton.tsx` | Context-aware help button per module |
| `MergeContactsModal.tsx` | Duplicate contact merge dialog |
| `TwilioHealthPanel.tsx` | Twilio connection status in Integrations |
| `NavLink.tsx` | Navigation link component |

---

## Utility Files

| File | Purpose |
|------|---------|
| `src/lib/vanto-data.ts` | Module type, lead types, temperature colors, APLGO labels |
| `src/lib/phone-utils.ts` | Phone normalization and display formatting |
| `src/lib/utils.ts` | `cn()` classname utility |
| `src/hooks/use-current-user.ts` | Current user session + role hook |
| `src/hooks/use-profiles.ts` | Team profiles hook |
| `src/hooks/use-mobile.tsx` | Mobile breakpoint detection |

---

*End of Page-by-Page Specification — 5 April 2026*
