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

CRITICAL PRODUCT FACTS (2026-04-24 corrections):
- THERE IS NO PRODUCT CALLED "PWR". The line is split: PWR Lemon (men's health) and PWR Apricot (women's health).
- PWR Lemon and PWR Apricot are NOT vitality/energy products — they are gender-specific hormonal/reproductive support.
- Vitality / tiredness / fatigue / low energy → recommend GRW (immune+vitality) or GTS (strength+stamina), NEVER PWR.
- Override rule "PWR — never recommend alone" enforces both: (a) always specify Lemon/Apricot, (b) route vitality questions to GRW/GTS.

LINK POLICY (2026-04-24, sponsor code 787262):
- JOIN as associate (ONLY): https://backoffice.aplgo.com/register/?sp=787262
- ORDER products (customer): https://aplshop.com/j/787262 OR https://onlinecourseformlm.com/shop
- BRAND/INFO site: https://aplgo.com/j/787262/
- DIGITAL CATALOG (Acumullit SA): https://aplshop.com/j/787262/catalog/
- NEVER share bare backoffice.aplgo.com, aplgo.com, or aplshop.com without sponsor suffix (strips 787262).
- Override rule "LINK POLICY — Joining vs Ordering" enforces correct link per intent across all auto-replies, flash-sale rules, and pricing rules.
