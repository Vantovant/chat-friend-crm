# Automations Module — Detailed Specification

> Module: Automations  
> File: `src/components/vanto/AutomationsModule.tsx` (293 lines)  
> Last Updated: 2026-03-13

---

## 1. Purpose

Simple trigger-action automation rules for repetitive CRM tasks. Each automation maps a single trigger event to a single action, providing a lightweight alternative to multi-step Workflows.

---

## 2. Architecture

| Layer | Detail |
|-------|--------|
| Component | `AutomationsModule` |
| Table | `automations` |
| Auth | Admin-only management via `is_admin_or_super_admin()` RLS |
| Sub-Component | `CreateAutomationDialog` |

---

## 3. Trigger Options

| Trigger | Use Case |
|---------|----------|
| New contact added | Welcome series |
| Lead type changed to Prospect | Prospect qualification |
| Lead type changed to Registered_Nopurchase | Registration follow-up |
| Lead type changed to Purchase_Nostatus | Purchase confirmation |
| Lead type changed to Purchase_Status | VIP onboarding |
| Lead type changed to Expired | Re-activation campaign |
| Temperature set to hot | Hot lead alert |
| Inbound message received | Auto-reply or routing |
| Contact tagged | Tag-based automation |
| Pipeline stage changed | Stage transition actions |

---

## 4. Action Options

| Action | Description |
|--------|-------------|
| Send WhatsApp message | Automated message via Twilio |
| Assign to team member | Route contact to specific agent |
| Add tag | Apply classification tag |
| Change lead type | Update lead lifecycle stage |
| Move to pipeline stage | Advance in CRM pipeline |
| Notify via email | Email notification to team |
| AI auto-reply | AI-generated response |

---

## 5. Quick Templates

Pre-configured automation shortcuts:

| Template | Trigger | Action |
|----------|---------|--------|
| Welcome Series | New contact added | Send WhatsApp message |
| Re-engagement | Temperature set to hot | Assign to team member |
| Appointment Reminder | Pipeline stage changed | Send WhatsApp message |
| Purchase Follow-Up | Lead type → Purchase_Nostatus | Send WhatsApp message |
| Expired Re-activation | Lead type → Expired | Send WhatsApp message |

**Template Flow:** Click template → pre-populates Create dialog with name, trigger, and action.

---

## 6. Stats Dashboard

Three stat cards displayed in a 3-column grid:

| Stat | Value | Icon | Color |
|------|-------|------|-------|
| Active | Count of `active === true` | Zap | Primary |
| Total Runs | Sum of all `run_count` | BarChart2 | Amber |
| Total | Total automation count | Clock | Blue |

---

## 7. Automation Card UI

### 7.1 Card Layout
```
┌─────────────────────────────────────────────────────────┐
│ [Toggle] [⚡] Welcome Series        ACTIVE   42 runs   │
│               When: New contact added → Then: Send msg  │
│                                        Last: 2h ago  ⏸🗑│
└─────────────────────────────────────────────────────────┘
```

### 7.2 Elements
| Element | Detail |
|---------|--------|
| Toggle switch | Custom rounded toggle (green=active, gray=inactive) |
| Icon | Zap in colored/muted circle |
| Name | Bold text with optional ACTIVE badge |
| Trigger pill | `When: {trigger_condition}` in secondary badge |
| Action pill | `Then: {action_description}` in secondary badge |
| Arrow | ChevronRight connecting trigger → action |
| Run count | `{run_count} runs` bold text |
| Last run | Relative time: Xm/Xh/Xd ago, or "Never" |
| Hover actions | Pause/Play + Delete (opacity-0 → opacity-100 on group hover) |

### 7.3 Relative Time Format
```javascript
formatLastRun(iso):
  if (diff < 1 hour)  → "{minutes}m ago"
  if (diff < 1 day)   → "{hours}h ago"
  else                 → "{days}d ago"
  if (null)            → "Never"
```

---

## 8. Create Automation Dialog

### 8.1 Fields
| Field | Type | Required | Default |
|-------|------|----------|---------|
| Name | Text input | Yes | From template or empty |
| When (Trigger) | Select dropdown | Yes | First option or template |
| Then (Action) | Select dropdown | Yes | First option or template |

### 8.2 Persistence
On save:
- Validates name is non-empty
- Gets current user
- Inserts to `automations`:
  - `name`, `trigger_condition`, `action_description`
  - `active: false` (always created inactive)
  - `created_by: user.id`

---

## 9. Database Schema

### `automations` Table
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | PK |
| `name` | text | — | Required |
| `trigger_condition` | text | — | Matches TRIGGER_OPTIONS |
| `action_description` | text | — | Matches ACTION_OPTIONS |
| `active` | boolean | `true` | Toggle via UI |
| `run_count` | integer | `0` | Incremented on execution |
| `last_run_at` | timestamptz | null | Last execution time |
| `created_by` | uuid | null | FK → profiles |
| `created_at` | timestamptz | `now()` | Auto |
| `updated_at` | timestamptz | `now()` | Auto |
| `last_synced_at` | timestamptz | null | Zazi sync |

### RLS Policies
| Policy | Command | Rule |
|--------|---------|------|
| Admins manage automations | ALL | `is_admin_or_super_admin()` |

**Note:** Only admins/super_admins can CRUD automations.

---

## 10. Automations vs. Workflows Comparison

| Feature | Automations | Workflows |
|---------|-------------|-----------|
| Complexity | 1 trigger → 1 action | Multi-step sequences |
| Steps | Fixed: 1 | Unlimited |
| Visual | Text pills with arrow | Arrow-connected flow diagram |
| Templates | 5 quick templates | None |
| Contact tracking | run_count only | contact_count |
| Use case | Quick rules, alerts | Complex funnels |

---

*End of Automations Module Specification*
