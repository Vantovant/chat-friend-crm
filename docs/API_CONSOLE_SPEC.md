# API Console Module — Detailed Specification

> Module: API Console  
> File: `src/components/vanto/APIConsoleModule.tsx` (256 lines)  
> Last Updated: 2026-03-13

---

## 1. Purpose

Developer tools interface for testing backend edge functions and viewing real-time webhook event history. Provides a Postman-like experience directly within the CRM dashboard.

---

## 2. Architecture

| Layer | Detail |
|-------|--------|
| Component | `APIConsoleModule` |
| Table | `webhook_events` |
| API Layer | Direct `fetch()` to edge function URLs with session JWT |
| Auth | Authenticated user session token for API calls |
| Responsive | Mobile dropdown for endpoint selection |

---

## 3. Endpoint Registry

| Name | Path | Method | Description |
|------|------|--------|-------------|
| Twilio Inbound | `/functions/v1/twilio-whatsapp-inbound` | POST | Receives inbound WhatsApp messages from Twilio |
| Twilio Status | `/functions/v1/twilio-whatsapp-status` | POST | Receives message delivery status callbacks |
| CRM Webhook | `/functions/v1/crm-webhook` | POST | Inbound sync from Zazi CRM (sync_contacts, upsert_contact, log_chat) |
| Save Contact | `/functions/v1/save-contact` | POST | Chrome extension contact capture endpoint |
| Send Message | `/functions/v1/send-message` | POST | Send outbound WhatsApp message via Twilio |
| AI Chat | `/functions/v1/ai-chat` | POST | AI agent powered by Lovable AI gateway |
| Push to Zazi | `/functions/v1/push-to-zazi-webhook` | POST | Push contacts outbound to Zazi CRM |

---

## 4. Sample Payloads

Pre-configured JSON payloads for quick testing:

### CRM Webhook (`/functions/v1/crm-webhook`)
```json
{
  "action": "sync_contacts",
  "contacts": [{
    "full_name": "Test User",
    "phone_number": "+27820001234",
    "email": "test@example.com"
  }],
  "user_id": "<your-user-id>"
}
```

### Save Contact (`/functions/v1/save-contact`)
```json
{
  "name": "Test Contact",
  "phone": "+27820001234",
  "whatsapp_id": "27820001234@c.us"
}
```

### Send Message (`/functions/v1/send-message`)
```json
{
  "conversation_id": "<conversation-uuid>",
  "content": "Hello from Vanto CRM!"
}
```

### AI Chat (`/functions/v1/ai-chat`)
```json
{
  "messages": [{
    "role": "user",
    "content": "Write a follow-up message for a cold lead"
  }]
}
```

---

## 5. Layout

### Desktop (2-Panel)
```
┌──────────────────┬──────────────────────────────┐
│ Endpoint List    │  Request/Response Panel      │
│ (272px)          │  (flex-1)                    │
│                  │                              │
│ POST · Twilio In │  POST https://...            │
│ POST · CRM Hook │  ┌──────────────────────┐    │
│ POST · Save     │  │ Request Body         │    │
│ ...             │  │ { "action": "..." }  │    │
│                  │  └──────────────────────┘    │
│ ─── Events ───  │  ┌──────────────────────┐    │
│ sync_contacts ✓ │  │ Response   200       │    │
│ save_contact ✓  │  │ { "success": true }  │    │
│                  │  └──────────────────────┘    │
└──────────────────┴──────────────────────────────┘
```

### Mobile (Single Panel)
- Endpoint selection via `<select>` dropdown
- Full-width request/response panel
- Events log hidden

---

## 6. Request Panel

### 6.1 URL Display
- Full endpoint URL: `{SUPABASE_URL}{selected.path}`
- Copy button with clipboard feedback
- Method badge (POST) in primary color

### 6.2 Request Body Editor
- Monospace textarea (10 rows)
- Editable JSON payload
- Auto-populated from `SAMPLE_PAYLOADS` on endpoint selection
- No syntax highlighting (plain textarea)

### 6.3 Send Button
- Gradient CTA with Send icon
- Disabled while request in flight
- Shows loading spinner during execution

### 6.4 Request Execution
```javascript
fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
    'apikey': VITE_SUPABASE_PUBLISHABLE_KEY
  },
  body: JSON.stringify(parsedPayload)
})
```

**Validation:** JSON.parse on payload before sending; shows error toast on invalid JSON.

---

## 7. Response Panel

Appears after request completes:

| Element | Detail |
|---------|--------|
| Status dot | Green (< 300) or red (≥ 300) |
| Status code badge | Colored badge with HTTP status |
| Response body | Monospace pre-formatted block |
| Auto-formatting | JSON responses pretty-printed |
| Max height | 320px with scroll |

---

## 8. Webhook Events Log

### 8.1 Location
- Desktop: Left sidebar below endpoint list
- Mobile: Hidden (future: separate events tab)

### 8.2 Data Source
```sql
SELECT id, source, action, status, error, created_at
FROM webhook_events
ORDER BY created_at DESC
LIMIT 20
```

### 8.3 Event Display
Each event shows:
- Status indicator: Activity icon (green for `processed`, red for error)
- Action name (bold, truncated)
- Source + timestamp

### 8.4 Auto-Refresh
Events list reloads after every API request (`loadEvents()` called in `finally` block).

---

## 9. Database Schema

### `webhook_events` Table
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | PK |
| `source` | text | — | Origin system (e.g., "twilio", "zazi") |
| `action` | text | — | Action performed (e.g., "sync_contacts") |
| `status` | text | `'received'` | `received`, `processed`, `error` |
| `error` | text | null | Error message if failed |
| `payload` | jsonb | null | Full request payload |
| `created_at` | timestamptz | `now()` | Auto |
| `last_synced_at` | timestamptz | null | Zazi sync |

### RLS Policies
| Policy | Command | Rule |
|--------|---------|------|
| Service role can manage | ALL | `true` (service role access) |

**Note:** Only service role (edge functions) can write webhook events. Authenticated users can read via the service-level policy.

---

## 10. State Management

| State Variable | Type | Purpose |
|----------------|------|---------|
| `selected` | Endpoint object | Currently selected endpoint |
| `copied` | boolean | Clipboard copy feedback |
| `payload` | string | Editable JSON payload |
| `response` | string | Response body text |
| `responseStatus` | number \| null | HTTP status code |
| `sending` | boolean | Request in flight |
| `events` | WebhookEvent[] | Recent webhook events |
| `loadingEvents` | boolean | Events loading state |

---

*End of API Console Module Specification*
