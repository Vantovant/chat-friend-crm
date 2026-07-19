# Vanto CRM — Product Specification

**Version:** 2.0  
**Date:** 5 April 2026  
**Product:** Vanto CRM — WhatsApp AI CRM for MLM & APLGO Associates  
**Live URL:** https://chat.onlinecourseformlm.com  
**Repository:** https://github.com/Vantovant/chat-friend-crm

---

## 1. Executive Summary

Vanto CRM is a production-grade, AI-powered WhatsApp CRM purpose-built for MLM professionals and APLGO associates. It centralizes lead management, WhatsApp conversations (shared inbox with reply capabilities), pipeline tracking, group campaigns, and AI-driven automations into a single unified platform.

The platform combines:
- A **web-based dashboard** (React SPA) at `chat.onlinecourseformlm.com`
- A **Chrome extension** (Manifest V3) for WhatsApp Web overlay, group capture, and scheduled post execution
- **AI auto-reply** powered by Lovable AI (Gemini) with Knowledge Vault RAG
- **Twilio WhatsApp Business API** for production messaging

---

## 2. Target Users

| Persona | Description |
|---------|-------------|
| **MLM Associate** | Independent APLGO distributor managing prospects, customers, and team members |
| **Team Leader** | Manages a downline team, needs visibility into pipeline health |
| **Admin / Super Admin** | Manages the CRM instance, team roles, integrations, and AI settings |

---

## 3. Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript 5, Vite 5, Tailwind CSS v3, shadcn/ui |
| Backend | Lovable Cloud (Supabase) — PostgreSQL, Auth, Edge Functions, Realtime |
| Messaging | Twilio WhatsApp Business API (MessagingServiceSid routing) |
| AI | Lovable AI Gateway (`ai.gateway.lovable.dev`) — Google Gemini 2.5 Flash + BYO API Key option |
| Browser Extension | Chrome Manifest V3 (content script + service worker) |
| External CRM | Zazi CRM (webhook-based sync) |
| State Management | TanStack React Query v5 |
| Charts | Recharts |
| Routing | React Router DOM v6 (SPA, single `/` route with module switching) |

---

## 4. APLGO Lead Classification System

### 4.1 Lead Types (MLM Levels)

| DB Value | Display Label | Description |
|----------|---------------|-------------|
| `prospect` | Prospect | New lead, not yet registered with APLGO |
| `registered` | Registered_Nopurchase | Registered with APLGO but no purchase yet |
| `buyer` | Purchase_Nostatus | Made a purchase, no active GO-Status |
| `vip` | Purchase_Status | Active purchase + GO-Status holder |
| `expired` | Expired | Lapsed/expired APLGO membership |

### 4.2 Temperature

| Level | Meaning | Color |
|-------|---------|-------|
| Hot | Highly engaged, ready to convert | Red `hsl(0, 84%, 60%)` |
| Warm | Moderately interested | Amber `hsl(38, 96%, 56%)` |
| Cold | Low engagement, needs nurturing | Blue `hsl(217, 91%, 60%)` |

### 4.3 Interest Level

| Level | Meaning |
|-------|---------|
| High | Actively asking questions |
| Medium | Responds occasionally |
| Low | Minimal engagement |

---

## 5. Core Modules

### 5.1 Dashboard
- KPI cards: total contacts, conversations, messages, unread count
- Lead temperature breakdown (hot/warm/cold) with color indicators
- Messages-per-day area chart (7-day trend)
- Leads-by-type pie chart (5 APLGO types)
- Recent activity feed from `contact_activity`
- Active conversations counter

### 5.2 Shared Inbox (Reply Inbox)
- Conversation list with contact name, last message, timestamp, unread badge
- **Reply capability**: send outbound WhatsApp messages via Twilio
- Real-time message thread (inbound + outbound) via Supabase Realtime
- Message status tracking: queued → sent → delivered → read → failed
- AI Copilot sidebar for real-time reply suggestions
- Contact detail panel (temperature, lead type, tags, notes)
- Conversation assignment to team members
- Filter: All accessible / Mine / Unassigned
- Re-send failed messages
- Template message quick-send
- 24-hour WhatsApp session window awareness

### 5.3 Contacts
- Full CRUD with search, filter by temperature/lead type/interest
- Bulk select: delete, tag, export CSV
- Merge duplicate contacts (manual + auto-detect by phone)
- Contact detail drawer with notes, tags, assignment, activity log
- Phone normalization to E.164 format
- Deduplication via `phone_normalized` and `whatsapp_id`
- Soft delete with `is_deleted` flag

### 5.4 CRM Pipeline (Kanban)
- Drag-and-drop Kanban board with configurable stages from `pipeline_stages`
- Filter by APLGO lead type
- Stage statistics and contact cards with temperature/type badges

### 5.5 Group Campaigns
- **Chrome Extension Health Panel**: live heartbeat, WhatsApp Web readiness
- Smart Bulk Campaign scheduler with shadcn Calendar popover
- Date range selection with time slots (Morning 08:00, Mid-day 13:00, Evening 18:00)
- WhatsApp group capture via Chrome Extension
- 9-stage execution pipeline (open_search → confirm_sent)
- Retry failed posts with full diagnostic details
- Status tracking: pending → executing → sent → failed

### 5.6 Automations
- Trigger → Action rule pairs
- Triggers: new contact, lead type change, temperature change, inbound message, tag added, stage change
- Actions: send template, assign agent, change temperature, add tag, move stage, notify team
- Toggle active/inactive, run count tracking

### 5.7 AI Agent
- Chat interface with Vanto AI (Gemini 2.5 Flash via Lovable AI Gateway)
- Suggested prompts for follow-ups, pipeline analysis, lead scoring
- Knowledge Vault integration for grounded responses

### 5.8 Knowledge Vault
- 6 collections: General Knowledge, Business Opportunity, Compensation, Product Prices, Orders & Deliveries, MLM Motivation
- Two modes: `strict` (verbatim only) and `assisted` (paraphrase allowed)
- File upload (text/markdown) with chunking (2000-char window)
- Full-text search via `search_knowledge` RPC
- Used by AI auto-reply for RAG-based answers

### 5.9 Playbooks
- Categorized message templates (cold outreach, follow-up, closing, onboarding)
- Usage count and conversion count analytics
- Approval workflow

### 5.10 Workflows
- Multi-step automated sequences with JSON step definitions
- Contact assignment and active/inactive toggle

### 5.11 Integrations
- **Twilio WhatsApp**: Health panel, webhook URLs, test message sender
- **Chrome Extension**: Install instructions and connection status
- **Zazi CRM**: Webhook sync (pull/push/bootstrap)
- **OpenAI**: BYO API key support

### 5.12 API Console
- Developer tools for testing edge functions and API endpoints

### 5.13 Settings
- **Profile**: Edit name, email, phone
- **Team**: Invite members via email, manage roles (agent/admin/super_admin)
- **AI Provider**: Configure BYO API keys, select model
- **Auto-Reply**: Configure welcome message, menu options, knowledge-based responses
- **Notifications**: Toggle alert preferences
- **Security**: Password management

---

## 6. WhatsApp Messaging Architecture

### 6.1 Inbound Flow
```
WhatsApp User → Twilio → twilio-whatsapp-inbound Edge Function
  → Parse formData (avoid URL encoding artifacts)
  → Verify Twilio signature (HMAC SHA-1)
  → Normalize phone to E.164
  → Find or create contact + conversation
  → Insert message (is_outbound=false)
  → Update conversation metadata
  → Trigger whatsapp-auto-reply
```

### 6.2 Outbound Flow (Shared Inbox Reply)
```
Agent types in Inbox → send-message Edge Function
  → Normalize phone to E.164
  → Send via Twilio API (MessagingServiceSid routing)
  → Insert message (is_outbound=true, status=queued)
  → twilio-whatsapp-status callback → Update status
```

### 6.3 AI Auto-Reply Flow (v3.0 — Intent-Driven)
```
Inbound message received
  → whatsapp-auto-reply Edge Function
  → Normalize text, detect intent:
      "1" → Prices & Product info (strict mode, products+opportunity collections)
      "2" → How to use / Benefits (strict mode, products+general collections)  
      "3" → Human handover message
      Business keywords → Search opportunity+general collections
      Product keywords → Search products collection (strict)
      Greeting → Send welcome menu
      Freeform → Search all collections (assisted)
  → Rate limiting: max 3 auto-replies/day, 10-min cooldown
  → 4-hour silence threshold for re-sending welcome menu
  → Search Knowledge Vault via search_knowledge RPC
  → Generate AI answer via Lovable AI Gateway (Gemini 2.5 Flash)
  → Send response via send-message Edge Function
  → Log to auto_reply_events
```

---

## 7. Authentication & Authorization

| Feature | Implementation |
|---------|---------------|
| Auth method | Email/password via Supabase Auth |
| Email confirmation | Auto-confirm enabled |
| Session management | Supabase JWT tokens |
| Role system | Separate `user_roles` table with enum: `agent`, `admin`, `super_admin` |
| RLS | All tables protected with Row-Level Security |
| Role checks | `has_role()` security-definer function |
| Team invites | `send-invitation` Edge Function + `invitations` table |

---

## 8. Database Schema Summary

### Core Tables
| Table | Purpose |
|-------|---------|
| `contacts` | Leads with phone normalization, temperature, APLGO lead type, tags |
| `conversations` | WhatsApp threads linked to contacts |
| `messages` | Individual messages with delivery status tracking |
| `profiles` | User profile data |
| `user_roles` | Role assignments (agent/admin/super_admin) |
| `pipeline_stages` | CRM pipeline stage definitions |
| `automations` | Trigger → Action rules |
| `playbooks` | Message templates |
| `workflows` | Multi-step sequences |
| `contact_activity` | Activity log per contact |

### Group Campaigns Tables
| Table | Purpose |
|-------|---------|
| `whatsapp_groups` | Captured WhatsApp groups with group_jid |
| `scheduled_group_posts` | Scheduled posts with status, failure_reason, attempt tracking |

### AI & Knowledge Tables
| Table | Purpose |
|-------|---------|
| `knowledge_files` | Uploaded knowledge documents |
| `knowledge_chunks` | Chunked text with full-text search vector |
| `ai_suggestions` | AI reply suggestions per conversation |
| `ai_citations` | Source citations from knowledge chunks |
| `ai_feedback` | User feedback on AI suggestions |
| `user_ai_settings` | Per-user AI provider config |
| `learning_metrics` | Weekly AI performance metrics |

### Integration Tables
| Table | Purpose |
|-------|---------|
| `integration_settings` | Key-value config store (extension heartbeat, Twilio config) |
| `webhook_events` | Webhook event log |
| `sync_runs` | Sync operation audit log |
| `zazi_sync_jobs` | Zazi CRM sync job queue |
| `invitations` | Team member invitations |
| `auto_reply_events` | Auto-reply action audit log |

### Enums
| Enum | Values |
|------|--------|
| `lead_temperature` | hot, warm, cold |
| `lead_type` | prospect, registered, buyer, vip, expired |
| `interest_level` | high, medium, low |
| `comm_status` | active, closed, pending |
| `message_status` | sent, delivered, read, queued, failed |
| `message_type` | text, image, ai |
| `user_role` | agent, admin, super_admin |

---

## 9. Chrome Extension (v6.2.5+)

- **Manifest V3** with service worker architecture
- **Content script** injects into `web.whatsapp.com`
- **Overlay sidebar** (position: fixed) — never modifies WhatsApp layout
- **Heartbeat engine**: 60-second interval reporting to `integration_settings`
- **Group capture**: Detects WhatsApp groups with raw name + normalized name storage
- **9-stage execution pipeline** for group campaign posts with per-stage timeouts
- **Self-healing injection**: automatic re-injection if content script disconnects

---

## 10. Real-time Features

- Inbox conversation list via Supabase Realtime (`conversations` table)
- Message thread live updates (`messages` table)
- Sidebar unread badge synchronized in real-time
- Extension heartbeat polling

---

## 11. Security

- All tables RLS-protected
- Roles in separate `user_roles` table (never on `profiles`)
- `has_role()` / `is_admin_or_super_admin()` security-definer functions
- Twilio webhook signature verification (HMAC SHA-1)
- Zazi webhook protected by `x-webhook-secret` header
- No mock login or localStorage-based auth
- Secrets via environment variables only
- `send-message` uses MessagingServiceSid with no dangerous fallbacks

---

## 12. Responsive Design

- Desktop: collapsible sidebar navigation (52 → 16 width units)
- Mobile: top bar + bottom navigation bar (Dashboard, Inbox, Contacts, CRM, Settings)
- Full-screen mobile drawer for all modules
- Touch-friendly controls

---

*End of Product Specification — 5 April 2026*
