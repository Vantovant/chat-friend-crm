# Playbooks Module — Detailed Specification

> Module: Playbooks  
> File: `src/components/vanto/PlaybooksModule.tsx` (250 lines)  
> Last Updated: 2026-03-13

---

## 1. Purpose

Sales script library organized by objection/scenario categories. Provides reusable WhatsApp message templates for MLM associates with usage tracking, conversion analytics, and an approval workflow.

---

## 2. Architecture

| Layer | Detail |
|-------|--------|
| Component | `PlaybooksModule` |
| Table | `playbooks` |
| Analytics | `usage_count` and `conversion_count` columns |
| Auth | Admin-only management; agents can view approved scripts |
| UI Library | shadcn `Dialog` for create/edit |

---

## 3. Categories

| ID | Label | Icon | Typical Content |
|----|-------|------|-----------------|
| `price_question` | Price Question | 💰 | Handle "How much does it cost?" |
| `skeptical` | Skeptical / Scam Fear | 🤔 | Address "Is this a scam/pyramid?" |
| `wants_results` | Wants Results Fast | ⚡ | Set expectations on timeline |
| `medical_concern` | Medical Concern | 🩺 | Disclaimer + product benefits |
| `business_plan` | Business Plan | 📊 | Compensation plan explanation |
| `general` | General | 💬 | General follow-up scripts |

---

## 4. Playbook Card UI

### 4.1 Card Layout
```
┌─────────────────────────────────────┐
│ 💰 Handle Price Objection           │
│     Price Question · v1   ✓ Approved│
│                                     │
│ "I understand price is important... │
│  Let me share what our members      │
│  typically invest and the value..." │
│                                     │
│ ─────────────────────────────────── │
│ 💬 12 uses   📈 67% conv    ✏️ 🗑️  │
└─────────────────────────────────────┘
```

### 4.2 Card Elements
| Element | Detail |
|---------|--------|
| Category icon | Emoji from CATEGORIES |
| Title | Bold text |
| Category + Version | Subtitle (e.g., "Price Question · v1") |
| Approval badge | ✓ Approved (green) or Draft (amber) |
| Content preview | 4-line clamp of script text |
| Usage count | `usage_count` with MessageSquare icon |
| Conversion rate | `(conversion_count / usage_count * 100)%` with TrendingUp icon |
| Actions | Approve/Unapprove, Edit, Delete buttons |

---

## 5. Category Filter Bar

- Horizontal scrollable pill buttons
- "All" filter + one button per category
- Active state: `bg-primary/15 text-primary border-primary/30`
- Inactive state: `text-muted-foreground border-border`

---

## 6. Create/Edit Dialog

Uses shadcn `<Dialog>` component.

### 6.1 Fields
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Title | Text input | Yes | e.g., "Handle price objection" |
| Category | Select dropdown | Yes | From CATEGORIES list |
| Script Content | Textarea (8 rows) | Yes | The actual WhatsApp message script |

### 6.2 Create Behavior
- Sets `approved: true` by default
- Sets `created_by` to current user's ID
- Refreshes list on success

### 6.3 Edit Behavior
- Pre-populates all fields from existing playbook
- Updates `updated_at` timestamp
- Refreshes list on success

---

## 7. Approval Workflow

| Action | Current State | New State | Who Can Do It |
|--------|--------------|-----------|---------------|
| Approve | Draft | ✓ Approved | Admin/Super Admin |
| Unapprove | ✓ Approved | Draft | Admin/Super Admin |

- Toggle via CheckCircle/XCircle button on each card
- Updates `approved` boolean in database
- Non-approved playbooks only visible to admins (RLS policy)

---

## 8. Database Schema

### `playbooks` Table
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | PK |
| `title` | text | — | Required |
| `category` | text | — | Must match CATEGORIES id |
| `content` | text | — | Script body |
| `approved` | boolean | `false` | Approval status |
| `version` | integer | `1` | Version tracking |
| `usage_count` | integer | `0` | Times used by agents |
| `conversion_count` | integer | `0` | Successful conversions |
| `created_by` | uuid | null | FK → profiles |
| `created_at` | timestamptz | `now()` | Auto |
| `updated_at` | timestamptz | `now()` | Auto |

### RLS Policies
| Policy | Command | Rule |
|--------|---------|------|
| Admins manage playbooks | ALL | `is_admin_or_super_admin()` |
| Authenticated view approved | SELECT | `auth.uid() IS NOT NULL AND approved = true` |

**Visibility:** Agents only see approved playbooks. Admins see all (including drafts).

---

## 9. Analytics

### Conversion Rate Calculation
```
convRate = usage_count > 0 
  ? Math.round((conversion_count / usage_count) * 100) 
  : 0
```

### Sorting
Playbooks sorted by `usage_count` descending (most-used first).

---

*End of Playbooks Module Specification*
