// Shared helper: append the WhatsApp group invite line to a follow-up message
// when (and only when) it is safe to do so.
//
// Safety rules (ALL must pass):
//   1. integration_settings.whatsapp_group_invite_enabled = 'true'
//   2. integration_settings.whatsapp_group_invite_url is set
//   3. Contact's lead_type is NOT 'Expired'
//   4. Contact's phone_normalized is NOT in auto_reply_optouts
//   5. Contact has NOT received a group invite within the cooldown window
//      (default 7 days, configurable via whatsapp_group_invite_cooldown_days)
//   6. Caller-supplied followup step >= whatsapp_group_invite_min_followup_step
//      (default 2 — never on first contact)
//
// On success the caller must call markGroupInvited(contactId) AFTER the message
// is confirmed sent, so the cooldown clock starts.

export interface InviteContext {
  contactId: string;
  phoneNormalized: string | null;
  leadType: string | null;
  followupStep: number; // 1-based step number of THIS message
  lastGroupInviteAt: string | null;
}

export interface InviteResult {
  appended: boolean;
  message: string;
  reason?: string;
}

let _cachedSettings: Record<string, string> | null = null;
let _cachedAt = 0;
const SETTINGS_TTL_MS = 60_000;

async function loadSettings(supabase: any): Promise<Record<string, string>> {
  if (_cachedSettings && Date.now() - _cachedAt < SETTINGS_TTL_MS) return _cachedSettings;
  const { data } = await supabase
    .from("integration_settings")
    .select("key,value")
    .in("key", [
      "whatsapp_group_invite_enabled",
      "whatsapp_group_invite_url",
      "whatsapp_group_invite_line",
      "whatsapp_group_invite_min_followup_step",
      "whatsapp_group_invite_cooldown_days",
    ]);
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { map[r.key] = r.value; });
  _cachedSettings = map;
  _cachedAt = Date.now();
  return map;
}

export async function maybeAppendGroupInvite(
  supabase: any,
  message: string,
  ctx: InviteContext,
): Promise<InviteResult> {
  try {
    const settings = await loadSettings(supabase);
    const enabled = (settings["whatsapp_group_invite_enabled"] || "true").toLowerCase() === "true";
    const url = (settings["whatsapp_group_invite_url"] || "").trim();
    const line = (settings["whatsapp_group_invite_line"] || "").trim();
    const minStep = parseInt(settings["whatsapp_group_invite_min_followup_step"] || "2", 10);
    const cooldownDays = parseInt(settings["whatsapp_group_invite_cooldown_days"] || "7", 10);

    if (!enabled) return { appended: false, message, reason: "disabled" };
    if (!url) return { appended: false, message, reason: "no_url" };
    if (!line) return { appended: false, message, reason: "no_line" };
    if (ctx.followupStep < minStep) return { appended: false, message, reason: `step<${minStep}` };
    if ((ctx.leadType || "").toLowerCase() === "expired") {
      return { appended: false, message, reason: "lead_expired" };
    }
    if (ctx.lastGroupInviteAt) {
      const ageMs = Date.now() - new Date(ctx.lastGroupInviteAt).getTime();
      if (ageMs < cooldownDays * 86400000) {
        return { appended: false, message, reason: "cooldown" };
      }
    }
    if (ctx.phoneNormalized) {
      const { data: optout } = await supabase
        .from("auto_reply_optouts")
        .select("phone_normalized")
        .eq("phone_normalized", ctx.phoneNormalized)
        .maybeSingle();
      if (optout) return { appended: false, message, reason: "optout" };
    }

    // Guard against duplicate URL: if the message body already contains
    // the group URL, do not append again.
    if (message.includes(url)) return { appended: false, message, reason: "url_already_in_body" };

    const composed = `${message.trimEnd()}\n\n${line} ${url}`;
    return { appended: true, message: composed };
  } catch (e) {
    console.warn("[group-invite] check failed:", e);
    return { appended: false, message, reason: "error" };
  }
}

export async function markGroupInvited(supabase: any, contactId: string): Promise<void> {
  try {
    await supabase
      .from("contacts")
      .update({ last_group_invite_at: new Date().toISOString() })
      .eq("id", contactId);
  } catch (e) {
    console.warn("[group-invite] markGroupInvited failed:", e);
  }
}
