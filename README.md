# Vanto CRM (Get Well Hub)

Production WhatsApp CRM for APLGO / Get Well Africa. Hybrid multi-user
workspace: shared inbox + private notes, per-user Twilio routing, and
super-admin-only Maytapi (see change log below).

## Recent changes (2026-07-09) — Multi-user & Maytapi suspension

- **Team invitations (super-admin only).** Invited users join as `agent`
  role. Existing invitation flow untouched.
- **Hybrid data model.** Shared: contacts, Twilio + Maytapi inboxes,
  CRM pipeline, knowledge, playbooks. Private per-user: plan/tasks,
  voice diary, AI settings, prospector drafts.
- **Twilio hybrid routing.**
  - `profiles.twilio_routing_mode` = `shared` | `own_number`.
  - `profiles.twilio_phone_number` (E.164) — used as `From` for own-number users.
  - Inbound `twilio-whatsapp-inbound` stamps `messages.routed_to_user_id`
    when destination matches a user's number; otherwise NULL = shared.
- **Maytapi hybrid routing (inbound stamping).** Same pattern in
  `maytapi-webhook-inbound` via `profiles.maytapi_phone_id`.
- **Contact ownership.** `contacts.owner_user_id` (nullable, NULL = shared).
- **Inbox default view.** Non-admins default to "My inbox"; admins default
  to "All".
- **Maytapi suspended for invited users** (this change):
  - Sidebar: `Maytapi Inbox` and `Group Campaigns` marked `adminOnly`.
  - Edge functions `maytapi-send-direct` and `maytapi-send-group` now call
    `_shared/require-admin-or-system.ts`. Service-role / anon / no-auth
    callers (cron + edge-to-edge) pass through unchanged. Agent-role JWTs
    are blocked with `403 { reason: "maytapi_shared_number_disabled_for_invited_users" }`.
  - Rationale: the workspace Maytapi is the super-admin's personal
    WhatsApp; per-number rate limits, trust-header identity, and ban risk
    make sharing unsafe. Invited users will connect their own Maytapi
    credentials in a future "Settings → Team → Connect your Maytapi" flow.

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID


## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
