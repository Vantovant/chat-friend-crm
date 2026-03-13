# Vanto CRM — Chrome Extension Technical Specification

> **Version:** 5.0 · **Manifest:** V3 · **Last Updated:** 2026-03-13

---

## 1. Overview

The Vanto CRM Chrome Extension injects a CRM sidebar directly into **WhatsApp Web** (`https://web.whatsapp.com`). It enables sales agents to capture contacts, classify leads, assign team members, and execute scheduled group campaign posts — all without leaving WhatsApp.

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Overlay Only** | `position: fixed` — never shifts WhatsApp's `#app` or `body` layout |
| **No Pointer Blocking** | Sidebar captures its own events via `stopPropagation`; WhatsApp remains fully interactive |
| **MV3 Compliance** | No inline scripts; all JS externalized; service worker for background tasks |
| **Auth Delegation** | All authentication handled by `background.js` service worker; content script never touches credentials |
| **Single Pipeline** | All database writes routed through the `upsert-whatsapp-contact` Edge Function |

---

## 2. File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `manifest.json` | 29 | Extension manifest (Manifest V3) — permissions, content scripts, service worker |
| `background.js` | 529 | Service worker — auth, session storage, API calls, group polling engine |
| `content.js` | 937 | Injected into WhatsApp Web — sidebar UI, DOM detection, group capture, auto-poster |
| `popup.html` | 184 | Extension toolbar popup — login/logout/forgot-password UI |
| `popup.js` | 196 | Popup logic — delegates all auth to background via `chrome.runtime.sendMessage` |
| `sidebar.css` | 386 | Sidebar styles — dark theme, overlay positioning, form components |
| `icon128.png` | — | Chrome Web Store / toolbar icon (128×128) |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     WhatsApp Web Tab                         │
│                                                              │
│  ┌──────────────────┐    ┌─────────────────────────────┐     │
│  │   WhatsApp DOM   │    │    Vanto Sidebar (content.js)│     │
│  │   (#app)         │◄──►│    position: fixed; right: 0 │     │
│  │                  │    │                               │     │
│  │  MutationObserver│    │  • Contact detection          │     │
│  │  + polling (1.5s)├───►│  • Form population            │     │
│  │                  │    │  • Group chat capture          │     │
│  └──────────────────┘    │  • Auto-poster execution      │     │
│                          └──────────┬────────────────────┘     │
│                                     │ chrome.runtime           │
│                                     │ .sendMessage()           │
└─────────────────────────────────────┼─────────────────────────┘
                                      │
┌─────────────────────────────────────┼─────────────────────────┐
│              background.js (Service Worker)                    │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  Auth Engine  │  │ Contact CRUD │  │ Group Poll Engine    │ │
│  │              │  │              │  │ (chrome.alarms 1min) │ │
│  │ • login      │  │ • save       │  │                      │ │
│  │ • logout     │  │ • load       │  │ • fetch due posts    │ │
│  │ • refresh    │  │ • upsert     │  │ • send to content.js │ │
│  │ • reset pwd  │  │ • load team  │  │ • update status      │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘ │
│         │                 │                      │              │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase Backend                              │
│                                                                  │
│  Auth API (/auth/v1)     Edge Functions           REST API       │
│  • token?grant_type=     • upsert-whatsapp-       • contacts     │
│    password                contact                 • profiles     │
│  • token?grant_type=     • send-message            • whatsapp_    │
│    refresh_token                                     groups       │
│  • recover                                         • scheduled_   │
│                                                      group_posts  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Manifest Configuration

```json
{
  "manifest_version": 3,
  "name": "Vanto CRM — WhatsApp Sidebar",
  "version": "3.0.0",
  "permissions": ["storage", "activeTab", "tabs", "alarms"],
  "host_permissions": [
    "https://web.whatsapp.com/*",
    "https://nqyyvqcmcyggvlcswkio.supabase.co/*"
  ],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["https://web.whatsapp.com/*"],
    "js": ["content.js"],
    "css": ["sidebar.css"],
    "run_at": "document_idle"
  }]
}
```

### Permissions Breakdown

| Permission | Reason |
|-----------|--------|
| `storage` | Persist auth session (`chrome.storage.local`) |
| `activeTab` | Access current tab for content script messaging |
| `tabs` | Query WhatsApp tabs for auto-poster execution |
| `alarms` | Schedule 1-minute polling for due group posts |

---

## 5. Background Service Worker (`background.js`)

### 5.1 Session Management

Sessions are stored in `chrome.storage.local` with four keys:

| Key | Type | Purpose |
|-----|------|---------|
| `vanto_token` | `string` | Supabase JWT access token |
| `vanto_email` | `string` | Authenticated user's email |
| `vanto_refresh` | `string` | Refresh token for silent renewal |
| `vanto_expires_at` | `number` | Unix timestamp of token expiry |

**Token Refresh Logic:**
- Before any API call, `refreshTokenIfNeeded()` checks if `expires_at - now < 300s`
- If expired with a valid refresh token → calls `/auth/v1/token?grant_type=refresh_token`
- If refresh fails → clears session and notifies all WhatsApp tabs via `VANTO_TOKEN_CLEARED`

### 5.2 Message Router

All communication uses `chrome.runtime.onMessage`. Every handler returns `true` for async `sendResponse`.

| Message Type | Handler | Description |
|-------------|---------|-------------|
| `VANTO_GET_SESSION` | `getSession()` + `refreshTokenIfNeeded()` | Returns current `{token, email}` |
| `VANTO_LOGIN` | `handleLogin(email, password)` | Authenticates via Supabase Auth API |
| `VANTO_LOGOUT` | `handleLogout()` | Clears session, notifies tabs |
| `VANTO_SAVE_CONTACT` | `handleSaveContact(payload)` | POSTs to `upsert-whatsapp-contact` Edge Function |
| `VANTO_LOAD_CONTACT` | `handleLoadContact(phone)` | Queries `contacts` by `phone_normalized` or `whatsapp_id` |
| `VANTO_LOAD_TEAM` | `handleLoadTeamMembers()` | Fetches `profiles` for assignment dropdown |
| `VANTO_RESET_PASSWORD` | `handleResetPassword(email)` | Calls `/auth/v1/recover` |
| `VANTO_UPSERT_GROUP` | `handleUpsertGroup(groupName)` | Upserts into `whatsapp_groups` table |
| `VANTO_POST_RESULT` | — | Acknowledgement from content script (no-op) |

### 5.3 Group Polling Engine

```
chrome.alarms.create('vanto-group-poll', { periodInMinutes: 1 })
```

**Poll Cycle (`pollDuePosts`):**
1. Refresh token if needed
2. Query `scheduled_group_posts` where `status = 'pending'` AND `scheduled_at <= now()`
3. For each due post → call `executeGroupPost(post, token)`
4. Find a WhatsApp Web tab via `chrome.tabs.query`
5. Send `VANTO_EXECUTE_GROUP_POST` message to content script
6. On success → PATCH status to `sent`; on failure → PATCH to `failed`

---

## 6. Content Script (`content.js`)

### 6.1 Initialization Flow

```
document.readyState === 'complete'
    │
    ▼
waitForWhatsApp() — polls for #app element (500ms intervals, 60 retries)
    │
    ▼
injectSidebar() — appends sidebar HTML + toggle button to document.body
    │
    ▼
wireEvents() — attaches click/keydown handlers
    │
    ▼
checkAuthState() — queries background for session
    │
    ▼
loadTeamMembers() — populates "Assign To" dropdown
    │
    ▼
watchChatChanges() — starts MutationObserver + 1.5s polling
    │
    ▼
runDetection() — initial contact/group detection
```

### 6.2 Chat Detection Strategy

Detection uses a **multi-selector priority cascade** with debouncing (600ms):

**Contact Name Detection (8 selectors):**
1. `[data-testid="conversation-header"] span[title]`
2. `[data-testid="conversation-info-header-chat-title"] span`
3. `[data-testid="conversation-info-header-chat-title"]`
4. `header [data-testid="conversation-info-header"] span[title]`
5. `header span[dir="auto"][title]`
6. `#main header span[title]`
7. `#main header span[dir="auto"]`
8. `#main header > div > div > div > div span[title]`

**Phone Number Detection (4 priority levels):**

| Priority | Source | Method |
|----------|--------|--------|
| P0 | `#main[data-id]` | Regex: `(\d{7,15})@` |
| P1 | `window.location.hash` | Regex: `/chat/(\d{7,15})@/` |
| P2 | `#main [data-id]` elements | Regex: `(\d{7,15})@` |
| P3 | Header subtitle spans | Pattern: `^\+?\d[\d\s\-(). ]{5,}$` |

**Group Chat Detection:**
- Check `data-id` for `@g.us` suffix (WhatsApp group identifier)
- Check URL hash for `@g.us`
- Check subtitle for comma-separated member names
- On detection → auto-upsert group name to `whatsapp_groups` table

### 6.3 Change Detection Mechanisms

| Mechanism | Target | Purpose |
|-----------|--------|---------|
| `setInterval` (1.5s) | — | Fallback polling for missed changes |
| `MutationObserver` | `<title>` | WhatsApp updates title with chat name |
| `MutationObserver` | `document.body` | Detect new panels/modals |
| `MutationObserver` | `#main header` | Detect conversation switches |

All triggers feed into `scheduleDetection()` → debounced `runDetection()`.

### 6.4 Auto-Poster Execution Engine

When background sends `VANTO_EXECUTE_GROUP_POST`, the content script:

```
Step A: Open Search
  └─ findElement(['[data-testid="chat-list-search-input"]', ...])
  └─ If not found → click search icon → wait 500ms → retry

Step B: Search for Group (1500ms delay)
  └─ Type group name via document.execCommand('insertText')
  └─ Wait 1500ms for results
  └─ Match: exact → partial → listitem fallback
  └─ Click matched result

Step C: Type Message (1500ms delay)
  └─ findElement(['[data-testid="conversation-compose-box-input"]', ...])
  └─ Insert text via execCommand + InputEvent dispatch

Step D: Send (500ms delay)
  └─ findElement(['[data-testid="send"]', 'button[aria-label="Send"]', ...])
  └─ Click send button
  └─ Report success/failure to background
```

**DOM Selector Fallbacks (per element):**

| Element | Primary Selector | Fallbacks |
|---------|-----------------|-----------|
| Search Input | `[data-testid="chat-list-search-input"]` | `div[contenteditable="true"][data-tab="3"]`, `div[role="textbox"][title="Search input textbox"]` |
| Search Icon | `[data-testid="chat-list-search"]` | `[data-icon="search"]`, `button[aria-label="Search"]` |
| Message Input | `[data-testid="conversation-compose-box-input"]` | `div[contenteditable="true"][data-tab="10"]`, `#main footer div[contenteditable="true"]`, `div[role="textbox"][title="Type a message"]` |
| Send Button | `[data-testid="send"]` | `button[aria-label="Send"]`, `span[data-icon="send"]`, `[data-testid="compose-btn-send"]` |
| Clear Search | `[data-testid="x-alt"]` | `[data-icon="x-alt"]`, `[data-testid="search-close"]`, `button[aria-label="Cancel search"]` |

**Error Handling:**
- If any DOM element is missing → logs `"DOM element missing: <label>"` with tried selectors
- Reports failure to background via callback → background marks post as `failed`

---

## 7. Sidebar UI (`sidebar.css`)

### 7.1 Layout Structure

```
#vanto-crm-sidebar (fixed, right: 0, width: 320px, z-index: 2147483647)
├── .vanto-header (sticky top — logo + close button)
├── #vanto-auth-banner (hidden when authenticated)
├── .vanto-contact-card (avatar + name + phone)
├── .vanto-status (success/error/loading banner)
├── .vanto-body (scrollable)
│   ├── #vanto-no-chat (empty state)
│   └── #vanto-form-body
│       ├── #vanto-group-banner (shown for group chats)
│       └── #vanto-form-fields (shown for 1:1 chats)
│           ├── Contact Info (name, phone, email)
│           ├── Lead Classification (lead_type, temperature)
│           ├── Assignment (team member dropdown)
│           ├── Tags (chip display + input)
│           ├── Notes (textarea)
│           └── Save Button
└── .vanto-footer (dashboard link)

#vanto-crm-toggle (fixed, right: 0, center-Y — shown when sidebar hidden)
```

### 7.2 Color Palette

| Token | HSL Value | Usage |
|-------|-----------|-------|
| Background | `hsl(222, 47%, 6%)` | Sidebar body |
| Surface | `hsl(222, 47%, 9%)` | Input backgrounds |
| Border | `hsl(217, 33%, 17%)` | Dividers, borders |
| Accent | `hsl(172, 66%, 50%)` | Primary buttons, logo, active states |
| Accent Hover | `hsl(172, 66%, 44%)` | Button hover |
| Text Primary | `hsl(210, 40%, 98%)` | Main text |
| Text Secondary | `hsl(215, 20%, 55%)` | Labels, subtitles |
| Text Muted | `hsl(215, 20%, 40%)` | Placeholders |
| Success | `hsl(172, 66%, 60%)` | Success messages |
| Error | `hsl(0, 84%, 65%)` | Error messages |
| Warning | `hsl(33, 90%, 70%)` | Auth banner |

### 7.3 Critical CSS Rules

```css
/* NEVER shift WhatsApp layout */
body, #app, div[id="app"] {
  margin-right: 0 !important;
  padding-right: 0 !important;
}

/* Sidebar must overlay, not push */
#vanto-crm-sidebar {
  position: fixed !important;
  z-index: 2147483647 !important;
  pointer-events: auto;
}

/* All inputs must remain editable */
.vanto-input, .vanto-select, .vanto-textarea {
  pointer-events: auto !important;
  opacity: 1 !important;
  user-select: text !important;
}
```

---

## 8. Popup (`popup.html` + `popup.js`)

### 8.1 Views

| View | ID | Default |
|------|-----|---------|
| Login | `#view-login` | Visible |
| Logged In | `#view-loggedin` | Hidden |
| Forgot Password | `#view-forgot` | Hidden |

### 8.2 Login Flow

```
User enters email + password
    │
    ▼
popup.js → chrome.runtime.sendMessage({ type: 'VANTO_LOGIN', email, password })
    │
    ▼
background.js → POST /auth/v1/token?grant_type=password
    │
    ├── Success → saveSession() → notify WhatsApp tabs → return { success: true }
    │                                                          │
    │                                                          ▼
    │                                                   popup.js shows logged-in view
    │
    └── Failure → return { success: false, error: '...' }
                       │
                       ▼
                popup.js shows error message
```

### 8.3 Features

- **Login:** Email/password via Supabase Auth
- **Logout:** Clears session, notifies all WhatsApp tabs
- **Forgot Password:** Sends reset link via `/auth/v1/recover`
- **Quick Links:** "Open WhatsApp Web" and "Open Dashboard" buttons
- **Version Display:** Footer shows `v2.0.0`

---

## 9. Database Tables Used

| Table | Access | Purpose |
|-------|--------|---------|
| `contacts` | Read/Write | Load and save contact data via Edge Function |
| `profiles` | Read | Populate team member assignment dropdown |
| `whatsapp_groups` | Write | Auto-capture group names on group chat detection |
| `scheduled_group_posts` | Read/Write | Poll for due posts; update status after execution |

### 9.1 Contact Save Payload

```javascript
{
  name:         "string (required)",
  phone:        "string | null",
  whatsapp_id:  "string | null",
  email:        "string | null",
  lead_type:    "prospect | registered | buyer | vip | expired",
  temperature:  "hot | warm | cold",
  tags:         ["string[]"],
  notes:        "string | null",
  assigned_to:  "uuid | null"
}
```

All writes go through `upsert-whatsapp-contact` Edge Function — never direct REST inserts from the extension.

---

## 10. Security Model

| Layer | Implementation |
|-------|---------------|
| **Authentication** | Supabase JWT via `/auth/v1/token` — stored in `chrome.storage.local` |
| **Token Refresh** | Auto-refresh when `< 300s` remaining; clear on failure |
| **RLS Enforcement** | All API calls include `Authorization: Bearer <token>` — server-side RLS applies |
| **No Service Role** | Extension never uses service role key; only anon key + user JWT |
| **CSP Compliance** | No inline scripts (MV3); all JS externalized |
| **DOM Isolation** | Sidebar `stopPropagation` on keydown/keyup/keypress/click prevents leaking to WhatsApp |
| **Session Expiry** | On 401 response → auto-clear session → show auth banner |
| **Timeout Protection** | All fetch calls use `AbortController` with 15-20s timeouts |

---

## 11. Event Isolation

The sidebar prevents keyboard events from leaking to WhatsApp:

```javascript
['keydown', 'keyup', 'keypress', 'click'].forEach(function(evt) {
  sidebar.addEventListener(evt, function(e) { e.stopPropagation(); });
});
```

This ensures typing in sidebar inputs doesn't trigger WhatsApp's search or chat shortcuts.

---

## 12. Error Handling Matrix

| Scenario | Detection | Response |
|----------|-----------|----------|
| Not authenticated | `!session.token` | Show auth banner; disable save |
| Token expired | 401 from API | Clear session → `VANTO_TOKEN_CLEARED` → auth banner |
| Refresh failed | Non-200 from refresh endpoint | Clear session |
| Network timeout | `AbortController` abort | Show "Network timeout" error |
| Phone not detected | P0–P3 all fail | Show "Phone not detected" warning; allow manual entry |
| DOM element missing | `findElement()` returns null | Log selectors tried; report failure to background |
| Group not found | Search yields no match | Clear search; report failure; mark post as `failed` |
| Background unreachable | `chrome.runtime.lastError` | Log error; return null to callback |

---

## 13. Installation

### Developer Mode

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select `public/chrome-extension/` folder
5. Navigate to `https://web.whatsapp.com`
6. Click the Vanto CRM extension icon → Log in
7. Sidebar appears on the right side of WhatsApp Web

### Updating

1. Make changes to files in `public/chrome-extension/`
2. Go to `chrome://extensions`
3. Click the refresh icon on the Vanto CRM extension card
4. Reload any open WhatsApp Web tabs

---

## 14. Known Limitations

| Limitation | Reason | Mitigation |
|-----------|--------|------------|
| WhatsApp DOM selectors may break | WhatsApp Web updates without notice | Multiple fallback selectors per element |
| Cannot send WhatsApp messages | Requires WhatsApp Business API | Extension only captures data; Twilio handles sending |
| Group post timing ±1 min | `chrome.alarms` minimum interval is 1 minute | Acceptable for scheduled posts |
| Service worker may sleep | MV3 service worker lifecycle | Alarms wake the worker; session persists in storage |
| No image posting | `document.execCommand` only handles text | Future: clipboard API for image injection |
| Extension not published | Requires Chrome Web Store review | Developer mode installation only |

---

## 15. File Dependencies

```
manifest.json
├── background.js (service_worker)
│   └── Supabase REST API + Auth API
├── content.js (content_script)
│   └── background.js (via chrome.runtime.sendMessage)
├── sidebar.css (content_script CSS)
├── popup.html (action popup)
│   └── popup.js (external script)
└── icon128.png (extension icon)
```

---

## 16. Version History

| Version | Changes |
|---------|---------|
| v1.0 | Basic sidebar with local storage |
| v2.0 | Supabase auth integration, background service worker |
| v3.0 | Group campaign capture, auto-poster execution engine |
| v4.0 | Password reset, team member assignment, polling engine |
| v5.0 | Multi-selector DOM fallbacks, robust error reporting, MutationObserver improvements |
