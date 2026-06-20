// Shared helper: Unmanned-prospector intent detection + sponsor/meeting link injection.
//
// Goal: when an inbound WhatsApp message signals one of these intents, append a
// deterministic block to the outbound reply that ALWAYS leads with the sponsor
// registration link (framed as "secure your seat / free quote") and THEN gives
// the matching Zoom meeting link(s).
//
// Intents:
//   • distributor — "I want to join / become a distributor / register / sign up"
//        → sponsor link + Tue 19:30 SAST opportunity Zoom
//   • opportunity — "tell me about the business / earn / income / opportunity"
//        → sponsor link + both Tue & Sun opportunity Zoom links
//   • training    — "product training / how do I use / learn about products"
//        → sponsor link + Wed 19:00 SAST training Zoom
//
// All settings are read from integration_settings so wording/URLs can be changed
// without redeploys. Master kill switch: prospector_intent_invite_enabled.
//
// Safety: 5-day per-intent cooldown per contact, opt-out respected, never
// double-appends the sponsor URL if it's already in the body.

export type IntentKind = "distributor" | "opportunity" | "training" | null;

export interface IntentCtx {
  contactId: string | null;
  phoneNormalized: string | null;
  leadType: string | null;
  lastSponsorInviteAt: string | null;
  lastOpportunityInviteAt: string | null;
  lastTrainingInviteAt: string | null;
  lastDistributorInviteAt: string | null;
}

export interface IntentAppendResult {
  appended: boolean;
  message: string;
  kind: IntentKind;
  reason?: string;
}

let _cache: Record<string, string> | null = null;
let _cacheAt = 0;
const TTL_MS = 60_000;

async function loadSettings(svc: any): Promise<Record<string, string>> {
  if (_cache && Date.now() - _cacheAt < TTL_MS) return _cache;
  const { data } = await svc
    .from("integration_settings")
    .select("key,value")
    .in("key", [
      "prospector_intent_invite_enabled",
      "prospector_intent_invite_cooldown_days",
      "sponsor_register_url",
      "sponsor_register_tagline",
      "opportunity_zoom_tue",
      "opportunity_zoom_tue_label",
      "opportunity_zoom_sun_main",
      "opportunity_zoom_sun_alt",
      "opportunity_zoom_sun_label",
      "training_zoom_main",
      "training_zoom_alt",
      "training_zoom_label",
      "distributor_invite_line",
      "opportunity_invite_intro",
      "training_invite_intro",
      "sponsor_cta_enabled",
      "sponsor_cta_cooldown_days",
      "sponsor_cta_min_followup_step",
      "sponsor_cta_line",
    ]);
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { map[r.key] = r.value; });
  _cache = map;
  _cacheAt = Date.now();
  return map;
}

// ── Intent detection ──────────────────────────────────────────────────────
// Priority order: distributor > training > opportunity. Strongest commercial
// signal wins so we don't drown a "ready to sign up" message in opportunity links.
export function detectInboundIntent(raw: string): IntentKind {
  if (!raw) return null;
  const t = raw.toLowerCase();

  // 1. DISTRIBUTOR — explicit join/register/sign-up signal
  if (
    /\b(i (want|wish|would like) to (join|register|become|sign ?up)|become (a |an )?(distributor|associate|member)|how (do|can) i (join|register|sign ?up)|sign me up|register me|join (as )?(an )?(associate|distributor|member)|sponsor me|i.?m ready to (join|register|sign ?up)|how (do|can) i become)\b/.test(t)
  ) return "distributor";

  // 2. TRAINING — wants to learn how to use products / product training
  if (
    /\b(product training|how (do|to) (i |you )?use|learn (about |how )?(the )?products?|training session|how to take|usage (guide|info)|product (school|class|webinar)|teach me (the )?products?)\b/.test(t)
  ) return "training";

  // 3. OPPORTUNITY — interested in the business / income / pricing comparison
  if (
    /\b(business opportunity|earn (money|income|extra)|side income|income opportunity|extra income|make money|how much (can|do) (i|you) (earn|make)|compensation|comp plan|business presentation|opportunity (call|meeting|webinar|zoom)|how (does|do) (it|this) work|tell me (about|more) (the |about the )?business)\b/.test(t)
  ) return "opportunity";

  return null;
}

function isOptedOut(svc: any, phone: string | null): Promise<boolean> {
  if (!phone) return Promise.resolve(false);
  return svc
    .from("auto_reply_optouts")
    .select("phone_normalized")
    .eq("phone_normalized", phone)
    .maybeSingle()
    .then((r: any) => !!r.data);
}

function buildBlock(kind: IntentKind, s: Record<string, string>): string {
  const sponsor = (s["sponsor_register_url"] || "").trim();
  const tagline = (s["sponsor_register_tagline"] || "").trim();
  if (!sponsor) return "";

  if (kind === "distributor") {
    const line = s["distributor_invite_line"] || "Register here under sponsor 787262 — free to sign:";
    const tueLbl = s["opportunity_zoom_tue_label"] || "Tue 19:30 SAST — Business Opportunity";
    const tueUrl = s["opportunity_zoom_tue"] || "";
    return [
      "",
      line,
      `👉 ${sponsor}`,
      tueUrl ? `\nThen meet the team live — ${tueLbl}:\n${tueUrl}` : "",
    ].filter(Boolean).join("\n");
  }

  if (kind === "opportunity") {
    const intro = s["opportunity_invite_intro"] || "Sign-up below secures your spot (it's free):";
    const tueLbl = s["opportunity_zoom_tue_label"] || "Tue 19:30 SAST";
    const tueUrl = s["opportunity_zoom_tue"] || "";
    const sunLbl = s["opportunity_zoom_sun_label"] || "Sun 19:00 SAST";
    const sunMain = s["opportunity_zoom_sun_main"] || "";
    const sunAlt = s["opportunity_zoom_sun_alt"] || "";
    const parts = [
      "",
      intro,
      tagline,
      `👉 ${sponsor}`,
      "",
      "Then join us live:",
    ];
    if (tueUrl) parts.push(`• ${tueLbl}: ${tueUrl}`);
    if (sunMain) parts.push(`• ${sunLbl}: ${sunMain}${sunAlt ? `  (backup: ${sunAlt})` : ""}`);
    return parts.join("\n");
  }

  if (kind === "training") {
    const intro = s["training_invite_intro"] || "Sign-up below secures your spot (it's free):";
    const lbl = s["training_zoom_label"] || "Wed 19:00 SAST — Product Training";
    const main = s["training_zoom_main"] || "";
    const alt = s["training_zoom_alt"] || "";
    const parts = [
      "",
      intro,
      tagline,
      `👉 ${sponsor}`,
      "",
      `Then join us live — ${lbl}:`,
    ];
    if (main) parts.push(main + (alt ? `  (backup: ${alt})` : ""));
    return parts.join("\n");
  }

  return "";
}

function lastAtFor(ctx: IntentCtx, kind: IntentKind): string | null {
  if (kind === "distributor") return ctx.lastDistributorInviteAt;
  if (kind === "opportunity") return ctx.lastOpportunityInviteAt;
  if (kind === "training") return ctx.lastTrainingInviteAt;
  return null;
}

export async function maybeAppendIntentInvite(
  svc: any,
  message: string,
  intent: IntentKind,
  ctx: IntentCtx,
): Promise<IntentAppendResult> {
  if (!intent) return { appended: false, message, kind: null, reason: "no_intent" };
  try {
    const s = await loadSettings(svc);
    const enabled = (s["prospector_intent_invite_enabled"] || "true").toLowerCase() === "true";
    if (!enabled) return { appended: false, message, kind: intent, reason: "disabled" };

    if ((ctx.leadType || "").toLowerCase() === "expired") {
      return { appended: false, message, kind: intent, reason: "lead_expired" };
    }
    if (await isOptedOut(svc, ctx.phoneNormalized)) {
      return { appended: false, message, kind: intent, reason: "optout" };
    }

    const cooldown = parseInt(s["prospector_intent_invite_cooldown_days"] || "5", 10);
    const lastAt = lastAtFor(ctx, intent);
    if (lastAt) {
      const age = Date.now() - new Date(lastAt).getTime();
      if (age < cooldown * 86400000) {
        return { appended: false, message, kind: intent, reason: "cooldown" };
      }
    }

    const sponsor = (s["sponsor_register_url"] || "").trim();
    // If sponsor link already in the outbound body, skip — the AI already nailed it.
    if (sponsor && message.includes(sponsor)) {
      return { appended: false, message, kind: intent, reason: "sponsor_url_already_in_body" };
    }

    const block = buildBlock(intent, s);
    if (!block) return { appended: false, message, kind: intent, reason: "block_empty" };

    return { appended: true, message: `${message.trimEnd()}\n${block}`, kind: intent };
  } catch (e) {
    console.warn("[intent-links] failed:", e);
    return { appended: false, message, kind: intent, reason: "error" };
  }
}

export async function markIntentInvited(
  svc: any,
  contactId: string | null,
  kind: IntentKind,
): Promise<void> {
  if (!contactId || !kind) return;
  const col =
    kind === "distributor" ? "last_distributor_invite_at" :
    kind === "opportunity" ? "last_opportunity_invite_at" :
    kind === "training" ? "last_training_invite_at" : null;
  if (!col) return;
  try {
    const patch: Record<string, string> = { [col]: new Date().toISOString() };
    // Also stamp generic sponsor-invite timestamp.
    patch["last_sponsor_invite_at"] = patch[col];
    await svc.from("contacts").update(patch).eq("id", contactId);
  } catch (e) {
    console.warn("[intent-links] markIntentInvited failed:", e);
  }
}
