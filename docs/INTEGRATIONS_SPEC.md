# Integrations Module — Detailed Specification

> Module: Integrations  
> File: `src/components/vanto/IntegrationsModule.tsx` (422 lines)  
> Last Updated: 2026-03-13

---

## 1. Purpose

Central hub for managing all third-party connections, webhook configuration, Twilio health monitoring, and bidirectional CRM sync operations between Vanto CRM and external systems.

---

## 2. Architecture

| Layer | Detail |
|-------|--------|
| Component | `IntegrationsModule` |
| Data Source | `integration_settings` table (key-value pairs) |
| Auth | RLS-protected; settings readable by all authenticated users, writable by admins |
| Edge Functions | `push-to-zazi-webhook`, `test-webhook` |
| Sub-Components | `CopyField`, `EditableField`, `ResultBadge`, `TwilioHealthPanel` |

---

## 3. Integration Registry

Nine integrations defined in the `integrationDefs` array:

| ID | Name | Category | Description |
|----|------|----------|-------------|
| `whatsapp` | WhatsApp Business | Messaging | Send and receive WhatsApp messages via Twilio |
| `chrome` | Chrome Extension | Browser | Inject CRM sidebar into WhatsApp Web |
| `openai` | OpenAI GPT-4 | AI | Power AI responses and suggestions |
| `zazi` | Zazi CRM | CRM | Inbound webhook sync with Zazi CRM contacts |
| `stripe` | Stripe | Payments | Accept payments from WhatsApp leads |
| `zapier` | Zapier | Automation | Connect to 5000+ apps via Zapier |
| `sheets` | Google Sheets | Productivity | Sync contacts with Google Sheets |
| `calendly` | Calendly | Scheduling | Let leads book calls directly |
| `hubspot` | HubSpot CRM | CRM | Sync deals with HubSpot |

**Status Storage:** Each integration's status stored as `integration_{id}` key in `integration_settings` table with values `connected` or `disconnected`.

**Toggle Behavior:** Clicking Connect/Disconnect calls `saveSetting()` → upserts to `integration_settings`.

---

## 4. Chrome Extension Panel

### 4.1 Highlight Card
- Prominent card with primary gradient border
- "Install Extension" CTA button
- `NEW` badge

### 4.2 Installation Modal
Four-step manual installation guide:
1. Open Chrome → `chrome://extensions`
2. Enable `Developer mode` toggle
3. Click `Load unpacked` → select extension folder
4. Open WhatsApp Web — sidebar appears automatically

---

## 5. Twilio WhatsApp Health Panel

- Embedded `<TwilioHealthPanel />` component
- Displays real-time health status of WhatsApp Business API connection
- Shows: Account SID, Messaging Service SID, phone number configuration
- Visual health indicators (green/red status dots)

---

## 6. Inbound Webhook (Zazi → Vanto)

### 6.1 Editable Configuration
| Field | Settings Key | Purpose |
|-------|-------------|---------|
| Endpoint URL | `inbound_webhook_url` | Where Zazi sends data |
| Webhook Secret | `inbound_webhook_secret` | `x-webhook-secret` header value |
| User ID | Read-only | Current user's UUID for payload body |

### 6.2 Supported Actions
| Action | Description |
|--------|-------------|
| `sync_contacts` | Bulk upsert array of contacts by phone (idempotent) |
| `upsert_contact` | Create or update a single contact |
| `log_chat` | Log a WhatsApp message & create a conversation |

### 6.3 Test Button
- Invokes `test-webhook` edge function
- Simulates sample contact upsert
- Displays result as success (green) or failure (red) badge with details

---

## 7. Outbound Push (Vanto → Zazi)

### 7.1 Editable Configuration
| Field | Settings Key |
|-------|-------------|
| Zazi Webhook URL | `outbound_webhook_url` |
| Zazi Webhook Secret | `outbound_webhook_secret` |

### 7.2 Pre-Push Data Validation
Runs automatically before every push. Blocks push if issues found:

| Check | Condition |
|-------|-----------|
| Duplicate phones | Multiple contacts with same `phone_normalized` |
| Missing identity | Contacts with neither `phone_normalized` nor `email` |
| Short phone numbers | `phone_normalized` with < 10 digits |

Issues displayed in a red alert box with dismiss option.

### 7.3 Push Flow
1. Pre-validation passes → calls `push-to-zazi-webhook` edge function
2. On success: displays `ResultBadge` with synced/skipped/total counts
3. On 401/unauthorized: shows "Secret Mismatch" amber alert with remediation steps
4. Last push time and result persisted in component state

---

## 8. UI Sub-Components

| Component | Props | Purpose |
|-----------|-------|---------|
| `CopyField` | `label`, `value`, `mono` | Read-only field with clipboard copy button |
| `EditableField` | `label`, `value`, `onChange`, `onSave`, `saving`, `type` | Inline-editable field with save button and loading spinner |
| `ResultBadge` | `result: SyncResult` | Colored badge showing sync results (synced/skipped/total/errors) |

---

## 9. Database Schema

### `integration_settings` Table
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | PK |
| `key` | text | — | Unique setting identifier |
| `value` | text | `''` | Setting value |
| `updated_at` | timestamptz | `now()` | Last modification |
| `updated_by` | uuid | null | User who last updated |
| `last_synced_at` | timestamptz | null | Zazi sync timestamp |

### RLS Policies
| Policy | Command | Rule |
|--------|---------|------|
| Admins can manage | ALL | `is_admin_or_super_admin()` |
| Authenticated can view | SELECT | `auth.uid() IS NOT NULL` |

---

## 10. State Management

| State Variable | Type | Purpose |
|----------------|------|---------|
| `settings` | `Record<string, string>` | All settings from DB |
| `loadingSettings` | boolean | Initial load spinner |
| `savingKey` | string \| null | Which field is currently saving |
| `pushing` | boolean | Push-to-Zazi in progress |
| `lastPushResult` | SyncResult \| null | Last push outcome |
| `zaziSecretMismatch` | boolean | 401 error detected |
| `testing` | boolean | Webhook test in progress |
| `testResult` | `{ ok, message }` \| null | Test outcome |
| `dataIssues` | string[] \| null | Pre-push validation issues |

---

## 11. Data Flow Diagram

```
┌──────────────┐     POST /crm-webhook      ┌──────────────┐
│   Zazi CRM   │ ─────────────────────────▶  │  Vanto CRM   │
│  (External)  │     x-webhook-secret        │  (Supabase)  │
└──────────────┘                             └──────┬───────┘
                                                    │
┌──────────────┐   push-to-zazi-webhook      ┌──────▼───────┐
│   Zazi CRM   │ ◀─────────────────────────  │  Edge Func   │
│  (External)  │     Authorization header    │              │
└──────────────┘                             └──────────────┘
```

---

*End of Integrations Module Specification*
