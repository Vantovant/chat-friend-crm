Context loaded. Here's the plan.

## Goal
Replace Twilio outbound in the Google Calendar invite flow with Maytapi so invites can be sent to any prospect at any time (no 24-hour customer-care window).

## Category
- Backend (edge functions): swap outbound provider
- UI: status reporting only
- No DB schema changes, no RLS changes, no inbox/auto-reply changes

## Architecture (updated)

```text
Agent clicks "Quick Add Meeting" (ContactsModule drawer)
        │
        ▼
MeetingQuickAdd.tsx ──► invoke('google-calendar-create')
        │                       │
        │                       ├─ JWT verify + has_role(uid, admin|agent)
        │                       ├─ Connector Gateway: create event (Africa/Johannesburg)
        │                       │     calendars/primary/events  (attendees=[prospect email if any])
        │                       ├─ Build htmlLink → "Add to Calendar" URL
        │                       ├─ Maytapi: POST /api/{product}/{phone}/sendMessage
        │                       │     headers: x-maytapi-key: MAYTAPI_API_TOKEN
        │                       │     body: { to_number, type:'text', message }
        │                       ├─ Connector Gateway: events.watch → calendar-webhook
        │                       └─ contact_activity ← 'meeting_scheduled'
        ▼
Prospect taps link in WhatsApp → Google Calendar → adds event (enters email)
        │
        ▼
Google push notification ──► calendar-webhook (verify_jwt=false, x-goog-channel-token)
        │
        ├─ Fetch event via Connector Gateway
        ├─ Match channel-token → plan_meetings.event_id → contact_id
        ├─ If contacts.email is null → update with attendee email
        └─ contact_activity ← 'email_captured' | 'meeting_accepted' | 'meeting_declined'
```

## Files

1. `supabase/functions/google-calendar-create/index.ts` — UPDATE
   - Remove `send-message` (Twilio) invocation
   - Add direct Maytapi call using existing secrets: `MAYTAPI_PRODUCT_ID`, `MAYTAPI_PHONE_ID`, `MAYTAPI_API_TOKEN`
   - Normalize phone via existing logic (E.164, ZA default)
   - Keep email-as-attendee (backup) if `contacts.email` present
   - Keep `events.watch` registration and `contact_activity` log
   - Return `{ event, whatsapp: { sent, provider:'maytapi', error? }, emailBackup: boolean }`

2. `supabase/functions/calendar-webhook/index.ts` — NO CHANGE
   - Already handles email capture + activity logging; provider-agnostic

3. `src/components/vanto/MeetingQuickAdd.tsx` — UPDATE
   - Success panel relabels delivery as "WhatsApp (Maytapi) sent" and drops the 24h-window failure copy
   - Shows email-backup line only when contact has an email

## Maytapi call (exact shape)

```ts
const url = `https://api.maytapi.com/api/${PRODUCT_ID}/${PHONE_ID}/sendMessage`;
await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type':'application/json', 'x-maytapi-key': MAYTAPI_API_TOKEN },
  body: JSON.stringify({ to_number: phoneE164, type:'text', message: text }),
});
```

Message body:
```
📅 Meeting confirmed: {title}
📆 {date} at {time} (SAST)

Tap to add to your calendar: {htmlLink}

💡 When you add it, Google will ask for your email. This helps us send you reminders and updates.
```

## Security
- JWT verify via `getClaims`
- `has_role(uid,'admin') OR has_role(uid,'agent')`
- RLS untouched; webhook validates `x-goog-channel-token` (HMAC of eventId)
- Secrets already present: `MAYTAPI_PRODUCT_ID`, `MAYTAPI_PHONE_ID`, `MAYTAPI_API_TOKEN`, `GOOGLE_CALENDAR_API_KEY`, `LOVABLE_API_KEY`

## Non-goals / constraints honored
- No schema changes
- No edits to `whatsapp-auto-reply`, `inbox`, `send-message`, or Twilio paths
- Timezone stays `Africa/Johannesburg`
- All new logic stays inside the two edge functions + the QuickAdd panel

Approve and I'll implement.
