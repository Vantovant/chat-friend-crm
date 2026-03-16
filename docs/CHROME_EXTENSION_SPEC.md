# Vanto CRM — Chrome Extension Technical Specification

> **Version:** 6.2.2 · **Manifest:** V3 · **Last Updated:** 2026-03-16

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
| **Self-Healing Injection** | Background performs pre-flight ping + programmatic `chrome.scripting.executeScript` fallback |
| **Stage-Level Tracing** | Auto-poster breaks execution into 9 named stages with individual timeouts and structured error codes |

---

## 2. File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `manifest.json` | 33 | Extension manifest (Manifest V3) — permissions, content scripts, service worker |
| `background.js` | 734 | Service worker — auth, session storage, API calls, group polling engine, heartbeat, content script injection |
| `content.js` | 1240 | Injected into WhatsApp Web — sidebar UI, DOM detection, group capture, 9-stage auto-poster engine |
| `popup.html` | 253 | Extension toolbar popup — login/logout/forgot-password UI |
| `popup.js` | 149 | Popup logic — delegates all auth to background via `chrome.runtime.sendMessage` |
| `sidebar.css` | — | Sidebar styles — dark theme, overlay positioning, form components |
| `icon16.png` | — | Toolbar icon (16×16) |
| `icon48.png` | — | Extension icon (48×48) |
| `icon128.png` | — | Chrome Web Store icon (128×128) |

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
│  └──────────────────┘    │  • 9-stage auto-poster engine │     │
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
│  │ • refresh    │  │ • upsert     │  │ • ensureContentScript│ │
│  │ • reset pwd  │  │ • load team  │  │ • send to content.js │ │
│  └──────┬───────┘  └──────┬───────┘  │ • update status      │ │
│         │                 │          └──────────┬───────────┘ │
│  ┌──────┴─────────────────┴──────────┐          │              │
│  │  Heartbeat Engine (1min alarm)    │          │              │
│  │  • update integration_settings    │          │              │
│  │  • ping content scripts           │          │              │
│  └───────────────────────────────────┘          │              │
│  ┌──────────────────────────────────────────────┘              │
│  │  Content Script Injection Helper                            │
│  │  • Pre-flight VANTO_PING                                    │
│  │  • Programmatic injection fallback                          │
│  │  • Post-injection verification                              │
│  └─────────────────────────────────────────────────────────────│
└────────────────────────────────────────────────────────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase Backend (Lovable Cloud)              │
│                                                                  │
│  Auth API (/auth/v1)     Edge Functions           REST API       │
│  • token?grant_type=     • upsert-whatsapp-       • contacts     │
│    password                contact                 • profiles     │
│  • token?grant_type=     • send-message            • whatsapp_    │
│    refresh_token                                     groups       │
│  • recover                                         • scheduled_   │
│                                                      group_posts  │
│                                                    • integration_ │
│                                                      settings     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Manifest Configuration

```json
{
  "manifest_version": 3,
  "name": "Vanto CRM — WhatsApp Sidebar (Lovable)",
  "version": "6.2.2",
  "permissions": ["storage", "activeTab", "tabs", "alarms", "scripting"],
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
| `alarms` | Schedule 1-minute polling for due group posts + heartbeat |
| `scripting` | Programmatic content script injection fallback |

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
chrome.alarms.create('vanto-heartbeat', { periodInMinutes: 1 })
```

**Poll Cycle (`pollDuePosts`):**
1. Refresh token if needed
2. Query `scheduled_group_posts` where `status = 'pending'` AND `scheduled_at <= now()`
3. For each due post → call `executeGroupPost(post, token)`
4. Find WhatsApp Web tab with retry logic (3 attempts, 2s delay between retries)
5. Ensure content script via `ensureContentScriptInjected()` (pre-flight ping + injection fallback)
6. Send `VANTO_EXECUTE_GROUP_POST` message to content script with 90s race timeout
7. On success → PATCH status to `sent`; on failure → PATCH to `failed` with `failure_reason`

### 5.4 Heartbeat Engine

```
chrome.alarms.create('vanto-heartbeat', { periodInMinutes: 1 })
```

- Queries for active WhatsApp Web tabs
- Upserts heartbeat data to `integration_settings` table (key: `chrome_extension_heartbeat`)
- Heartbeat payload: `{ last_seen: ISO string, whatsapp_ready: boolean }`
- Pings content scripts on all WhatsApp tabs

### 5.5 Content Script Injection Helper

`ensureContentScriptInjected(tabId)` provides a self-healing communication layer:

1. **Pre-flight ping**: `chrome.tabs.sendMessage(tabId, { type: 'VANTO_PING' })`
2. If pong received and initialized → content script already active
3. If pong received but not initialized → send `VANTO_INIT` message
4. If no response → programmatic injection:
   - `chrome.scripting.insertCSS({ files: ['sidebar.css'] })`
   - `chrome.scripting.executeScript({ files: ['content.js'] })`
   - Wait 2s for initialization
   - Verify with `VANTO_INIT` + final ping

### 5.6 Proactive Tab Injection

```javascript
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url.includes('web.whatsapp.com')) {
    await ensureContentScriptInjected(tabId);
  }
});
```

---

## 6. Content Script (`content.js`)

### 6.1 Initialization Flow

```
document.readyState check
    │
    ▼
init() — waits for #app + #pane-side (500ms × 30 attempts = 15s max)
    │
    ▼
createSidebar() — appends sidebar HTML + toggle button to document.body
    │
    ▼
wireEvents() — attaches click/keydown handlers (with stopPropagation)
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
- Check DOM for `[data-id*="@g.us"]` indicator
- On detection → auto-upsert group name to `whatsapp_groups` table

### 6.3 Change Detection Mechanisms

| Mechanism | Target | Purpose |
|-----------|--------|---------|
| `setInterval` (1.5s) | — | Fallback polling for missed changes |
| `MutationObserver` | `<title>` | WhatsApp updates title with chat name |
| `MutationObserver` | `document.body` | Detect `#main` and data-id attribute changes |

All triggers feed into `scheduleDetection()` → debounced `runDetection()`.

### 6.4 Auto-Poster Execution Engine (9-Stage Pipeline)

When background sends `VANTO_EXECUTE_GROUP_POST`, the content script executes a **9-stage pipeline** with individual timeouts and structured logging:

| # | Stage | Timeout | What It Does |
|---|-------|---------|-------------|
| 1 | `open_search` | 10s | Finds search input; clicks search icon if needed |
| 2 | `search_group` | 15s | Clears input, types group name via `document.execCommand('insertText')`, waits 1.5s for results |
| 3 | `select_group` | 8s | Matches group: exact title → partial match → first result fallback |
| 4 | `wait_chat_open` | 12s | Polls for `#main header` to confirm chat loaded |
| 5 | `find_input` | 10s | Locates message compose box via selector cascade |
| 6 | `inject_message` | 8s | Focuses input, clears content, injects text via `execCommand` + `InputEvent` dispatch |
| 7 | `find_send_button` | 10s | Locates send button via selector cascade |
| 8 | `click_send` | 8s | Clicks send button |
| 9 | `confirm_sent` | 12s | Verifies input cleared (message left the compose box) |

**Total execution timeout:** 90 seconds (safety net over all stages)

**Stage-Level Logging:**
```
[EXEC 1] Stage: open_search - START
[EXEC 1] Stage: open_search - SUCCESS
[EXEC 1] Stage: search_group - START
[EXEC 1] Stage: search_group - SUCCESS
...
[EXEC 1] COMPLETED SUCCESSFULLY { elapsed: 12345 }
```

**On stage failure:**
- Stage timeout fires → immediately stops execution
- Returns structured error: `{ success: false, error: "Failed to open search" }`
- Background writes `failure_reason` to database
- CRM UI shows exact failed stage

**DOM Selector Fallbacks (per element):**

| Element | Primary Selector | Fallbacks |
|---------|-----------------|-----------|
| Search Input | `[data-testid="chat-list-search-input"]` | `div[contenteditable="true"][data-tab="3"]`, `div[role="textbox"][title="Search input textbox"]` |
| Search Icon | `[data-testid="chat-list-search"]` | `[data-icon="search"]`, `button[aria-label="Search"]` |
| Message Input | `[data-testid="conversation-compose-box-input"]` | `div[contenteditable="true"][data-tab="10"]`, `#main footer div[contenteditable="true"]`, `div[role="textbox"][title="Type a message"]`, `#main footer [contenteditable="true"]` |
| Send Button | `[data-testid="send"]` | `button[aria-label="Send"]`, `span[data-icon="send"]`, `[data-testid="compose-btn-send"]`, `button[data-tab="11"]` |
| Clear Search | `[data-testid="x-alt"]` | `[data-icon="x-alt"]`, `[data-testid="search-close"]`, `button[aria-label="Cancel search"]` |

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
│   ├── #vanto-group-banner (shown for group chats — Save Group button)
│   └── #vanto-form-body (shown for 1:1 chats)
│       ├── Contact Info (name, phone, email)
│       ├── Lead Classification (lead_type, temperature)
│       ├── Assignment (team member dropdown)
│       ├── Tags (comma-separated input)
│       ├── Notes (textarea)
│       └── Save Contact Button
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
- **Version Display:** Header shows `v6.0.0 — Lovable Edition`

---

## 9. Database Tables Used

| Table | Access | Purpose |
|-------|--------|---------|
| `contacts` | Read/Write | Load and save contact data via Edge Function |
| `profiles` | Read | Populate team member assignment dropdown |
| `whatsapp_groups` | Write | Auto-capture group names on group chat detection |
| `scheduled_group_posts` | Read/Write | Poll for due posts; update status after execution |
| `integration_settings` | Write | Store heartbeat data (key: `chrome_extension_heartbeat`) |

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

## 10. Failure Taxonomy

When a group post execution fails, the `failure_reason` field follows a prefix convention:

| Prefix | Meaning |
|--------|---------|
| `[no_tab]` | No WhatsApp Web tab was open |
| `[no_content_script]` | Content script could not be injected/initialized |
| `[exec_error]` | Exception during execution (includes message) |
| `Failed to open search` | Stage 1 timeout |
| `Group not found: <name>` | Stage 2 — search returned no matching group |
| `Failed to select group` | Stage 3 timeout |
| `Message input not found` | Stage 5 timeout |
| `Failed to inject message` | Stage 6 timeout |
| `Send button not found` | Stage 7 timeout |
| `Failed to click send button` | Stage 8 timeout |
| `Total execution timeout (90s)` | Global safety net exceeded |

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 6.2.2 | 2026-03-16 | Fixed SyntaxError (await in non-async), 9-stage pipeline with individual timeouts, structured error reporting |
| 6.2.1 | 2026-03-15 | Proactive tab injection via `chrome.tabs.onUpdated`, improved content script initialization |
| 6.2 | 2026-03-14 | Programmatic content script injection fallback, pre-flight ping |
| 6.1 | 2026-03-13 | Fixed `failure_reason` column name, retry logic, content script ping check |
| 6.0 | 2026-03-12 | Heartbeat engine, multi-tab recovery, increased timeouts, stage logging |
| 5.0 | 2026-03-10 | Initial Lovable Edition — overlay sidebar, group capture, auto-poster |

---

## 12. Debugging Guide

### Console Log Prefixes

| Prefix | Source |
|--------|--------|
| `[VANTO BG (Lovable)]` | Background service worker |
| `[VANTO CS v6.2.2 (Lovable)]` | Content script |
| `[VANTO CS ERROR]` | Content script errors |
| `[EXEC N] Stage: <name> - START/SUCCESS` | Auto-poster execution stages |

### Common Issues

| Symptom | Check |
|---------|-------|
| "Chrome Extension Not Detected" in CRM | Verify extension is loaded, WhatsApp Web is open, heartbeat alarm is firing |
| Post stuck as `pending` | Check `chrome.alarms` are active; verify token is valid |
| Post fails with `[no_tab]` | Open WhatsApp Web before scheduled time |
| Post fails with `[no_content_script]` | Reload WhatsApp Web tab; re-enable extension |
| Post fails at specific stage | Check console for `[EXEC N]` logs to see which selector failed |

---

*End of Chrome Extension Specification*
