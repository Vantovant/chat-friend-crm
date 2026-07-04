// Welcome-bundle helper (2026-07-04).
// Adds two blog links to the FIRST outbound message a prospect ever receives:
//   • 2-minute intro to APLGO / Get Well Africa
//   • 9-step registration guide
//
// Idempotent per contact via a `contact_activity` row of type=welcome_bundle_sent.
// Callers: whatsapp-auto-reply (first_touch_trust_message), cadence-tick (step 1
// of prospect_7touch_v1). Does NOT change any cadence, throttle, cap, quiet-hour,
// group-allowlist, or trust-wrap logic. Two links only, appended at end of the
// body. If the setting welcome_bundle_enabled != "true" the helper is a no-op.

const DEFAULT_INTRO = "https://getwellafrica.com/blog/welcome-to-wellness-aplgo-2-minute-intro";
const DEFAULT_REGISTER = "https://getwellafrica.com/blog/how-to-register-and-order-aplgo-in-9-steps";

interface Cfg {
  enabled: boolean;
  intro: string;
  register: string;
}

async function loadCfg(svc: any): Promise<Cfg> {
  const { data } = await svc
    .from("integration_settings")
    .select("key,value")
    .in("key", ["welcome_bundle_enabled", "welcome_intro_blog_url", "welcome_register_blog_url"]);
  const m: Record<string, string> = {};
  for (const r of (data || []) as any[]) m[r.key] = (r.value || "").trim();
  return {
    enabled: (m.welcome_bundle_enabled || "true").toLowerCase() === "true",
    intro: m.welcome_intro_blog_url || DEFAULT_INTRO,
    register: m.welcome_register_blog_url || DEFAULT_REGISTER,
  };
}

export function welcomeBundleLines(intro: string, register: string): string {
  return (
    `\n\n📖 New here? 2-minute intro:\n${intro}\n\n` +
    `📝 Ready to register? 9-step guide:\n${register}`
  );
}

/**
 * Returns true if the bundle has already been sent (or is queued) for this contact.
 */
export async function welcomeBundleAlreadySent(svc: any, contactId: string): Promise<boolean> {
  if (!contactId) return true;
  const { data } = await svc
    .from("contact_activity")
    .select("id")
    .eq("contact_id", contactId)
    .eq("type", "welcome_bundle_sent")
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * If enabled AND not-yet-sent for this contact, return { append, mark }.
 * `append` is the two-line block to add to the message body.
 * `mark` is an async fn to call AFTER the send succeeds to write the audit row.
 * If not applicable, returns { append: "", mark: noop }.
 */
export async function maybeWelcomeBundle(
  svc: any,
  contactId: string | null | undefined,
  opts?: { source?: string },
): Promise<{ append: string; mark: () => Promise<void>; applied: boolean }> {
  const noop = { append: "", mark: async () => {}, applied: false };
  if (!contactId) return noop;
  try {
    const cfg = await loadCfg(svc);
    if (!cfg.enabled) return noop;
    if (await welcomeBundleAlreadySent(svc, contactId)) return noop;
    const append = welcomeBundleLines(cfg.intro, cfg.register);
    return {
      append,
      applied: true,
      mark: async () => {
        await svc.from("contact_activity").insert({
          contact_id: contactId,
          type: "welcome_bundle_sent",
          content: opts?.source || "welcome_bundle",
          metadata: { intro: cfg.intro, register: cfg.register, source: opts?.source || null },
        }).then(() => {}).catch(() => {});
      },
    };
  } catch (_e) {
    return noop;
  }
}
