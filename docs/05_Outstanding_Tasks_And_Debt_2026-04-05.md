# Vanto CRM — Outstanding Tasks & Technical Debt

**Date:** 5 April 2026  
**Version:** 1.0

---

## 1. Outstanding Features

### 1.1 High Priority

| # | Feature | Module | Description |
|---|---------|--------|-------------|
| 1 | **Chrome Web Store Publishing** | Extension | Package and publish extension to Chrome Web Store for easier distribution |
| 2 | **Sequence / Drip Campaigns** | Workflows | Multi-step automated message sequences with delay timers (Day 1 → Day 3 → Day 7) |
| 3 | **Contact Import (CSV)** | Contacts | Bulk import contacts from CSV with column mapping and dedup |
| 4 | **Stripe Payment Integration** | Integrations | Track payments and link to APLGO orders |
| 5 | **WhatsApp Template Messages** | Inbox | Pre-approved WhatsApp Business template messages for outside 24h window |

### 1.2 Medium Priority

| # | Feature | Module | Description |
|---|---------|--------|-------------|
| 6 | **Dashboard Date Range Filter** | Dashboard | Allow users to select custom date ranges for analytics |
| 7 | **Contact Tags Management UI** | Contacts | Dedicated tag management page with tag-based filtering |
| 8 | **Workflow Visual Builder** | Workflows | Drag-and-drop workflow step builder (currently JSON-only) |
| 9 | **Playbook Usage Analytics** | Playbooks | Charts showing which playbooks convert best |
| 10 | **Google Sheets Integration** | Integrations | Export/sync contacts to Google Sheets |

### 1.3 Low Priority / Future

| # | Feature | Module | Description |
|---|---------|--------|-------------|
| 11 | **Calendly Integration** | Integrations | Book meetings from contact detail view |
| 12 | **HubSpot Sync** | Integrations | Bidirectional contact sync with HubSpot |
| 13 | **Zapier Integration** | Integrations | Trigger Zaps from CRM events |
| 14 | **Multi-language Auto-Reply** | Auto-Reply | Detect language and respond in user's language |
| 15 | **Dark Mode Toggle** | UI | User-selectable dark/light mode (currently dark only) |

---

## 2. Technical Debt

### 2.1 Critical

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **Large component files** | `InboxModule.tsx` (933 lines), `SettingsModule.tsx` (827 lines), `GroupCampaignsModule.tsx` (528 lines) | Hard to maintain; should be split into sub-components |
| 2 | **No JWT verification on Edge Functions** | `supabase/config.toml` — all functions set `verify_jwt = false` | Security risk — should add JWT verification where appropriate |
| 3 | **Hardcoded Supabase URL in Chrome Extension** | `background.js` line 12 | Should use extension configuration or options page |
| 4 | **1000-row query limit** | `DashboardModule.tsx` lines 45-48 | Dashboard stats may be inaccurate for large datasets; needs pagination or server-side aggregation |

### 2.2 Moderate

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 5 | **No error boundary** | `App.tsx` | Unhandled errors crash the entire app |
| 6 | **Missing loading states** | Various modules | Some data fetches don't show loading indicators |
| 7 | **No optimistic updates** | Inbox, Contacts | UI waits for server response before updating |
| 8 | **Chrome Extension DOM selectors fragile** | `content.js` | WhatsApp Web DOM changes can break selectors without warning |
| 9 | **No automated E2E tests** | Project-wide | Only one example unit test exists |
| 10 | **Phone normalization duplicated** | `phone-utils.ts`, `send-message`, `twilio-whatsapp-inbound` | Same E.164 logic exists in 3+ places |

### 2.3 Minor

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 11 | **Unused notification bell** | `AppSidebar.tsx` | Notifications button has no backend implementation |
| 12 | **No pagination in contacts list** | `ContactsModule.tsx` | Performance degrades with 1000+ contacts |
| 13 | **Session-scoped AI Agent history** | `AIAgentModule.tsx` | Chat history lost on page refresh |
| 14 | **No file size limits** | Knowledge Vault upload | Large files could cause timeout during ingestion |

---

## 3. Known Bugs

| # | Bug | Module | Status | Description |
|---|-----|--------|--------|-------------|
| 1 | **Group campaign content script timeout** | Group Campaigns | Intermittent | Content script occasionally times out at various stages depending on WhatsApp Web load state |
| 2 | **Group name mismatch after rename** | Group Campaigns | Mitigated | If a WhatsApp group is renamed after capture, posts fail at `[select_group]` — requires re-capture |
| 3 | **Realtime subscription leak** | Inbox | Potential | Rapid conversation switching may leave orphaned Supabase Realtime channels |
| 4 | **Auto-reply double-send** | Auto-Reply | Rare | Under high load, duplicate auto-replies may be sent if the same inbound message triggers two function invocations |

---

## 4. Recommended Next Steps (Priority Order)

1. **Split large components**: Break `InboxModule.tsx`, `SettingsModule.tsx`, `GroupCampaignsModule.tsx` into smaller sub-components
2. **Add Error Boundaries**: Wrap module rendering in React Error Boundaries
3. **Enable JWT on sensitive Edge Functions**: At minimum `ai-settings-save`, `send-invitation`, `send-message`
4. **Server-side dashboard aggregation**: Create a database function for dashboard stats instead of client-side queries
5. **Automated E2E tests**: Add Playwright or Cypress tests for critical flows (auth, inbox send, contact CRUD)
6. **Chrome Extension options page**: Move Supabase URL and dashboard URL to configurable options
7. **Contact pagination**: Implement cursor-based pagination for contacts and conversations
8. **Shared phone normalization library**: Extract E.164 normalization into a shared Deno module for Edge Functions

---

## 5. Security Recommendations

| # | Recommendation | Priority |
|---|----------------|----------|
| 1 | Enable JWT verification on `send-message`, `ai-settings-save`, `send-invitation` Edge Functions | High |
| 2 | Add rate limiting to `save-contact` and `upsert-whatsapp-contact` | Medium |
| 3 | Implement CORS restrictions on Edge Functions (currently `*`) | Medium |
| 4 | Add input validation/sanitization on all Edge Function inputs | Medium |
| 5 | Rotate Twilio auth token periodically | Low |

---

*End of Outstanding Tasks & Technical Debt — 5 April 2026*
