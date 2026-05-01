---
name: Daily Product Commerce Blueprint (Version B — locked, HOLD)
description: Approved future blueprint for the 6 remaining Daily product pages on onlinecourseformlm.com/shop. Mirrors live RLX/NRM commerce pattern. NOT YET IMPLEMENTED — awaiting named approval per product.
type: feature
---
**STATUS: BLUEPRINT LOCKED — IMPLEMENTATION ON HOLD (2026-05-01)**
Owner is completing the 6 product pages from a separate workspace first. Do NOT implement in this repo until a named-approver instruction is received per product.

## Scope (HOLD list)
GRW, GTS, SLD, STP, PWR Lemon, PWR Apricot — all Daily Collection / 20 PV.

## Version B blueprint (mirrors live RLX/NRM pattern)
| Surface | Value |
|---|---|
| Visible retail price | **R862** |
| Visible member-price wording | **R431** (UI-only fine print, requires associate registration) |
| Machine-readable price (JSON-LD / merchant feed) | **R862 ONLY** — R431 is NEVER machine-readable |
| Shipping | **R99 ZA shipping** |
| Delivery | **3–7 business days** |
| Returns | **14-day returns** |
| Sponsor links | **NO CHANGES** — keep `sp=787262` enrollment, `aplshop.com/j/787262` store, `aplshop.com/j/787262/catalog/` |
| VAT logic | **NO CHANGES** — 15% inclusive remains policy of record |

## Dual-surface rule (CRITICAL)
1. **Website commerce** (RLX/NRM pattern) — uses **R862 / R431** (no decimals), per Version B above. R431 visible only.
2. **WhatsApp conversational** (auto-reply, trainer rules, Knowledge Vault) — continues to use **R862.50 / R431.25 incl 15% VAT** per locked `aplgo-pricing-15pct-vat` memory. Dual-price disclosure mandatory.

These two surfaces intentionally differ. Do not unify them without explicit approval.

## Immunity routing (locked, separate from this HOLD)
- Default Daily routing: immunity → **GTS / GRW** (unchanged).
- **ICE** is reserved for a future, separately-approved "Premium Immunity Escalation" trainer rule. Do not auto-route to ICE.

## Safety locks (must remain ON for any future rollout)
- Phase 3 human-touch guard ON
- Master Prospector ASLEEP
- No bulk send / no auto-apply / no new cron / no autonomous detector
- No Vanto OS event publishing
- Current campaign focus: **RLX and NRM only**

## When unblocking (future)
A named-approver message must explicitly list which of the 6 products to roll out. Even then, mirror live RLX/NRM source EXACTLY (read shop codebase or scrape live pages first — do not reconstruct from this blueprint alone, as live wording may have evolved).
