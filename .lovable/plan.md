## Plan: Reports module (replaces Damage Control)

### 1. Sidebar + routing
- Rename `damage-control` module to `reports` in `src/lib/vanto-data.ts` and `AppSidebar.tsx`.
- Update label "Damage Control" → "Reports", icon → `FileText`.
- In `App.tsx` (or wherever modules are rendered), swap `DamageControlModule` import for a new `ReportsModule`.
- Delete old `DamageControlModule.tsx` (move logic only if needed — none required).

### 2. New `ReportsModule.tsx` (hub)
- Top-level page titled **Reports**.
- Card grid of available reports. First card: **Lead Call Report** (open in same view). Placeholders for future reports (greyed out: "Coming soon" — Weekly Conversion, Group Activity, Distributor Pipeline).
- Clicking Lead Call Report opens `<LeadCallReport />` inline (no router change needed).

### 3. `LeadCallReport.tsx` component
- **Source:** `contacts` table (no date filter by default) + `messages` + `maytapi_messages`.
- **Selection logic (up to 100):**
  1. Always include ALL contacts where distributor-intent detected (keywords in notes/messages: `distributor`, `R375`, `membership`, `business`, `join`, `opportunity`, `earn`, `sponsor`) OR `interest_topic='business'` from `prospector_damage_audit`.
  2. Fill remaining slots with most recent inbound-active contacts (by latest message timestamp across both message tables), going back as far as needed — no week cutoff.
  3. Hard cap **100**.
- **Sort:** ★ Distributors first, then by earliest first-inquiry date ascending (oldest inquiry → top, so you call the longest-waiting first).
- **UI:**
  - Filters: source tag, channel (Twilio/Maytapi/both), temperature, "only distributors" toggle, date range (optional, default off).
  - Preview table: #, ★, Name, Phone, Type, Temp, First Inquiry, Last Message.
  - Buttons: **Download PDF**, **Print**, **Refresh**.
- **PDF (client-side, jspdf + jspdf-autotable):**
  - Cover/summary page (header, total, filter chips, generated timestamp).
  - Summary table of all included contacts.
  - One detail block per contact (page break every ~2 contacts): phone, email, type, temp, interest, first inquiry, tags, notes, full chronological thread (merged messages + maytapi_messages).
  - Filename: `lead-call-report-YYYY-MM-DD.pdf`.

### 4. Out of scope
- No schema changes.
- No edits to auto-reply / Twilio / Maytapi / Damage audit pipelines.
- Damage audit table (`prospector_damage_audit`) stays — only used as a read source for distributor detection.

### 5. Dependencies
- Add `jspdf` and `jspdf-autotable` (client-side).

Reply **go** to build, or tell me to tweak the cap, sort, or selection rules.