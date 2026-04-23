---
name: AI Trainer Layer
description: Admin-managed correction rules table (`ai_trainer_rules`) injected into WhatsApp auto-reply system prompt before answer generation
type: feature
---
Trainer Layer (2026-04-23) — sits ON TOP of Knowledge Vault, not replacing it.

Schema: `public.ai_trainer_rules` (admin-managed)
- title, triggers (text[]), product (nullable), instruction (text), priority enum `trainer_priority` (advisory|strong|override), enabled, notes
- RLS: admins manage; authenticated read; service role read (for edge fn)
- GIN index on triggers, btree on enabled
- Updated_at trigger via `update_updated_at()`

Edge integration (`supabase/functions/whatsapp-auto-reply/index.ts`):
- `loadTrainerRules(svc)` — pulls all enabled rules
- `matchTrainerRules(rules, userText, detectedProduct)` — substring match on triggers + product alias match; sorted override > strong > advisory
- `renderTrainerBlock(rules)` — emits a `═══ TRAINER RULES ═══` section in the system prompt with priority tags (🛑 HARD OVERRIDE / ⚠️ STRONG / 💡 ADVISORY)
- Injected BETWEEN strict/pricing rules and KNOWLEDGE-FIRST rule, so it influences AI before generic intent inference
- Diagnostics: `trainer_rules_loaded`, `trainer_rules_matched` (priority:title list)

UI: Settings → AI Trainer (`src/components/vanto/AITrainerPanel.tsx`)
- CRUD modal, enable/disable toggle, search, priority selector
- "Test Trainer" box: enter sample input → see matched rules + priority badge
- Priority badges color-coded: advisory=muted, strong=amber, override=destructive

Seed rule: PWR — never recommend alone, ask gender first (override). Triggers: tired, fatigue, low energy, energy, exhausted, no energy, always tired. Product: PWR. Instruction enforces gender-clarification question before recommending PWR Lemon (men) or PWR Apricot (women).
