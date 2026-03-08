# Vanto CRM — User Manual

**Version:** 1.0  
**Date:** March 2026  
**For:** MLM Associates, Team Leaders, and Administrators

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Dashboard](#2-dashboard)
3. [Inbox (WhatsApp Messages)](#3-inbox)
4. [Contacts](#4-contacts)
5. [CRM Pipeline](#5-crm-pipeline)
6. [Automations](#6-automations)
7. [AI Agent](#7-ai-agent)
8. [Knowledge Vault](#8-knowledge-vault)
9. [Playbooks](#9-playbooks)
10. [Workflows](#10-workflows)
11. [Integrations](#11-integrations)
12. [Settings](#12-settings)
13. [Chrome Extension](#13-chrome-extension)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Getting Started

### Logging In

1. Open Vanto CRM in your browser
2. Enter your **email** and **password**
3. Click **Sign In**

> If you don't have an account, ask your team admin to send you an invitation. You'll receive an email with a link to create your account.

### First-Time Setup

After logging in for the first time:
1. Go to **Settings → Profile** to update your name and phone number
2. If you're an admin, go to **Settings → Team** to invite your team members
3. Visit **Integrations** to check your WhatsApp connection status

---

## 2. Dashboard

The Dashboard is your home screen — it shows a snapshot of your entire CRM at a glance.

### What You'll See

- **Total Contacts** — Number of active contacts in your database
- **Total Conversations** — Active WhatsApp conversation threads
- **Messages** — Total messages sent and received
- **Unread** — Messages waiting for your response

### Charts

- **Messages Over Time** — A 7-day trend showing daily message volume
- **Leads by Type** — Pie chart breakdown: Prospect, Registered, Buyer, VIP, Expired
- **Temperature** — How many leads are Hot 🔥, Warm ☀️, or Cold ❄️

### Activity Feed

Shows your most recent CRM actions — contacts added, messages sent, tags changed, etc.

---

## 3. Inbox

The Inbox is your shared WhatsApp messaging hub. All WhatsApp conversations appear here in real-time.

### Viewing Conversations

1. Click **Inbox** in the sidebar
2. The left panel shows all conversations sorted by most recent
3. Click any conversation to open the message thread

### Reading Messages

- **Blue bubbles** = messages you sent (outbound)
- **Gray bubbles** = messages from the contact (inbound)
- Timestamps appear on each message
- Delivery status icons: ✓ Sent, ✓✓ Delivered, 👁 Read

### Sending a Message

1. Select a conversation
2. Type your message in the text box at the bottom
3. Press **Enter** or click the **Send** button
4. The message is sent via WhatsApp through Twilio

### AI Copilot

Click the **brain icon** (🧠) in the conversation header to open the AI Copilot sidebar:
- Get AI-suggested replies based on conversation context
- Replies are grounded in your Knowledge Vault content
- Click a suggestion to paste it into the message box
- Edit before sending if needed

### Contact Info Panel

Click the **info icon** (ℹ️) to see the contact's details:
- Name, phone, email
- Temperature and lead type badges
- Tags and notes
- Assignment (which team member owns this contact)

### Assigning Conversations

If you're a team lead, you can reassign conversations to specific team members using the assignment dropdown in the contact info panel.

---

## 4. Contacts

Manage your entire contact database from the Contacts module.

### Viewing Contacts

- Contacts appear in a list with name, phone, temperature, lead type, and interest level
- Use the **search bar** to find contacts by name or phone number
- Use **filters** to narrow by temperature (hot/warm/cold), lead type, or interest level

### Adding a Contact

1. Click the **+ Add Contact** button
2. Fill in: Name (required), Phone (required), Email (optional)
3. Set temperature, lead type, and interest level
4. Click **Save**

> Phone numbers are automatically normalized to E.164 format (e.g., `+27821234567`)

### Editing a Contact

1. Click on any contact to open their detail panel
2. Edit fields directly
3. Changes save automatically or click **Save**

### Deleting Contacts

- Click the **trash icon** on a contact to soft-delete it
- Deleted contacts are hidden but not permanently removed
- Bulk delete: select multiple contacts using checkboxes, then click **Delete Selected**

### Merging Duplicate Contacts

If the same person has multiple entries:
1. Select the duplicate contacts using checkboxes
2. Click **Merge** in the bulk action bar
3. Choose which record to keep as primary
4. Confirm the merge — the secondary record's data will be combined into the primary

### Bulk Actions

Select multiple contacts to:
- **Delete** — Soft-delete all selected
- **Tag** — Apply a tag to all selected
- **Export** — Download as CSV file

### Activity Log

Each contact has an activity history showing:
- When they were created
- Messages sent/received
- Tag changes, stage movements
- Notes added

---

## 5. CRM Pipeline

The CRM module gives you a visual Kanban board to track leads through your sales process.

### Pipeline Stages

Your pipeline has customizable stages (e.g., New Lead → Contacted → Interested → Closed Won → Closed Lost). Each stage is a column on the board.

### Moving Contacts Between Stages

- **Drag and drop** a contact card from one stage column to another
- The contact's `stage_id` is updated in the database automatically

### Filtering

Use the lead type filter at the top to show only specific lead types:
- Prospect
- Registered_Nopurchase
- Purchase_Nostatus
- Purchase_Status
- Expired

### Adding a Deal

1. Click **+ Add Deal** at the top of any stage column
2. Select an existing contact or enter details
3. The contact appears in that stage

### Contact Cards

Each card shows:
- Contact name
- Phone number
- Temperature badge (color-coded)
- Lead type badge

---

## 6. Automations

Set up rules that automatically perform actions when certain events happen.

### Creating an Automation

1. Click **+ New Automation**
2. Choose a **Trigger** — what event starts the automation:
   - New contact added
   - Lead type changed (to any specific type)
   - Temperature set to hot
   - Inbound message received
   - Contact tagged
   - Pipeline stage changed
3. Choose an **Action** — what happens when triggered:
   - Send WhatsApp template message
   - Assign to specific agent
   - Change temperature
   - Add a tag
   - Move to pipeline stage
   - Send team notification
4. Give it a name and click **Save**

### Managing Automations

- **Toggle** the switch to enable/disable an automation
- **Run count** shows how many times it has fired
- **Last run** shows when it last executed
- Click **Delete** (trash icon) to remove an automation

---

## 7. AI Agent

The AI Agent is your intelligent CRM assistant that can help with:

### What You Can Ask

- "Write a follow-up message for cold leads"
- "Analyze my pipeline health"
- "Suggest the best time to contact my leads"
- "Generate a WhatsApp campaign message"
- "Help me score my leads"
- "Draft an onboarding sequence for new registrations"

### How to Use

1. Click **AI Agent** in the sidebar
2. Type your question or click a suggested prompt
3. The AI responds using your CRM data and Knowledge Vault content
4. Copy the response to use in messages or workflows

### Tips

- Be specific in your questions for better results
- Upload relevant documents to the Knowledge Vault first — the AI uses them for more accurate answers
- The AI has access to your contact statistics, pipeline data, and conversation history

---

## 8. Knowledge Vault

The Knowledge Vault stores documents that power AI responses and auto-replies. This is how you teach the AI about your products, compensation plan, and business opportunity.

### Collections

| Collection | Icon | Mode | Purpose |
|-----------|------|------|---------|
| General Knowledge & App Manual | 📘 | Assisted | General info, the AI can paraphrase |
| Business Opportunity | 🚀 | Strict | Business pitch — AI must quote exactly |
| Compensation | 💰 | Strict | Comp plan details — exact quotes only |
| Product Prices & Benefits | 🧴 | Strict | Product info — exact quotes only |
| Orders & Deliveries | 📦 | Strict | Order process — exact quotes only |
| MLM & Wellness Motivation | ✨ | Assisted | Motivational content, AI can paraphrase |

### Uploading a Document

1. Click **Knowledge** in the sidebar
2. Select the target collection
3. Click **Upload Document**
4. Choose a `.txt` or `.md` file, or use **Paste as Text** for quick content
5. Add a title and optional tags
6. Click **Upload**
7. The document is automatically chunked and indexed for search

### Document Status

- **Processing** — Being chunked and indexed
- **Ready** — Available for AI search
- **Error** — Something went wrong during ingestion

### Search

Use the search bar to find content across all collections. Results show matching chunks with relevance scores.

### Managing Documents

- View document details (version, dates, tags)
- Delete documents and their chunks
- Set effective dates and expiry dates for time-sensitive content

---

## 9. Playbooks

Playbooks are pre-written message scripts and templates for common sales scenarios.

### Using Playbooks

1. Click **Playbooks** in the sidebar
2. Browse by category (cold outreach, follow-up, closing, onboarding)
3. Click a playbook to view its full content
4. Copy the message and paste it into your Inbox conversation

### Creating a Playbook

1. Click **+ New Playbook**
2. Enter a title and select a category
3. Write your message script
4. Save — the playbook is now available to your team

### Analytics

Each playbook tracks:
- **Usage count** — How many times it's been used
- **Conversion count** — How many times it led to a successful outcome

---

## 10. Workflows

Workflows are multi-step automated sequences for nurturing leads.

### Creating a Workflow

1. Click **Workflows** in the sidebar
2. Click **+ New Workflow**
3. Define your steps (e.g., Day 1: Send welcome → Day 3: Follow-up → Day 7: Check-in)
4. Assign contacts to the workflow
5. Toggle active/inactive

---

## 11. Integrations

Connect external services to extend Vanto CRM's capabilities.

### WhatsApp Business (Twilio)

**Status:** Active ✅

This integration powers all WhatsApp messaging. Configuration:
- **Account SID** — Your Twilio account identifier
- **Messaging Service SID** — Used for sending messages
- **Webhook URL** — Automatically configured for inbound messages

**Twilio Health Panel:**
- Shows connection status (green = connected)
- Displays webhook URLs for your Twilio console
- **Test Message** — Send a test WhatsApp message to verify the connection

### Chrome Extension

**Status:** Available for manual installation

See [Section 13](#13-chrome-extension) for installation instructions.

### Zazi CRM

**Status:** Webhook-based sync

- **Pull Sync** — Import contacts from Zazi CRM
- **Push Sync** — Push Vanto contacts to Zazi CRM
- **Bootstrap** — Full initial sync for first-time setup
- Webhook events are logged for debugging

### Other Integrations (Planned)

- OpenAI (BYO API key)
- Stripe (payments)
- Zapier (automation)
- Google Sheets (export)
- Calendly (scheduling)
- HubSpot (CRM sync)

---

## 12. Settings

### Profile

Update your personal details:
- Full name
- Email address
- Phone number

### Team Management

**Admin/Super Admin only:**
1. Go to **Settings → Team**
2. Click **Invite Member**
3. Enter their email address
4. They receive an invitation email with a signup link
5. Once they accept, they appear in your team list

**Roles:**
- **Agent** — Can view and manage contacts, conversations, and messages
- **Admin** — Agent permissions + team management + integrations
- **Super Admin** — Full access to everything

### AI Provider (BYO Key)

If you want to use your own AI provider:
1. Go to **Settings → AI Provider**
2. Select your provider (e.g., OpenAI)
3. Paste your API key
4. Select a model
5. Toggle **Enabled**

> By default, Vanto CRM uses built-in AI that doesn't require an API key.

### Auto-Reply Settings

Configure how the AI responds to incoming WhatsApp messages automatically:
- **Welcome message** — Sent to first-time contacts
- **Menu options** — Numbered menu for common inquiries
- **Knowledge-based replies** — AI searches Knowledge Vault to answer questions

### Notifications

Toggle alerts for:
- New messages
- Hot lead alerts
- Daily summary
- AI suggestions

### Security

- Change your password
- (Future: Two-factor authentication)

---

## 13. Chrome Extension

The Vanto CRM Chrome Extension injects a sidebar directly into WhatsApp Web for seamless CRM operations.

### Installation

1. Download the extension files from the `public/chrome-extension` folder in the repo
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `chrome-extension` folder
6. Open **https://web.whatsapp.com**
7. The Vanto sidebar appears on the right side of WhatsApp Web

### Features

- **Contact Detection** — Automatically reads the name and phone of the person you're chatting with
- **Save Contact** — One-click save to your Vanto CRM database
- **Notes** — Add notes to any contact directly from WhatsApp
- **AI Reply** — Get AI-suggested responses for the current conversation
- **Tags** — View temperature and pipeline stage badges
- **Dashboard Link** — Quick link back to the full Vanto CRM dashboard

### Important Notes

- The extension **overlays** on top of WhatsApp — it never modifies the WhatsApp layout
- It does **not** send WhatsApp messages (that's done via Twilio through the Inbox)
- WhatsApp Web DOM selectors may change with updates — if the sidebar stops detecting contacts, the extension may need an update

---

## 14. Troubleshooting

### I can't log in

- Make sure you're using the correct email and password
- If you forgot your password, use the **Reset Password** link on the login page
- Contact your team admin if you don't have an account

### Messages aren't sending

- Check the **Integrations → WhatsApp** panel for connection status
- Verify that your Twilio account is active and has credits
- Check if the phone number is in correct E.164 format (e.g., `+27821234567`)
- Look at the message status — if it shows "failed," hover to see the error

### Contacts showing as duplicates

- Go to **Contacts** and select both duplicate entries
- Click **Merge** to combine them
- The system uses phone number normalization to prevent future duplicates

### AI responses are inaccurate

- Upload more relevant documents to the **Knowledge Vault**
- Use **strict** mode collections for information that must be quoted exactly
- Be specific in your questions

### Chrome Extension not showing

- Make sure Developer mode is enabled in `chrome://extensions`
- Verify the extension is loaded and enabled
- Refresh the WhatsApp Web page
- Check that you're on `web.whatsapp.com` (not the desktop app)

### Unread count is wrong

- The sidebar badge shows the total unread count across all conversations
- Open a conversation and it will automatically mark as read
- The count updates in real-time via database subscriptions

### Need more help?

Click the **?** help button on any page to get context-specific tips and ask the AI assistant about that page's features.

---

*End of User Manual*
