
# Plan — Add VantoOS Parent Attribution & Suite Hub to GetWell Hub

Goal: Comply with the VantoOS Parent Company Attribution Instruction (v1.0) by surfacing VantoOS as the parent company across the public marketing site, and give every visitor a clear path to the sister apps (Executive AI Command Center, GetWell Grow, and future apps).

Scope: **Marketing/UI only.** No backend, no auth, no edge-function changes. All in-app modules (behind login) untouched.

---

## 1. New page — `/suite` (VantoOS Suite hub)

Route added in `src/App.tsx` and new file `src/pages/marketing/Suite.tsx`.

Sections, top → bottom:

1. **Hero** — "Part of the VantoOS Suite" + the exact Section 2 paragraph from the directive (verbatim, no edits).
2. **Suite grid** — three product cards (live + coming):
   - **Executive AI Command Center** → https://vantoos.com/command-center  *(Flagship)*
   - **GetWell Hub** → / (current site — "You're here" badge)
   - **GetWell Grow** → https://getwellgrow.app
   - Placeholder card "More apps shipping in 2026" → https://vantoos.com/suite
3. **About VantoOS** — short bio + CTA buttons: Visit VantoOS, Company, Investors, Pricing, Contact (all to vantoos.com/...).
4. **Sitemap-style link list** of every VantoOS parent page (Home, Command Center, Features, How it Works, The Suite, Company, Clientele, Investors, Pricing, Contact, Sign In) — fulfils Section 4 of the directive.

Add nav link "The Suite" to `MarketingLayout.tsx` top nav.

---

## 2. Global footer attribution (every page)

Update `src/components/marketing/MarketingLayout.tsx` footer:

- Add a fourth/fifth row: **"GetWell Hub is a product of the VantoOS Suite — designed and developed by VantoOS."**
- Add small **VantoOS wordmark** linking to https://vantoos.com (text wordmark — no logo image needed since we don't have the asset).
- Change copyright line to: `© {year} VantoOS (Pty) Ltd. All rights reserved.`
- Add link "The Suite" → `/suite` and "VantoOS.com ↗" → https://vantoos.com in the Company column.

This satisfies Placement #1 (global footer) on every public page.

---

## 3. Home page — "Part of the VantoOS Suite" card

In `src/pages/marketing/Home.tsx`, insert a compact band just above the footer:

- Left: "Part of the **VantoOS Suite**" + one-liner.
- Right: 3 chips → Executive AI Command Center · GetWell Grow · See the full suite (→ `/suite`).

Satisfies Placement #3.

---

## 4. Top-nav "More from VantoOS" (optional but recommended)

Add a small dropdown in `MarketingLayout.tsx` desktop nav (and a section in the mobile drawer):

- Executive AI Command Center → vantoos.com/command-center
- GetWell Grow → getwellgrow.app
- VantoOS Home → vantoos.com
- See all → `/suite`

Satisfies Placement #4.

---

## 5. Investors page — parent paragraph

In `src/pages/marketing/Investors.tsx`, add a "Parent Company" block at the top with the verbatim Section 2 paragraph + link to vantoos.com/investors. Satisfies Placement #5.

---

## 6. Sitemap doc update

Update `/mnt/documents/getwellhub-sitemap.md`:
- Add `/suite` to public pages table.
- Add "Part of the VantoOS Suite · vantoos.com" line to the link-tree block (Placement #6).
- Add a short "Sister apps" section listing GetWell Grow + Executive AI Command Center URLs so you can paste them into your master Link Tree.

Also update `scripts/generate-sitemap.ts` (or `public/robots.txt` sitemap mechanism if present) to include `/suite`.

---

## 7. Brand-name consistency check

Sweep marketing pages to ensure **"VantoOS"** is spelled exactly that way (no "Vanto OS", "VantOS", "Vanto-OS") wherever introduced. Section 8 checklist requirement.

---

## Files to change / create

```text
NEW   src/pages/marketing/Suite.tsx
EDIT  src/App.tsx                                 (add /suite route)
EDIT  src/components/marketing/MarketingLayout.tsx (footer + nav dropdown)
EDIT  src/pages/marketing/Home.tsx                 (suite band)
EDIT  src/pages/marketing/Investors.tsx            (parent paragraph)
EDIT  /mnt/documents/getwellhub-sitemap.md         (suite + sister links)
EDIT  scripts/generate-sitemap.ts (if exists)      (add /suite)
```

## Out of scope (not touching)

- No changes to `/app/*` authenticated routes.
- No changes to Edge Functions, Supabase, prospector pipeline, WhatsApp senders, or any backend.
- No logo image upload (using text wordmark "VantoOS" styled to match brand). If you later provide an official VantoOS logo PNG, I'll swap it in.

## Compliance checklist after build (mirrors Section 8 of the PDF)

- [x] Global footer: © {year} VantoOS (Pty) Ltd
- [x] Global footer: "[Product] is a product of the VantoOS Suite — developed by VantoOS"
- [x] VantoOS wordmark links to https://vantoos.com
- [x] About/Company page (Investors) contains Section 2 paragraph verbatim
- [x] "Part of the VantoOS Suite" block on Home
- [x] Link-tree pack updated with VantoOS attribution + sister apps
- [x] "VantoOS" spelled consistently everywhere

Approve and I'll build it in one pass.
