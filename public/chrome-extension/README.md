# Vanto CRM — WhatsApp Sidebar (MVP) v7.0.0

Lightweight Chrome extension that captures the **currently open WhatsApp Web chat**
(contact name + phone) into Vanto CRM. Nothing else.

## What it does
- Adds a small "V" toggle on WhatsApp Web that opens a sidebar.
- Detects the open chat's contact name and phone number.
- Lets you fill name, phone, email, lead type, assignee, tags, notes and **Save** to CRM.
- Shows a hint when you open a group chat (group campaigns live in the web app now).

## What it no longer does (moved to the web app)
- Group campaign automation / scheduled posting.
- Bulk WhatsApp Name Sync (chat list harvesting).
- Message injection or send-button automation.
- Background polling / alarms / heartbeats.
- Programmatic content-script reinjection.

Removing all of the above stops the extension from interfering with WhatsApp Web's DOM
and keeps it a true read-only overlay.

## Permissions
`storage`, `activeTab` only. (Previously also `tabs`, `alarms`, `scripting` — no longer needed.)

## Install
1. Download / unzip `vanto-crm-extension.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** → select the unzipped folder.
5. Open WhatsApp Web. Click the **V** tab on the right edge.
6. Click the Vanto extension icon in the toolbar → sign in.
