# Project Memory

## Core
Vanto CRM (MLM/APLGO): Dark theme (navy/teal), "Get Well Africa" branding. Deployed on Vercel. GitHub: Vantovant/chat-friend-crm.
Supabase DB ID: nqyyvqcmcyggvlcswkio. Permissive RLS (OR logic) with role-based access (Agent, Admin, Super Admin).
Lead types strictly: Prospect, Registered_Nopurchase, Purchase_Nostatus, Purchase_Status, Expired.
Phone fields always +E164, default ZA (+27), min 11 digits. 
Constraint: Keep Workflows & Automations separate modules. Use Twilio API for 1-on-1 WA messaging; NEVER use headless browser mirroring.
Constraint: DB uses partial unique indexes on `phone_normalized`/`whatsapp_id` (where is_deleted=false) + `find-before-upsert` pattern. Soft-deletes only.
Integration: Zazi one-way sync to master `nvifliqfgtxqmnkfkhhi`.
Group Campaigns: Maytapi REST API (NOT Chrome Extension autoposter). Twilio stays for Inbox.

## Memories
- [Project Overview](mem://project/overview) — High-level purpose, modules, and scope of Vanto CRM
- [Branding](mem://style/branding) — Visual branding details, interaction greetings
- [Permissions](mem://auth/permissions) — Role-based access control, RLS OR logic details
- [Zazi CRM Integration](mem://integrations/zazi-crm) — Bidirectional sync details, retries
- [Database Schema](mem://database/schema) — Core tables, enums, RAG tables setup
- [Chrome Extension](mem://features/chrome-extension) — MV3 extension details, contact capture, passive group detector
- [WhatsApp Delivery Constraint](mem://technical/whatsapp-delivery-constraint) — 24-hour Customer Care Window rules
- [Contacts Management](mem://features/contacts-management) — Action icons, phone precedence
- [Lead Types](mem://style/lead-types) — Standardized types and transition rules
- [Invitation System](mem://auth/invitation-system) — Super Admin email invite flow
- [Integration Management](mem://technical/integration-management) — `integration_settings` table, masked secrets
- [Contacts Hygiene](mem://features/contacts-hygiene) — Duplicate banners, Run Data Clean tool
- [Contacts Merge](mem://features/contacts-merge) — Smart Merge and bulk merge workflows
- [Zazi Validation](mem://integrations/zazi-validation) — Pre-push validation rules for sync
- [Contacts Architecture](mem://database/contacts-architecture) — Canonical fields, partial unique indexes, soft-delete
- [One-way Sync Architecture](mem://integrations/one-way-sync-architecture) — Schema sync to master project
- [Lead Assignment](mem://features/lead-assignment) — Manual assignment rules and visibility
- [Postgres Extensions](mem://technical/postgres-extensions) — `http` extension requirement
- [Contact Activity Audit](mem://features/contact-activity-audit) — `contact_activity` audit trail
- [Shared Inbox](mem://features/shared-inbox) — Twilio errors, retry logic, Copilot integration
- [Password Recovery](mem://auth/password-recovery) — Web and extension reset flows
- [Twilio WhatsApp](mem://integrations/twilio-whatsapp) — Production outbound pipeline
- [WhatsApp Mirroring Exclusion](mem://technical/whatsapp-mirroring-exclusion) — Constraint against headless browser mirroring
- [Conversation Lifecycle](mem://technical/conversation-lifecycle) — Thread creation rules
- [AI Agent Implementation](mem://technical/ai-agent-implementation) — BYO Key architecture
- [Integration Health Monitoring](mem://features/integration-health-monitoring) — Twilio Health Panel
- [CRM Pipeline](mem://features/crm-pipeline) — Kanban pipeline and stage changes
- [Workflows & Automations](mem://features/workflows-and-automations) — Explicitly separate modules
- [Phone Normalization](mem://technical/phone-normalization) — +E164 formatting, ZA default logic
- [WhatsApp Auto Reply](mem://features/whatsapp-auto-reply) — Reply limits, prompt translation layer
- [Knowledge Vault](mem://features/knowledge-vault) — Client-side chunking to bypass worker limits
- [Zazi Copilot](mem://features/zazi-copilot) — Agentic inbox sidebar, Next Best Action
- [Page-Aware Help](mem://features/page-aware-help) — Contextual AI assistance via global Ask AI interface
- [Sales Playbooks](mem://features/sales-playbooks) — Scripts, response templates
- [AI Routing Logic](mem://technical/ai-routing-logic) — Deterministic AI fallback hierarchy
- [Documentation](mem://project/documentation) — Location and contents of technical docs
- [Group Campaigns](mem://features/group-campaigns) — Automated WA group messaging via Chrome Extension
- [Group Campaigns Maytapi](mem://features/group-campaigns-maytapi) — Maytapi REST API migration for group campaigns
- [Missed Inquiry Recovery](mem://features/missed-inquiry-recovery) — 5-step Maytapi auto-follow-up for stalled inbox convos
- [Technical Debt](mem://technical/debt) — Modules needing refactor, future backlog
- [Auto-Reply Branding](mem://features/auto-reply-branding) — Vanto Vanto's details only in auto-replies
