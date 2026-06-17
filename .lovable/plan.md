## Vanto CRM — WhatsApp-First Calendar Invites (Architecture Plan)

**Category:** Backend (Edge Functions) + UI (Contact drawer) + Integration (Google Calendar push notifications + Twilio via existing `send-message`).

No DB schema changes. No edits to `send-message`, auto-reply, or inbox.

---

### Flow Diagram

```text
Agent → MeetingQuickAdd (UI)
   │
   ▼
google-calendar-create (Edge Function)  ── creates event on vantovant@gmail.com (Africa/Johannesburg)
   │   ├─ builds htmlLink: https://calendar.google.com/calendar/event?eid={base64(eventId+ownerEmail)}
   │   ├─ if contact.email present → keeps email attendee (Google sends ICS as backup)
   │   ├─ calls send-message → Twilio WhatsApp text with the link
   │   ├─ registers Google Calendar push channel (events.watch) → calendar-webhook
   │   └─ logs contact_activity: 'meeting_scheduled'
   ▼
Prospect taps link → opens Google Calendar mobile/web → "Save" → Google asks for email
   ▼
Google Calendar push → POST calendar-webhook
   │   ├─ pulls changed events via events.list (syncToken)
   │   ├─ finds attendee.email + responseStatus, matches event_id ↔ plan_meetings.calendar_event_id
   │   ├─ resolves contact_id from plan_meetings row
   │   ├─ if contacts.email IS NULL → UPDATE contacts.email
   │   └─ logs contact_activity:
   │       • 'email_captured'   (when a new attendee email appears)
   │       • 'meeting_accepted' (responseStatus = 'accepted')
   │       • 'meeting_declined' (responseStatus = 'declined')
```

---

### Files

**1. `supabase/functions/google-calendar-create/index.ts`** — UPDATE
- Keep existing JWT + role gate (admin/super_admin/agent), SAST timezone, end = start + duration.
- After event creation:
  - Build the shareable link `https://calendar.google.com/calendar/event?eid=<htmlLink eid param>` (use the `htmlLink` Google returns — already has the correct `eid`).
  - Compose the WhatsApp message exactly as specified.
  - `await supabase.functions.invoke('send-message', { body: { to: contact.phone_normalized, message, contact_id } })` — non-blocking try/catch; surface `whatsapp_sent: true/false` in response.
  - If `contactEmail` present, leave email attendee on the event (Google handles the email invite as the "backup").
  - Best-effort register a push channel: `POST /calendars/primary/events/watch` with `{ id: uuid, type: 'web_hook', address: <project>/functions/v1/calendar-webhook, token: event.id }`. Store nothing new — `plan_meetings.calendar_event_id` already exists.
  - Log `contact_activity` type `meeting_scheduled` (already done).

**2. `supabase/functions/calendar-webhook/index.ts`** — NEW (verify_jwt = false; validates Google headers)
- Accept POST. Read headers: `x-goog-channel-id`, `x-goog-resource-state`, `x-goog-channel-token`, `x-goog-resource-id`.
- On `sync` → 200 OK.
- On `exists`/`update` → fetch the event via gateway: `GET /calendars/primary/events/{token}` (token = our event_id).
- Look up `plan_meetings` row by `calendar_event_id` → derive `contact_id`.
- For each attendee:
  - If attendee.email and attendee != organizer:
    - `contact_activity` insert `email_captured` (dedupe by checking existing log).
    - `UPDATE contacts SET email = $1 WHERE id = $contact AND (email IS NULL OR email = '')`.
  - Map `responseStatus`:
    - `accepted` → `meeting_accepted`
    - `declined` → `meeting_declined`
    - Insert into `contact_activity` (dedupe per status).
- Return 200 quickly (Google retries on non-2xx).
- Add to `supabase/config.toml`: `[functions.calendar-webhook] verify_jwt = false`.

**3. `src/components/vanto/MeetingQuickAdd.tsx`** — UPDATE
- After submit, success panel shows:
  - ✅ Calendar event created
  - 📱 WhatsApp sent (or ⚠️ WhatsApp failed — fallback notice)
  - ✉️ Email invite: "sent as backup" if `contactEmail` was present, else "will be captured when prospect adds to calendar"
- Link to event (`htmlLink`) preserved.

**4. `src/components/vanto/ContactsModule.tsx`** — already mounts `MeetingQuickAdd`; no logic change. Verify props pass `contact.email`.

---

### Security
- `google-calendar-create`: existing JWT verification + role check stays.
- `calendar-webhook`: public endpoint (Google can't sign JWT). Validates `x-goog-channel-token` matches the event_id it received, and the event must exist in `plan_meetings`. Uses service role internally; never trusts client body.

### Constants / Env (all already present)
`LOVABLE_API_KEY`, `GOOGLE_CALENDAR_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Webhook URL derived from `SUPABASE_URL`.

### Out of scope (explicit)
- No new tables/columns.
- No edits to `send-message`, Maytapi pipeline, auto-reply, inbox.
- No per-user OAuth — workspace owner's calendar only (Phase 1).

---

Approve and I'll build all four files in one pass and deploy both edge functions.
