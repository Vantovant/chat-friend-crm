// GROUP GUARD (2026-09-29, owner-approved plan). Additive.
// Modes: off | log_only (default) | enforce. Only active groups (whatsapp_groups.is_active).
// Every function here is best-effort and must never throw into the webhook.

const MAYTAPI_BASE = "https://api.maytapi.com/api";
const TEN_MIN_MS = 10 * 60 * 1000;

type Svc = any;

export type GuardSettings = {
  mode: "off" | "log_only" | "enforce";
  countryBlock: boolean;
  blockedPrefixes: string[];
  allowlist: string[];
  floodMax: number;
  floodWindowSec: number;
  dupMax: number;
  floodMode: "log_only" | "enforce";
  ownerPhone: string;
  adminPhone: string;
  excluded: string[];
  targetGroups: string[];
};

const KEYS = [
  "group_guard_mode",
  "group_guard_country_block_enabled",
  "group_guard_blocked_prefixes",
  "group_guard_allowlist",
  "group_guard_flood_max_msgs",
  "group_guard_flood_window_sec",
  "group_guard_dup_max",
  "group_guard_flood_mode",
  "maytapi_owner_phone",
  "zazi_group_admin_phone",
  "zazi_group_admin_excluded_phones",
  "group_guard_target_groups",
];

const digits = (s: string) => (s || "").replace(/\D/g, "");
const csv = (s: string) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);

export async function loadGuardSettings(svc: Svc): Promise<GuardSettings> {
  const { data } = await svc.from("integration_settings").select("key,value").in("key", KEYS);
  const m: Record<string, string> = {};
  for (const r of data || []) m[r.key] = r.value ?? "";
  const mode = (["off", "log_only", "enforce"].includes(m.group_guard_mode) ? m.group_guard_mode : "off") as GuardSettings["mode"];
  return {
    mode,
    countryBlock: (m.group_guard_country_block_enabled || "false") === "true",
    blockedPrefixes: csv(m.group_guard_blocked_prefixes).map((p) => "+" + digits(p)),
    allowlist: csv(m.group_guard_allowlist).map(digits),
    floodMax: Number(m.group_guard_flood_max_msgs) || 5,
    floodWindowSec: Number(m.group_guard_flood_window_sec) || 60,
    dupMax: Number(m.group_guard_dup_max) || 3,
    floodMode: m.group_guard_flood_mode === "enforce" ? "enforce" : "log_only",
    ownerPhone: digits(m.maytapi_owner_phone),
    adminPhone: digits(m.zazi_group_admin_phone),
    excluded: csv(m.zazi_group_admin_excluded_phones).map(digits),
    // Owner request 2026-09-30: if set, the guard acts ONLY in these group JIDs.
    targetGroups: csv(m.group_guard_target_groups),
  };
}

function creds() {
  const p = Deno.env.get("MAYTAPI_PRODUCT_ID")?.trim();
  const ph = Deno.env.get("MAYTAPI_PHONE_ID")?.trim();
  const t = Deno.env.get("MAYTAPI_API_TOKEN")?.trim();
  return p && ph && t ? { p, ph, t } : null;
}

async function isActiveGroup(svc: Svc, jid: string): Promise<{ active: boolean; name: string }> {
  const { data } = await svc.from("whatsapp_groups").select("group_name,is_active").eq("group_jid", jid).eq("is_active", true).limit(1);
  const row = (data || [])[0];
  return { active: !!row, name: row?.group_name || jid };
}

// Group info (admins) — cached 1h in memory + integration_settings.
const memCache = new Map<string, { at: number; admins: string[] }>();
export async function getGroupAdmins(svc: Svc, jid: string): Promise<string[] | null> {
  const hit = memCache.get(jid);
  if (hit && Date.now() - hit.at < 3600_000) return hit.admins;
  const key = `group_guard_admins_cache:${jid}`;
  try {
    const { data } = await svc.from("integration_settings").select("value").eq("key", key).maybeSingle();
    if (data?.value) {
      const c = JSON.parse(data.value);
      if (Date.now() - c.at < 3600_000) { memCache.set(jid, c); return c.admins; }
    }
  } catch { /* ignore bad cache */ }
  const c = creds();
  if (!c) return null;
  try {
    const r = await fetch(`${MAYTAPI_BASE}/${c.p}/${c.ph}/getGroups/${encodeURIComponent(jid)}`, { headers: { "x-maytapi-key": c.t } });
    if (!r.ok) { await r.text(); return null; }
    const j = await r.json();
    const g = j?.data ?? j ?? {};
    let raw: any[] = g.admins || [];
    if (!raw.length && Array.isArray(g.participants)) raw = g.participants.filter((p: any) => p?.isAdmin || p?.admin || p?.isSuperAdmin);
    const admins = raw.map((a: any) => digits(String(typeof a === "string" ? a : a?.id || a?.phone || "").replace(/@.*$/, ""))).filter(Boolean);
    const entry = { at: Date.now(), admins };
    memCache.set(jid, entry);
    await svc.from("integration_settings").upsert({ key, value: JSON.stringify(entry) }, { onConflict: "key" });
    return admins;
  } catch { return null; }
}

async function isExempt(svc: Svc, s: GuardSettings, jid: string, phoneDigits: string): Promise<boolean> {
  if (!phoneDigits) return true;
  if (phoneDigits === s.ownerPhone || phoneDigits === s.adminPhone) return true;
  if (s.excluded.includes(phoneDigits) || s.allowlist.includes(phoneDigits)) return true;
  const admins = await getGroupAdmins(svc, jid);
  if (admins && admins.includes(phoneDigits)) return true;
  return false;
}

async function maytapiRemove(jid: string, phoneDigits: string): Promise<boolean> {
  const c = creds();
  if (!c) return false;
  try {
    const r = await fetch(`${MAYTAPI_BASE}/${c.p}/${c.ph}/group/remove`, {
      method: "POST",
      headers: { "x-maytapi-key": c.t, "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: jid, number: phoneDigits }),
    });
    const t = await r.text();
    return r.ok && !/"success"\s*:\s*false/.test(t);
  } catch { return false; }
}

async function maytapiDeleteRecent(svc: Svc, jid: string, phoneE164: string): Promise<number> {
  const c = creds();
  if (!c) return 0;
  const since = new Date(Date.now() - TEN_MIN_MS).toISOString();
  const { data } = await svc.from("maytapi_messages").select("maytapi_message_id")
    .eq("conversation_key", jid).eq("phone_e164", phoneE164).gte("received_at", since).limit(200);
  let n = 0;
  for (const row of data || []) {
    try {
      const r = await fetch(`${MAYTAPI_BASE}/${c.p}/${c.ph}/sendMessage`, {
        method: "POST",
        headers: { "x-maytapi-key": c.t, "Content-Type": "application/json" },
        body: JSON.stringify({ to_number: jid, type: "delete", message: row.maytapi_message_id }),
      });
      const t = await r.text();
      if (r.ok && !/"success"\s*:\s*false/.test(t)) n++;
    } catch { /* keep going */ }
  }
  return n;
}

async function sendAlert(s: GuardSettings, text: string) {
  if (!s.adminPhone) return;
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/maytapi-send-direct`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to_number: "+" + s.adminPhone, message: text, skip_trust_header: true, source: "group_guard_alert" }),
    });
  } catch (e) { console.warn("[group-guard] alert failed:", (e as Error)?.message); }
}

// One action per incident: the unique index (group_jid, phone, 10-min bucket) makes
// the insert fail for every duplicate webhook in the same flood.
async function act(svc: Svc, s: GuardSettings, jid: string, groupName: string, phoneE164: string, reason: string, raw: unknown) {
  const phoneDigits = digits(phoneE164);
  const { data: claimed, error } = await svc.from("group_guard_actions").insert({
    group_jid: jid, phone: phoneE164, reason, mode: s.mode,
    action: s.mode === "enforce" ? "remove" : "would_remove", raw,
  }).select("id").maybeSingle();
  if (error || !claimed) return { skipped: "duplicate_incident" };

  let removedOk: boolean | null = null;
  let deleted = 0;
  if (s.mode === "enforce") {
    removedOk = await maytapiRemove(jid, phoneDigits);
    deleted = await maytapiDeleteRecent(svc, jid, phoneE164);
    await svc.from("group_guard_actions").update({ removed_ok: removedOk, deleted_count: deleted }).eq("id", claimed.id);
  }
  // Blocklist so a re-join is caught by the country/re-join gate (idempotent via unique index).
  if (s.mode === "enforce" && reason !== "blocklisted_rejoin") {
    await svc.from("group_guard_actions").insert({
      group_jid: jid, phone: phoneE164, reason, mode: s.mode, action: "blocklisted", raw: null,
    }).then(() => {}, () => {});
  }
  const verb = s.mode === "enforce" ? (removedOk ? "removed" : "tried to remove (failed)") : "would have removed";
  const tail = s.mode === "enforce" ? ` ${deleted} messages deleted.` : " (log-only mode, nothing removed)";
  await sendAlert(s, `🛡️ Group Guard ${verb} ${phoneE164} from ${groupName}: ${reason}.${tail}`);
  return { id: claimed.id, removed_ok: removedOk, deleted };
}

export async function guardOnJoin(svc: Svc, jid: string, phoneE164: string, raw: unknown) {
  try {
    const s = await loadGuardSettings(svc);
    if (s.mode === "off") return;
    if (s.targetGroups.length && !s.targetGroups.includes(jid)) return;
    const g = await isActiveGroup(svc, jid);
    if (!g.active) return;
    if (await isExempt(svc, s, jid, digits(phoneE164))) return;
    const { data: bl } = await svc.from("group_guard_actions").select("id").eq("phone", phoneE164).eq("action", "blocklisted").limit(1);
    if ((bl || []).length) return await act(svc, s, jid, g.name, phoneE164, "blocklisted_rejoin", raw);
    if (s.countryBlock && s.blockedPrefixes.some((p) => phoneE164.startsWith(p))) {
      return await act(svc, s, jid, g.name, phoneE164, `country_block ${s.blockedPrefixes.find((p) => phoneE164.startsWith(p))}`, raw);
    }
  } catch (e) { console.warn("[group-guard] join check failed:", (e as Error)?.message); }
}

export async function guardOnMessage(svc: Svc, jid: string, phoneE164: string, body: string, msgType: string, raw: unknown) {
  try {
    if (!phoneE164) return;
    const s = await loadGuardSettings(svc);
    if (s.mode === "off") return;
    // Owner request 2026-09-30: country block may enforce while flood guard stays log_only.
    if (s.mode === "enforce" && s.floodMode === "log_only") s.mode = "log_only";
    if (s.targetGroups.length && !s.targetGroups.includes(jid)) return;
    const g = await isActiveGroup(svc, jid);
    if (!g.active) return;
    if (await isExempt(svc, s, jid, digits(phoneE164))) return;

    const reasons: string[] = [];
    const floodSince = new Date(Date.now() - s.floodWindowSec * 1000).toISOString();
    const { count: floodCount } = await svc.from("maytapi_messages").select("id", { count: "exact", head: true })
      .eq("conversation_key", jid).eq("phone_e164", phoneE164).eq("direction", "inbound").gte("received_at", floodSince);
    if ((floodCount || 0) > s.floodMax) reasons.push(`${floodCount} msgs/${s.floodWindowSec}s`);

    if (body) {
      const { count: dupCount } = await svc.from("maytapi_messages").select("id", { count: "exact", head: true })
        .eq("conversation_key", jid).eq("phone_e164", phoneE164).eq("body", body)
        .gte("received_at", new Date(Date.now() - TEN_MIN_MS).toISOString());
      if ((dupCount || 0) >= s.dupMax) reasons.push(`same message x${dupCount} in 10 min`);
    }

    const isInvite = /group_invite/i.test(msgType) || /chat\.whatsapp\.com|t\.me\//i.test(body || "");
    if (isInvite) {
      const { data: j } = await svc.from("whatsapp_group_membership_events").select("id")
        .eq("group_jid", jid).eq("member_phone", phoneE164).eq("event_type", "joined")
        .gte("event_time", new Date(Date.now() - 24 * 3600_000).toISOString()).limit(1);
      if ((j || []).length) reasons.push("invite link from new joiner (<24h)");
    }
    if (!reasons.length) return;
    return await act(svc, s, jid, g.name, phoneE164, reasons.join(", "), { msgType, body: (body || "").slice(0, 300) });
  } catch (e) { console.warn("[group-guard] message check failed:", (e as Error)?.message); }
}
