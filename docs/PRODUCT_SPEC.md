# Vanto CRM — Product Specification

**Version:** 1.0  
**Date:** March 2026  
**Product:** Vanto CRM — WhatsApp AI CRM for MLM & APLGO Associates

---

## 1. Executive Summary

Vanto CRM is a production-grade, AI-powered WhatsApp CRM purpose-built for MLM (Multi-Level Marketing) professionals and APLGO associates. It centralizes lead management, WhatsApp conversations, pipeline tracking, and AI-driven automations into a single unified platform.

The platform combines a web-based dashboard with a Chrome extension that overlays onto WhatsApp Web, enabling real-time contact capture and CRM operations without leaving WhatsApp.

---

## 2. Target Users

| Persona | Description |
|---------|-------------|
| **MLM Associate** | Independent distributor managing prospects, customers, and team members |
| **Team Leader** | Manages a downline team, needs visibility into pipeline health |
| **Admin / Super Admin** | Manages the CRM instance, team roles, integrations, and AI settings |

---

## 3. Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Supabase (Lovable Cloud) — PostgreSQL, Auth, Edge Functions, Realtime |
| Messaging | Twilio WhatsApp Business API |
| AI | Lovable AI (Google Gemini, OpenAI GPT-5 family) + BYO API Key option |
| Browser Extension | Chrome Manifest V3 |
| External CRM | Zazi CRM (webhook-based sync) |

---

## 4. Core Modules

### 4.1 Dashboard
- **Purpose:** Centralized analytics and KPI overview — the default landing page after login.
- **Features:**
  - Total contacts, conversations, messages, and unread count cards
  - Lead temperature breakdown (hot / warm / cold) with color-coded indicators
  - Messages-per-day area chart (7-day trend)
  - Leads-by-type pie chart (Prospect, Registered, Buyer, VIP, Expired)
  - Recent activity feed from `contact_activity` table
  - Active conversations counter
- **Data Source:** Real-time queries against `contacts`, `conversations`, `messages`, and `contact_activity` tables.

### 4.2 Inbox (Shared WhatsApp Inbox)
- **Purpose:** Unified WhatsApp conversation hub with real-time messaging.
- **Features:**
  - Conversation list with contact name, last message preview, timestamp, and unread badge
  - Search and filter conversations
  - Real-time message thread view (inbound + outbound)
  - Send messages via Twilio WhatsApp Business API
  - AI Copilot sidebar for real-time reply suggestions
  - Contact detail panel (temperature, lead type, tags, notes)
  - Conversation assignment to team members
  - Mark as read / unread
  - Re-send failed messages
- **Real-time:** Supabase Realtime subscriptions on `conversations` and `messages` tables.
- **AI Copilot:** Context-aware reply suggestions powered by Knowledge Vault content.

### 4.3 Contacts
- **Purpose:** Full contact database with CRUD, filtering, bulk actions, and activity history.
- **Features:**
  - Contact list with search, filter by temperature/lead type/interest
  - Add / edit / soft-delete contacts
  - Bulk select with bulk delete, bulk tag, bulk export (CSV)
  - Merge duplicate contacts (manual + auto-detect by phone number)
  - Contact detail drawer with notes, tags, assignment, activity log
  - Phone normalization to E.164 format
  - Deduplication via `phone_normalized` and `whatsapp_id`
  - Soft delete with `is_deleted` flag and `deleted_at` timestamp
- **Upsert Logic:** `onConflict: phone_number` to prevent duplicates.

### 4.4 CRM (Pipeline / Kanban)
- **Purpose:** Visual drag-and-drop pipeline for lead progression tracking.
- **Features:**
  - Kanban board with configurable pipeline stages from `pipeline_stages` table
  - Drag contacts between stages
  - Filter by lead type (Prospect, Registered, Buyer, VIP, Expired)
  - Add new deals directly to stages
  - Stage statistics (count per stage)
  - Contact cards showing name, phone, temperature badge, lead type badge

### 4.5 Automations
- **Purpose:** Rule-based automation engine for CRM actions.
- **Features:**
  - Create automations with trigger → action pairs
  - Trigger options: new contact, lead type change, temperature change, inbound message, tag added, stage change
  - Action options: send WhatsApp template, assign to agent, change temperature, add tag, move pipeline stage, notify team
  - Toggle active/inactive
  - Run count and last-run tracking
  - Create / edit / delete automations

### 4.6 AI Agent
- **Purpose:** Conversational AI assistant for CRM intelligence.
- **Features:**
  - Chat interface with Vanto AI
  - Suggested prompts (follow-up drafts, pipeline analysis, lead scoring, campaign messages)
  - Context-aware responses using CRM data
  - Knowledge Vault integration for accurate product/business information
  - Message history within session

### 4.7 Knowledge Vault
- **Purpose:** Document management system for AI-grounded responses.
- **Features:**
  - 6 collections: General Knowledge, Business Opportunity, Compensation, Product Prices, Orders & Deliveries, MLM Motivation
  - Two modes: `strict` (AI must quote verbatim) and `assisted` (AI can paraphrase)
  - File upload (text/plain, markdown) with chunking and indexing
  - Paste-as-text for quick content ingestion
  - Full-text search via `search_knowledge` RPC function
  - File versioning, effective dates, expiry dates
  - Status tracking: processing → ready → error
  - Delete files and associated chunks
- **Search:** PostgreSQL full-text search with `tsvector` on `knowledge_chunks`.

### 4.8 Playbooks
- **Purpose:** Curated message templates and scripts for sales conversations.
- **Features:**
  - Categorized playbooks (cold outreach, follow-up, closing, onboarding)
  - Version tracking
  - Usage count and conversion count analytics
  - Approval workflow
  - Create / edit / delete playbooks

### 4.9 Workflows
- **Purpose:** Multi-step automated sequences.
- **Features:**
  - Define multi-step workflows with JSON step definitions
  - Assign contacts to workflows
  - Active/inactive toggle
  - Contact count tracking

### 4.10 Integrations
- **Purpose:** Connect external services to Vanto CRM.
- **Active Integrations:**
  - **WhatsApp Business (Twilio):** Send/receive via Twilio API with MessagingServiceSid. Twilio Health Panel for connection status monitoring.
  - **Chrome Extension:** Install instructions for WhatsApp Web sidebar overlay.
  - **Zazi CRM:** Webhook-based contact sync (inbound + outbound push). Bootstrap sync for initial import.
  - **OpenAI:** BYO API key for AI features.
- **Planned:** Stripe, Zapier, Google Sheets, Calendly, HubSpot.
- **Features:**
  - Twilio Health Panel (account SID verification, webhook URL display, test message sender)
  - Zazi sync controls (pull, push, bootstrap)
  - Webhook event log viewer
  - Copy-paste endpoint URLs

### 4.11 API Console
- **Purpose:** Developer tools for testing edge functions and API endpoints.

### 4.12 Settings
- **Purpose:** Account and system configuration.
- **Sections:**
  - **Profile:** Edit name, email, phone
  - **Team:** Invite members via email, manage roles (agent / admin / super_admin), view pending invitations
  - **AI Provider:** Configure BYO API keys (OpenAI, etc.), select model, enable/disable
  - **Auto-Reply:** Configure WhatsApp auto-reply behavior (welcome message, menu options, knowledge-based responses)
  - **Notifications:** Toggle alert preferences
  - **Security:** Password management

---

## 5. Authentication & Authorization

| Feature | Implementation |
|---------|---------------|
| Auth method | Email/password via Supabase Auth |
| Email confirmation | Disabled (auto-confirm enabled) |
| Session management | Supabase JWT tokens |
| Role system | Separate `user_roles` table with `app_role` enum: `agent`, `admin`, `super_admin` |
| RLS | All tables protected with Row-Level Security policies |
| Role checks | `has_role()` security-definer function to prevent RLS recursion |

---

## 6. Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `contacts` | Lead/contact records with phone normalization, temperature, lead type, tags |
| `conversations` | WhatsApp conversation threads linked to contacts |
| `messages` | Individual messages (inbound/outbound) with delivery status tracking |
| `profiles` | User profile data (name, email, phone, avatar) |
| `user_roles` | Role assignments (agent, admin, super_admin) |
| `pipeline_stages` | CRM pipeline stage definitions |
| `automations` | Automation rules (trigger → action) |
| `playbooks` | Message templates and scripts |
| `workflows` | Multi-step workflow definitions |
| `contact_activity` | Activity log per contact |

### AI & Knowledge Tables

| Table | Purpose |
|-------|---------|
| `knowledge_files` | Uploaded knowledge documents with collection, mode, versioning |
| `knowledge_chunks` | Chunked text with full-text search vector |
| `ai_suggestions` | AI-generated reply suggestions per conversation |
| `ai_citations` | Source citations linking suggestions to knowledge chunks |
| `ai_feedback` | User feedback on AI suggestions (rating, edits) |
| `user_ai_settings` | Per-user AI provider configuration |
| `learning_metrics` | Weekly AI performance metrics |

### Integration Tables

| Table | Purpose |
|-------|---------|
| `integration_settings` | Key-value store for integration config |
| `webhook_events` | Inbound/outbound webhook event log |
| `sync_runs` | Sync operation audit log |
| `zazi_sync_jobs` | Zazi CRM sync job queue with retry tracking |
| `invitations` | Team member invitation records |
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

## 7. Edge Functions (Backend)

| Function | Purpose | Auth |
|----------|---------|------|
| `twilio-whatsapp-inbound` | Twilio webhook for inbound WhatsApp messages | Twilio signature verification |
| `twilio-whatsapp-status` | Twilio delivery status callbacks | No JWT |
| `send-message` | Send outbound WhatsApp messages via Twilio | No JWT |
| `send-whatsapp-test` | Send test WhatsApp message | No JWT |
| `whatsapp-auto-reply` | AI-powered auto-reply engine | No JWT |
| `ai-chat` | AI Agent chat endpoint | No JWT |
| `ai-settings-save` | Save AI provider settings | No JWT |
| `knowledge-ingest` | Ingest and chunk knowledge files | No JWT |
| `knowledge-search` | Full-text search across knowledge chunks | No JWT |
| `page-help` | Context-aware page help and AI Q&A | No JWT |
| `zazi-copilot` | Zazi CRM copilot | No JWT |
| `zazi-sync-pull` | Pull contacts from Zazi CRM | No JWT |
| `zazi-sync-push` | Push contacts to Zazi CRM | No JWT |
| `zazi-sync-bootstrap` | Initial full sync from Zazi | No JWT |
| `zazi-sync-all` | Sync all contacts | No JWT |
| `push-to-zazi-webhook` | Outbound webhook to Zazi | No JWT |
| `crm-webhook` | Inbound CRM webhook | Webhook secret header |
| `save-contact` | Save contact from Chrome extension | No JWT |
| `upsert-whatsapp-contact` | Upsert contact by WhatsApp ID | No JWT |
| `send-invitation` | Send team invitation email | No JWT |
| `test-webhook` | Test webhook connectivity | No JWT |

---

## 8. Chrome Extension

- **Type:** Manifest V3
- **Injection Target:** WhatsApp Web (`web.whatsapp.com`)
- **Behavior:** Overlay sidebar (position: fixed) — never modifies WhatsApp layout
- **Features:**
  - Detects active chat contact name and phone from DOM
  - Save contact to Supabase via `save-contact` edge function
  - Add notes to contacts
  - AI reply suggestions
  - Temperature and pipeline stage badges
  - Link to full Vanto CRM dashboard

---

## 9. WhatsApp Messaging Flow

```
Inbound:
WhatsApp → Twilio → twilio-whatsapp-inbound → Create/find contact → Insert message → Update conversation → Trigger auto-reply

Outbound:
User types in Inbox → send-message → Twilio API → WhatsApp → twilio-whatsapp-status callback → Update message status
```

### Auto-Reply Flow
1. Inbound message received
2. `whatsapp-auto-reply` function invoked
3. Check auto-reply settings (`integration_settings`)
4. If welcome message enabled → send welcome template
5. If menu detected → process menu option
6. If knowledge search enabled → search Knowledge Vault → generate AI response
7. Log event to `auto_reply_events`

---

## 10. Lead Classification System

### Lead Types (MLM-specific)
| Type | Label | Description |
|------|-------|-------------|
| `prospect` | Prospect | New lead, not yet registered |
| `registered` | Registered_Nopurchase | Registered but no purchase |
| `buyer` | Purchase_Nostatus | Made a purchase, no active status |
| `vip` | Purchase_Status | Active purchase + status holder |
| `expired` | Expired | Lapsed/expired membership |

### Temperature
| Level | Meaning |
|-------|---------|
| Hot | Highly engaged, ready to convert |
| Warm | Moderately interested |
| Cold | Low engagement, needs nurturing |

### Interest Level
| Level | Meaning |
|-------|---------|
| High | Actively asking questions |
| Medium | Responds occasionally |
| Low | Minimal engagement |

---

## 11. Security

- All database tables protected by Row-Level Security (RLS)
- Roles stored in separate `user_roles` table (never on `profiles`)
- `has_role()` security-definer function prevents RLS recursion
- Twilio webhook signature verification on inbound messages
- Zazi webhook protected by `x-webhook-secret` header
- No mock login or localStorage-based auth
- All auth via Supabase JWT
- Secrets stored as environment variables, never in code

---

## 12. Responsive Design

- Full desktop sidebar navigation (collapsible)
- Mobile bottom navigation bar for core modules (Dashboard, Inbox, Contacts, CRM, Settings)
- Mobile-optimized conversation views
- Touch-friendly Kanban drag-and-drop

---

## 13. Real-time Features

- Inbox conversation list updates via Supabase Realtime
- Message thread live updates
- Sidebar unread badge count synchronized in real-time
- Conversation metadata (last message, unread count) auto-updated

---

## 14. Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Active | Stable CRM Dashboard |
| Phase 2 | ✅ Active | Chrome Extension |
| Phase 3 | ✅ Active | WhatsApp Business API (Twilio) |
| Phase 4 | 🔄 In Progress | AI Automation Layer |

---

*End of Product Specification*
