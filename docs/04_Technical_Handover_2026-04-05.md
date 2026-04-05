# Vanto CRM — Technical Handover

**Date:** 5 April 2026  
**Version:** 2.0  
**Repository:** https://github.com/Vantovant/chat-friend-crm  
**Live URL:** https://chat.onlinecourseformlm.com  
**Platform:** Lovable Cloud (Supabase project ref: `nqyyvqcmcyggvlcswkio`)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React SPA)                   │
│  React 18 · TypeScript 5 · Vite 5 · Tailwind · shadcn   │
│  Deployed via Lovable Publish                            │
└──────────────────────┬──────────────────────────────────┘
                       │ Supabase JS Client
┌──────────────────────▼──────────────────────────────────┐
│              Lovable Cloud (Supabase)                     │
│  PostgreSQL · Auth · Edge Functions · Realtime · Storage │
│  Project: nqyyvqcmcyggvlcswkio                          │
└──────────┬───────────┬───────────┬──────────────────────┘
           │           │           │
     ┌─────▼───┐ ┌─────▼───┐ ┌────▼────┐
     │ Twilio  │ │ Lovable │ │  Zazi   │
     │WhatsApp │ │AI Gate- │ │  CRM    │
     │  API    │ │  way    │ │(webhook)│
     └─────────┘ └─────────┘ └─────────┘

┌─────────────────────────────────────────────────────────┐
│           Chrome Extension (Manifest V3)                 │
│  content.js → WhatsApp Web injection                    │
│  background.js → Service worker, polling, execution     │
│  popup.html → Login & settings                          │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Project Structure

```
/
├── src/
│   ├── App.tsx                          # Root with routes
│   ├── pages/
│   │   ├── Index.tsx                    # Main SPA shell (auth + module router)
│   │   ├── AcceptInvite.tsx             # Team invite acceptance
│   │   ├── ResetPassword.tsx            # Password reset
│   │   └── NotFound.tsx                 # 404
│   ├── components/
│   │   ├── vanto/                       # All CRM modules (13 modules)
│   │   │   ├── AppSidebar.tsx           # Navigation (desktop + mobile)
│   │   │   ├── AuthPage.tsx             # Login/signup/forgot
│   │   │   ├── DashboardModule.tsx      # Analytics dashboard
│   │   │   ├── InboxModule.tsx          # Shared WhatsApp inbox (933 lines)
│   │   │   ├── ContactsModule.tsx       # Contact management
│   │   │   ├── CRMModule.tsx            # Kanban pipeline
│   │   │   ├── AutomationsModule.tsx    # Automation rules
│   │   │   ├── AIAgentModule.tsx        # AI chat agent
│   │   │   ├── KnowledgeVaultModule.tsx # Knowledge document management
│   │   │   ├── PlaybooksModule.tsx      # Message templates
│   │   │   ├── WorkflowsModule.tsx      # Multi-step workflows
│   │   │   ├── GroupCampaignsModule.tsx  # Group campaign scheduler (528 lines)
│   │   │   ├── IntegrationsModule.tsx   # External service connections
│   │   │   ├── APIConsoleModule.tsx      # Developer tools
│   │   │   ├── SettingsModule.tsx        # Settings (827 lines)
│   │   │   ├── CopilotSidebar.tsx       # AI copilot in inbox
│   │   │   ├── PageHelpButton.tsx       # Per-page help
│   │   │   ├── MergeContactsModal.tsx   # Contact merge dialog
│   │   │   └── TwilioHealthPanel.tsx    # Twilio status
│   │   └── ui/                          # shadcn/ui components (40+ files)
│   ├── hooks/
│   │   ├── use-current-user.ts          # Session + role hook
│   │   ├── use-profiles.ts             # Team profiles
│   │   ├── use-mobile.tsx              # Mobile breakpoint
│   │   └── use-toast.ts               # Toast notifications
│   ├── lib/
│   │   ├── vanto-data.ts              # Types, APLGO labels, colors
│   │   ├── phone-utils.ts            # E.164 normalization
│   │   └── utils.ts                   # cn() utility
│   ├── integrations/supabase/
│   │   ├── client.ts                  # Auto-generated Supabase client
│   │   └── types.ts                   # Auto-generated DB types (read-only)
│   └── assets/
│       └── logo.jpg                   # Vanto CRM / Online Course For MLM logo
├── public/chrome-extension/
│   ├── manifest.json                  # Manifest V3
│   ├── content.js                     # WhatsApp Web injection (1528 lines, v6.2.5)
│   ├── background.js                  # Service worker (961 lines, v6.2.6)
│   ├── popup.html                     # Extension popup
│   ├── popup.js                       # Popup logic
│   ├── sidebar.css                    # Overlay styles
│   └── README.md                      # Extension documentation
├── supabase/
│   ├── config.toml                    # Edge function config (verify_jwt=false for all)
│   └── functions/                     # 21 Edge Functions
│       ├── twilio-whatsapp-inbound/   # Inbound webhook (Phase 7)
│       ├── twilio-whatsapp-status/    # Delivery status callbacks
│       ├── send-message/              # Outbound messaging (Phase 5 hardened)
│       ├── send-whatsapp-test/        # Test message sender
│       ├── whatsapp-auto-reply/       # AI auto-reply v3.0 (intent-driven)
│       ├── ai-chat/                   # AI agent chat
│       ├── ai-settings-save/          # AI config persistence
│       ├── knowledge-ingest/          # Document chunking
│       ├── knowledge-search/          # Full-text search
│       ├── page-help/                 # Context-aware help
│       ├── zazi-copilot/              # Zazi CRM copilot
│       ├── zazi-sync-pull/            # Pull from Zazi
│       ├── zazi-sync-push/            # Push to Zazi
│       ├── zazi-sync-bootstrap/       # Full initial sync
│       ├── zazi-sync-all/             # Sync all contacts
│       ├── push-to-zazi-webhook/      # Outbound Zazi webhook
│       ├── crm-webhook/               # Inbound CRM webhook
│       ├── save-contact/              # Chrome extension contact save
│       ├── upsert-whatsapp-contact/   # Upsert by WhatsApp ID
│       ├── send-invitation/           # Team invite emails
│       └── test-webhook/              # Webhook connectivity test
└── docs/                              # Documentation (this file)
```

---

## 3. Environment Variables

### Frontend (auto-provided by Lovable Cloud)
| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key |
| `VITE_SUPABASE_PROJECT_ID` | Project reference |

### Edge Function Secrets (configured in Lovable Cloud)
| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Internal Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations |
| `LOVABLE_API_KEY` | Lovable AI Gateway access (auto-provided) |
| `TWILIO_ACCOUNT_SID` | Twilio account identifier |
| `TWILIO_AUTH_TOKEN` | Twilio authentication |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio MessagingService for WhatsApp |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp sender number |
| `ZAZI_WEBHOOK_URL` | Zazi CRM webhook endpoint |
| `ZAZI_WEBHOOK_SECRET` | Zazi webhook authentication |

### Chrome Extension Constants (hardcoded in source)
| Constant | Value |
|----------|-------|
| `SUPABASE_URL` | `https://nqyyvqcmcyggvlcswkio.supabase.co` |
| `SUPABASE_ANON_KEY` | Anon key (publishable) |
| `DASHBOARD_URL` | `https://chat.onlinecourseformlm.com` |

---

## 4. Edge Function Details

### `twilio-whatsapp-inbound` (Phase 7)
- **Trigger**: Twilio POST webhook
- **Auth**: Twilio HMAC SHA-1 signature verification
- **Flow**: Parse formData → normalize phone → find/create contact → insert message → trigger auto-reply
- **Critical**: Uses `formData()` parsing to avoid URL-encoded artifacts in message Body

### `send-message` (Phase 5 Hardened)
- **Purpose**: Send outbound WhatsApp via Twilio
- **Routing**: Uses `MessagingServiceSid` (not From number)
- **Safety**: No dangerous fallbacks — fails loudly with structured error JSON
- **Error codes**: `TWILIO_63007`, `MISSING_SECRET`, `NORMALIZATION_FAILED`, etc.
- **Phone normalization**: Strict E.164 with South Africa-specific rules

### `whatsapp-auto-reply` (v3.0 Intent-Driven)
- **Purpose**: AI-powered auto-reply with Knowledge Vault RAG
- **Intent detection**: Menu numbers (1/2/3), business keywords, product keywords, greetings, freeform
- **Prompt translation**: "1" → "prices product information membership joining cost..."
- **AI model**: Gemini 2.5 Flash via Lovable AI Gateway
- **Rate limiting**: 3/day max, 10-min cooldown
- **Silence threshold**: 4 hours before re-sending welcome menu
- **Strict vs Assisted**: Products/Compensation/Orders = strict (no hallucination)

### `knowledge-ingest`
- **Purpose**: Upload and chunk knowledge files
- **Chunking**: 2000-character windows with overlap
- **Output**: Rows in `knowledge_chunks` with `tsvector` search column

### `knowledge-search`
- **Purpose**: Full-text search via `search_knowledge` RPC function
- **Supports**: Collection filtering, max results parameter

---

## 5. Database Key Details

### RLS Policy Model
- All tables have RLS enabled
- `has_role(_user_id, _role)` — security-definer function preventing recursion
- `is_admin_or_super_admin()` — convenience function
- `get_user_role()` — returns current user's role
- Contacts: authenticated users can CRUD
- Messages: authenticated users can read/insert
- Conversations: authenticated users can read/update

### Key RPC Functions
| Function | Purpose |
|----------|---------|
| `search_knowledge(query_text, collection_filter, max_results)` | Full-text search on knowledge_chunks |
| `has_role(_user_id, _role)` | Role check (security definer) |
| `is_admin_or_super_admin()` | Admin check shortcut |
| `get_user_role()` | Get current user's role |

### Realtime Subscriptions
| Table | Used By |
|-------|---------|
| `conversations` | Inbox (conversation list), Sidebar (unread count) |
| `messages` | Inbox (message thread) |

---

## 6. Chrome Extension Architecture (v6.2.5 / v6.2.6)

### Content Script (`content.js` — 1528 lines)
- Injects into `web.whatsapp.com`
- **Overlay sidebar**: `position: fixed`, never modifies WhatsApp layout
- **Contact detection**: Reads active chat name and phone from WhatsApp DOM
- **Group capture**: Detects group chats and saves to `whatsapp_groups` table
- **9-stage execution pipeline** for posting to groups:
  1. `open_search` (10s) — Open WhatsApp search bar
  2. `search_group` (15s) — Type group name
  3. `select_group` (8s) — Click matching result (fuzzy matching with `|` symbol handling)
  4. `wait_chat_open` (12s) — Wait for chat to load
  5. `find_input` (10s) — Locate message input box
  6. `inject_message` (8s) — Set message text
  7. `find_send_button` (10s) — Find send button
  8. `click_send` (8s) — Click send
  9. `confirm_sent` (12s) — Verify message appeared

### Background Service Worker (`background.js` — 961 lines)
- **Heartbeat**: 60-second interval → writes `ext_heartbeat_at` to `integration_settings`
- **Polling**: Checks `scheduled_group_posts` for pending posts every 60 seconds
- **Execution**: Sends execute command to content script, handles 90s total timeout
- **Self-healing injection**: Re-injects content script if tab is discarded or reloaded
- **Session management**: Stores Supabase JWT in `chrome.storage.local`

### Group Name Matching
- Raw name stored as-is (e.g., `APLGO | Health and Biz`)
- Normalized name: lowercase, strip symbols (`|`, `•`, `~`, `-`), collapse whitespace
- Search uses raw name first, falls back to normalized matching
- Handles renamed groups and special characters

---

## 7. Deployment

### Frontend
- Deployed via **Lovable Publish** (automatic)
- Custom domain: `chat.onlinecourseformlm.com`
- Builds with Vite 5

### Edge Functions
- Auto-deployed by Lovable Cloud on code change
- All functions configured with `verify_jwt = false` in `supabase/config.toml`
- Runtime: Deno (Supabase Edge Functions)

### Chrome Extension
- Manual installation via `chrome://extensions` → Load unpacked
- Source in `public/chrome-extension/`
- Not published to Chrome Web Store

### Database Migrations
- Managed via Lovable Cloud migration tool
- Migration files in `supabase/migrations/` (read-only)

---

## 8. Testing

### Manual Smoke Test Checklist
1. **Auth**: Login → Dashboard loads → Logout → Re-login
2. **Contacts**: Add contact → appears in list → edit → soft-delete
3. **Inbox**: Open conversation → send message → verify status updates
4. **Auto-Reply**: Send WhatsApp to Twilio number → receive welcome menu → reply "1" → get AI answer
5. **Group Campaign**: Capture group → schedule post → verify execution
6. **Knowledge Vault**: Upload file → search → verify chunks
7. **CRM**: Drag contact between pipeline stages
8. **Settings**: Invite team member → verify invitation email

### Automated Tests
- Test framework: Vitest + Testing Library
- Config: `vitest.config.ts`
- Example test: `src/test/example.test.ts`

---

## 9. Known Integration Points

| External Service | Integration Method | Auth |
|------------------|-------------------|------|
| Twilio WhatsApp | REST API + Webhooks | Account SID + Auth Token |
| Lovable AI Gateway | REST API | LOVABLE_API_KEY (auto-provided) |
| Zazi CRM | Webhooks (bidirectional) | x-webhook-secret header |
| Chrome Extension | Supabase direct (anon key) | JWT stored in chrome.storage.local |

---

*End of Technical Handover — 5 April 2026*
