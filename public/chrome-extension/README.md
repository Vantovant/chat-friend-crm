# Vanto CRM — WhatsApp Web Chrome Extension

Injects a CRM sidebar directly into WhatsApp Web for seamless lead management.

---

## 📁 Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (MV3) |
| `content.js` | Injected into WhatsApp Web — builds & drives the sidebar |
| `sidebar.css` | Styles for the injected sidebar |
| `popup.html` | Extension toolbar popup |
| `icon16.png` | Toolbar icon (16×16) |
| `icon48.png` | Extension page icon (48×48) |
| `icon128.png` | Chrome Web Store icon (128×128) |

---

## 🚀 Installation (Developer Mode)

1. Open Chrome and go to **chrome://extensions**
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `chrome-extension` folder
5. Open **https://web.whatsapp.com** — the Vanto sidebar appears on the right

---

## ✨ Features

- **Contact Card** — Shows the active chat's name and phone number
- **Save Contact** — Persists contact data locally via `chrome.storage`
- **Add Note** — Attach notes to any contact, stored locally
- **AI Reply** — Generates a suggested reply for the current chat
- **Tags** — Temperature (hot/warm/cold) and pipeline stage badges
- **Dashboard Link** — Opens the full Vanto CRM dashboard

---

## 🔧 How It Works

The `content.js` script:
1. Waits for WhatsApp Web's `#app` element to load
2. Injects the sidebar HTML + toggle button into `document.body`
3. Uses a polling interval to detect when the user switches chats
4. Reads contact details from the WhatsApp Web DOM (name, phone from URL hash)
5. Stores notes and contact data in `chrome.storage.local`

---

## 📌 Notes

- The extension is not yet published on the Chrome Web Store
- Requires **Developer mode** to load unpacked
- WhatsApp Web DOM selectors may change — update `content.js` if the sidebar stops detecting contacts
