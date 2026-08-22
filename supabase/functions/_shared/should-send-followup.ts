// Universal pre-send guard for scheduled follow-ups (cadence-tick, phase3-tick, recovery-tick).
// Enforces:
//   1. Cross-provider outbound cooldown (default 6h) — prevents Twilio+Maytapi collisions.
//   2. Inbound quiet period (default 12h) — if they replied recently, they are engaged; don't pile on.
//   3. Soft-refusal regex — "not now", "not interested", "stop", "later", "let me think", etc.
//   4. Contact lead_type promoted → skip (registered / purchased).
//   5. do_not_contact / is_deleted / auto_reply_enabled=false.
//
// Returns { ok, reason, retry_after? }. Callers must treat ok=false as skip-and-reschedule.

const SOFT_REFUSAL_RE = /\b(not\s+(now|interested|today)|i(['’ ]|\s)?ll\s+(let\s+u|let\s+you|get\s+back)|stop\b|later\b|another\s+time|leave\s+me|please\s+don['’ ]?t|not\s+ready|let\s+me\s+think|maybe\s+later)\b/i;

const PROMOTED_TYPES = new Set([
  // DB enum values
  "registered", "buyer", "vip",
  // CRM label variants (safety-net if a caller passes the label form)
  "Registered_Nopurchase", "Purchase_Status", "Purchase_Nostatus",
]);

export interface GuardContact {
  id: string;
  lead_type?: string | null;
  do_not_contact?: boolean | null;
  is_deleted?: boolean | null;
  auto_reply_enabled?: boolean | null;
  last_outbound_at?: string | null;
  last_inbound_at?: string | null;
  phone_normalized?: string | null;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
  retry_after?: string; // ISO
  matched_text?: string;
  human_touch?: boolean; // true when a human has already personally engaged this contact
}

// Activity types that mean a HUMAN (owner, agent, or an assistant acting on their behalf)
// personally engaged this contact. Automated sends are deliberately excluded.
const HUMAN_ACTIVITY_TYPES = ["note_added", "call", "human_handover", "meeting_scheduled"];

/**
 * Human-contact gate.
 * A contact is considered "personally engaged" when either:
 *   • contacts.notes is non-null / non-empty (any manual note ever logged), or
 *   • a contact_activity row of a human type exists (after `sinceISO` when given).
 * Automated cadences must never message such a contact again.
 */
export async function hasHumanTouch(
  supabase: any,
  contactId: string,
  sinceISO?: string | null,
): Promise<{ touched: boolean; reason?: string }> {
  if (!contactId) return { touched: false };

  const { data: c } = await supabase
    .from("contacts")
    .select("notes")
    .eq("id", contactId)
    .maybeSingle();
  if (c?.notes && String(c.notes).trim().length > 0) {
    return { touched: true, reason: "human_contact:notes" };
  }

  let q = supabase
    .from("contact_activity")
    .select("type, created_at")
    .eq("contact_id", contactId)
    .in("type", HUMAN_ACTIVITY_TYPES)
    .order("created_at", { ascending: false })
    .limit(1);
  if (sinceISO) q = q.gte("created_at", sinceISO);
  const { data: act } = await q;
  if (act && act.length > 0) {
    return { touched: true, reason: `human_contact:${act[0].type}` };
  }
  return { touched: false };
}

export async function shouldSendFollowup(
  supabase: any,
  contact: GuardContact,
  opts?: {
    conversationId?: string | null;
    caller?: string;
    /** Cadence enrolment time — human activity after this point blocks the send. */
    enrolledAt?: string | null;
    /** Escape hatch; defaults to enforcing the human-contact gate. */
    skipHumanGate?: boolean;
  }
): Promise<GuardResult> {
  if (!contact) return { ok: false, reason: "contact_missing" };
  if (contact.is_deleted) return { ok: false, reason: "contact_deleted" };
  if (contact.do_not_contact) return { ok: false, reason: "do_not_contact" };
  if (contact.auto_reply_enabled === false) return { ok: false, reason: "auto_reply_muted" };
  if (contact.lead_type && PROMOTED_TYPES.has(contact.lead_type)) {
    return { ok: false, reason: `promoted_lead_type:${contact.lead_type}` };
  }

  // ── Human-contact gate ── never auto-message someone a human already engaged.
  if (opts?.skipHumanGate !== true) {
    const touch = await hasHumanTouch(supabase, contact.id, opts?.enrolledAt ?? null);
    if (touch.touched) {
      return { ok: false, reason: touch.reason || "human_contact", human_touch: true };
    }
  }


  // Load settings (with defaults)
  const { data: cfg } = await supabase
    .from("integration_settings")
    .select("key,value")
    .in("key", ["followup_cross_provider_cooldown_hours", "followup_inbound_quiet_hours"]);
  const cfgMap: Record<string, string> = {};
  (cfg || []).forEach((r: any) => { cfgMap[r.key] = r.value; });
  const outCooldownH = parseInt(cfgMap["followup_cross_provider_cooldown_hours"] || "6", 10);
  const inQuietH = parseInt(cfgMap["followup_inbound_quiet_hours"] || "12", 10);

  const now = Date.now();

  // Prefer contact-level cached timestamps; fall back to messages table if missing.
  let lastOut = contact.last_outbound_at ? new Date(contact.last_outbound_at).getTime() : 0;
  let lastIn  = contact.last_inbound_at  ? new Date(contact.last_inbound_at).getTime()  : 0;

  if ((!lastOut || !lastIn) && opts?.conversationId) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("created_at, is_outbound, content")
      .eq("conversation_id", opts.conversationId)
      .order("created_at", { ascending: false })
      .limit(20);
    (msgs || []).forEach((m: any) => {
      const t = new Date(m.created_at).getTime();
      if (m.is_outbound && t > lastOut) lastOut = t;
      if (!m.is_outbound && t > lastIn)  lastIn  = t;
    });
  }

  if (lastOut && (now - lastOut) < outCooldownH * 3600 * 1000) {
    return {
      ok: false,
      reason: `cross_provider_cooldown_${outCooldownH}h`,
      retry_after: new Date(lastOut + outCooldownH * 3600 * 1000).toISOString(),
    };
  }
  if (lastIn && (now - lastIn) < inQuietH * 3600 * 1000) {
    return {
      ok: false,
      reason: `inbound_quiet_${inQuietH}h`,
      retry_after: new Date(lastIn + inQuietH * 3600 * 1000).toISOString(),
    };
  }

  // Soft-refusal scan on the most recent inbound (if we have a conv).
  if (opts?.conversationId) {
    const { data: lastInboundMsg } = await supabase
      .from("messages")
      .select("content, created_at")
      .eq("conversation_id", opts.conversationId)
      .eq("is_outbound", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const text = (lastInboundMsg?.content || "").toString();
    if (text && SOFT_REFUSAL_RE.test(text)) {
      return {
        ok: false,
        reason: "soft_refusal_detected",
        matched_text: text.slice(0, 160),
      };
    }
  }

  return { ok: true };
}

// Helper for message senders to stamp last_outbound_* on the contact after a successful send.
export async function stampOutbound(
  supabase: any,
  contactId: string,
  provider: string
): Promise<void> {
  if (!contactId) return;
  await supabase.from("contacts").update({
    last_outbound_at: new Date().toISOString(),
    last_outbound_provider: provider,
    updated_at: new Date().toISOString(),
  }).eq("id", contactId);
}

// Helper for inbound webhooks to stamp last_inbound_at.
export async function stampInbound(
  supabase: any,
  contactId: string
): Promise<void> {
  if (!contactId) return;
  await supabase.from("contacts").update({
    last_inbound_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", contactId);
}
