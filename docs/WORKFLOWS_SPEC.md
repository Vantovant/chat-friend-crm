# Workflows Module — Detailed Specification

> Module: Workflows  
> File: `src/components/vanto/WorkflowsModule.tsx` (306 lines)  
> Last Updated: 2026-03-13

---

## 1. Purpose

Reusable multi-step automation playbooks for sales processes. Workflows define a trigger event followed by a sequence of ordered actions (steps), providing visual flow representation and team-wide reusability.

---

## 2. Architecture

| Layer | Detail |
|-------|--------|
| Component | `WorkflowsModule` |
| Table | `workflows` |
| Data Model | `steps` stored as JSONB array of `{ type, label }` objects |
| Auth | Admin-only management via `is_admin_or_super_admin()` RLS |
| Sub-Component | `CreateWorkflowDialog` |

---

## 3. Trigger Types

| Value | Label | Use Case |
|-------|-------|----------|
| `lead_type_changed` | Lead Type Changed | Any lead type transition |
| `lead_type_to_prospect` | Lead → Prospect | New prospect qualification |
| `lead_type_to_registered` | Lead → Registered_Nopurchase | Registration without purchase |
| `lead_type_to_buyer` | Lead → Purchase_Nostatus | First purchase made |
| `lead_type_to_vip` | Lead → Purchase_Status | VIP status achieved |
| `lead_type_to_expired` | Lead → Expired | Subscription/membership expired |
| `stage_changed` | Pipeline Stage Changed | CRM pipeline movement |
| `inbound_message` | Inbound Message Received | WhatsApp message from contact |
| `manual` | Manual Trigger | User-initiated via "Run Now" |

---

## 4. Step Types

| Value | Label | Icon | Color Theme | Purpose |
|-------|-------|------|-------------|---------|
| `send_message` | Send Message | MessageSquare | Blue (`bg-blue-500/15`) | Send WhatsApp message to contact |
| `assign_owner` | Assign Owner | UserPlus | Violet (`bg-violet-500/15`) | Reassign contact to team member |
| `add_tag` | Add Tag | Tag | Primary (`bg-primary/15`) | Apply tag to contact |
| `wait` | Wait | Clock | Secondary (`bg-secondary`) | Delay before next step |
| `ai_suggest_reply` | AI Suggest Reply | Zap | Amber (`bg-amber-500/15`) | Generate AI-powered reply draft |

---

## 5. Workflow Card UI

Each workflow card displays:

### 5.1 Header Row
- **Icon:** GitBranch in gradient (active) or secondary (inactive) circle
- **Name:** Bold text
- **Status Badge:** `ACTIVE` (primary) or `INACTIVE` (muted)
- **Description:** Subtitle text
- **Contact Count:** Number with "contacts" label
- **Actions:** Play/Pause toggle + Delete button

### 5.2 Visual Flow Diagram
Arrow-connected step badges rendered horizontally:
```
[⚡ Lead → Prospect] → [💬 Send Message] → [⏰ Wait] → [👤 Assign Owner]
```
Each badge uses the step type's color theme.

---

## 6. Create Workflow Dialog

### 6.1 Form Fields
| Field | Type | Required | Default |
|-------|------|----------|---------|
| Name | Text input | Yes | Empty |
| Description | Text input | No | Empty |
| Trigger | Select dropdown | Yes | `manual` |
| Steps | Dynamic list builder | No | Empty array |

### 6.2 Step Builder
- **Add:** Click step type buttons at bottom → appends to list
- **Edit:** Inline editable label within each step badge
- **Remove:** X button removes step from list
- **Step numbering:** Sequential (1, 2, 3...)

### 6.3 Persistence
On save:
1. Prepend trigger as step 0: `{ type: 'trigger', label: triggerLabel }`
2. Append user-added steps
3. Insert to `workflows` table:
   - `name`, `description`, `steps` (JSON), `active: false`, `created_by: user.id`

---

## 7. Database Schema

### `workflows` Table
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | PK |
| `name` | text | — | Required |
| `description` | text | null | Optional |
| `active` | boolean | `false` | Toggle via UI |
| `steps` | jsonb | `'[]'` | Array of `{ type, label }` |
| `contact_count` | integer | `0` | Contacts enrolled |
| `created_by` | uuid | null | FK → profiles |
| `created_at` | timestamptz | `now()` | Auto |
| `updated_at` | timestamptz | `now()` | Auto-updated |
| `last_synced_at` | timestamptz | null | Zazi sync |

### RLS Policies
| Policy | Command | Rule |
|--------|---------|------|
| Admins manage workflows | ALL | `is_admin_or_super_admin()` |

**Note:** Only admins/super_admins can create, edit, or delete workflows. Regular agents cannot access this module's write operations.

---

## 8. Workflows vs. Automations

| Feature | Workflows | Automations |
|---------|-----------|-------------|
| Complexity | Multi-step sequences | Single trigger → single action |
| Steps | Unlimited | 1 |
| Visual | Arrow-connected flow diagram | Trigger → Action text |
| Use Case | Complex sales funnels | Quick rules |
| Data Model | JSONB steps array | Separate columns |
| Templates | No | Yes (5 quick templates) |

---

*End of Workflows Module Specification*
