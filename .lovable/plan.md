# fb_campaign_response_v1 — diagnosis report (no changes made)

## 1. The exact bug (confirmed)

`supabase/functions/fb-cadence-tick/index.ts`:

- line 393: `const channel: "maytapi" = "maytapi";`
- line 411: `channel = "maytapi";`  ← reassigning a `const`

This throws `TypeError: Assignment to constant variable.` **after** the `fetch` to `maytapi-send-direct` has already returned. So:

1. The WhatsApp message **is actually sent**.
2. The throw is swallowed by the surrounding `try/catch`, which sets `sendError = "Assignment to constant variable."` and leaves `sendOk = false`.
3. Because `sendOk` is false, the code takes the failure branch: it releases the rate-limit slot, writes a `cadence_log` row with `status='failed'`, and **does not advance `current_step`** — it only sets `next_send_at = now + 2h` and `pause_reason = 'send_failed:...'`.

Result: the same step-1 message re-fires every ~2 hours, indefinitely, while the CRM believes nothing was ever delivered. This matches the WhatsApp screenshots exactly (yesterday 10:31, today 08:45, next 10:45).

Scope: this is **not** contact-specific. Every send through this function hits the same line. Live counts:

- 24 rows `status='active'` in `fb_campaign_response_v1`
- 10 currently carrying `pause_reason = 'send_failed:Assignment to constant variable.'`
- 24 `cadence_log` rows with `error like 'Assignment%'` — i.e. 24 messages that were delivered but recorded as failed
- The rows that show `current_step=1` with a clean `pause_reason` advanced before the regression; the ones stuck at step 0/1 with the error are looping.

## 2. Human-contact / registration gating — definitive answer

**There is no gate for prior human contact, and none for registration.**

- `contacts` has **no `registration_status` column** (verified against `information_schema`).
- The only promotion gate is `lead_type in (registered, buyer, vip)` — in `fb-cadence-tick` and in `_shared/should-send-followup.ts`. Vuyisile registered in the backoffice but his `lead_type` is still `prospect`, so nothing stopped him.
- `contacts.notes` and `contact_activity` are **never read** by the cadence engine. Manual calls/notes logged via MCP have zero effect on sending.
- The `shouldSendFollowup` guard does check a 6h outbound cooldown and a 12h inbound quiet window — but it reads `contacts.last_outbound_at`, which is **NULL** for every affected contact (manual WhatsApp sends from the owner's own phone never stamp it). So the cooldown never fires.

13 of the 24 active contacts have manual notes in their record (calls, personal replies, orders raised) and are still being auto-messaged as if untouched — including Vuyisile Nashwa, Mr W Matthew's Masilela (ready to order), Dorcas (existing customer, retention call), Johannes (skeptical, trust message already sent), Mnotho, Kgosi!, Nathan, Siboniso, Bee, Lady V.

## 3. Affected contacts (all 24 active)

Stuck with the bug error (looping): Johannes (+27645395208), MARIA4LIVE (+27603581888), Mr W Matthew's Masilela (+27827041386), NkatekoAkani (+27797560375), Kgosi! (+27649676389), Nathan Somerset West (+27605649341), Siboniso Manzi (+27767373579), Vuyisile Nashwa (+27739474228), plus 2 further rows in the same state.

Active, no error yet (will hit it on next send): Andries Mphane, BABA, Bee, Dorcas, Elias, Ephraim, Lady V, maiezo, Mnotho, Moitoi, nonkosi, Nonku, Vee Mo Foundation and the remaining step-0 enrollments — all due 09:45–12:45 today.

## Recommended fix (awaiting your go-ahead — nothing changed yet)

1. **Immediate stop-the-bleeding:** set `integration_settings.fb_cadence_enabled = false` so no further duplicate sends go out today.
2. **Fix the bug:** change `const channel` to a plain literal (drop the reassignment at line 411).
3. **Repair state:** for the 10 rows whose `cadence_log` shows a delivered-but-"failed" send, advance `current_step` and clear `pause_reason` so they don't re-fire; re-mark those `cadence_log` rows as `sent`.
4. **Add a human-contact gate** (new, requires your sign-off on the rule): skip/complete a cadence row when the contact has a manual note or `contact_activity` entry newer than the cadence enrolment, or when a human outbound has been logged — and stamp `last_outbound_at` on manual sends so the existing 6h cooldown actually works.
5. **Registration gate:** since there is no `registration_status` field, either add one or agree that registering flips `lead_type` to `registered` (which the existing gate already respects).

## Technical notes

- File: `supabase/functions/fb-cadence-tick/index.ts` lines 390–471.
- Guard: `supabase/functions/_shared/should-send-followup.ts`.
- Same `try/catch`-swallows-throw pattern should be audited in the sibling ticks (`cadence-tick`, `recovery-tick`, `phase3-tick`) — a delivered-then-throw path there would produce the same duplicate-send loop.
