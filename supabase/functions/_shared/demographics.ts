// Shared demographic-capture helper for Vanto prospector flows
// (Maytapi + Twilio inbound). Parses email / city / province from inbound
// WhatsApp text, persists onto the contact, and — when the prospect has
// shown interest but we're still missing data — appends one polite ask
// onto the outbound reply (once, tracked via demographics_asked_at).

export const ZA_PROVINCES: Record<string, string> = {
  "gauteng": "Gauteng",
  "gp": "Gauteng",
  "western cape": "Western Cape",
  "wc": "Western Cape",
  "eastern cape": "Eastern Cape",
  "ec": "Eastern Cape",
  "northern cape": "Northern Cape",
  "nc": "Northern Cape",
  "kwazulu-natal": "KwaZulu-Natal",
  "kwazulu natal": "KwaZulu-Natal",
  "kzn": "KwaZulu-Natal",
  "free state": "Free State",
  "fs": "Free State",
  "limpopo": "Limpopo",
  "lp": "Limpopo",
  "mpumalanga": "Mpumalanga",
  "mp": "Mpumalanga",
  "north west": "North West",
  "nw": "North West",
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// "I live in Cape Town", "I'm in Pretoria", "from Soweto", "based in Durban"
const CITY_RE = /\b(?:i\s+live\s+in|i'?m\s+in|i\s+am\s+in|from|based\s+in|stay\s+in|reside\s+in|located\s+in)\s+([A-Z][A-Za-z' -]{1,40})\b/i;
// "City: Cape Town" / "Province: Gauteng"
const LABELLED_CITY_RE = /\bcity\s*[:\-]\s*([A-Za-z][A-Za-z' -]{1,40})/i;
const LABELLED_PROV_RE = /\bprovince\s*[:\-]\s*([A-Za-z][A-Za-z' -]{1,40})/i;
const LABELLED_EMAIL_RE = /\bemail\s*[:\-]\s*([^\s,]+@[^\s,]+)/i;

export type ParsedDemographics = {
  email?: string;
  city?: string;
  province?: string;
};

export function parseDemographics(text: string): ParsedDemographics {
  if (!text) return {};
  const out: ParsedDemographics = {};

  const labelledEmail = text.match(LABELLED_EMAIL_RE)?.[1];
  const freeEmail = text.match(EMAIL_RE)?.[0];
  const email = labelledEmail || freeEmail;
  if (email && /\S+@\S+\.\S+/.test(email)) out.email = email.trim().toLowerCase();

  const labelledCity = text.match(LABELLED_CITY_RE)?.[1]?.trim();
  const freeCity = text.match(CITY_RE)?.[1]?.trim();
  const city = labelledCity || freeCity;
  if (city && city.length >= 2 && city.length <= 60) out.city = titleCase(city);

  const labelledProv = text.match(LABELLED_PROV_RE)?.[1]?.trim();
  const provKey = labelledProv?.toLowerCase();
  if (provKey && ZA_PROVINCES[provKey]) {
    out.province = ZA_PROVINCES[provKey];
  } else {
    // Scan for any province token in the body
    const lower = ` ${text.toLowerCase()} `;
    for (const [k, v] of Object.entries(ZA_PROVINCES)) {
      if (k.length <= 3) continue; // skip abbreviations on free scan
      if (lower.includes(` ${k} `) || lower.includes(` ${k},`) || lower.includes(` ${k}.`)) {
        out.province = v;
        break;
      }
    }
  }

  return out;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ")
    .trim();
}

/**
 * Parse the inbound text for email / city / province and persist any new
 * fields onto the contact. Safe to call on every inbound message.
 * Returns the fields that were saved.
 */
export async function extractAndSaveDemographics(
  svc: any,
  contactId: string | null | undefined,
  inboundText: string,
): Promise<ParsedDemographics> {
  if (!contactId || !inboundText) return {};
  const parsed = parseDemographics(inboundText);
  if (!parsed.email && !parsed.city && !parsed.province) return {};

  const { data: existing } = await svc
    .from("contacts")
    .select("email, city, province")
    .eq("id", contactId)
    .maybeSingle();
  if (!existing) return {};

  const update: Record<string, unknown> = {};
  if (parsed.email && !existing.email) update.email = parsed.email;
  if (parsed.city && !existing.city) update.city = parsed.city;
  if (parsed.province && !existing.province) update.province = parsed.province;
  if (Object.keys(update).length === 0) return {};

  update.demographics_captured_at = new Date().toISOString();
  update.updated_at = new Date().toISOString();
  await svc.from("contacts").update(update).eq("id", contactId);
  return parsed;
}

/**
 * If the prospect just signaled interest, append ONE polite line asking for
 * the missing demographic fields. Stamps demographics_asked_at so we only ask
 * once. Returns possibly-modified reply text.
 */
export async function maybeAppendDemographicAsk(
  svc: any,
  contactId: string | null | undefined,
  replyText: string,
): Promise<{ message: string; appended: boolean; reason?: string }> {
  if (!contactId) return { message: replyText, appended: false, reason: "no_contact" };
  const { data: c } = await svc
    .from("contacts")
    .select("email, city, province, demographics_asked_at, demographics_captured_at, first_name, name")
    .eq("id", contactId)
    .maybeSingle();
  if (!c) return { message: replyText, appended: false, reason: "no_contact_row" };
  if (c.demographics_asked_at) return { message: replyText, appended: false, reason: "already_asked" };

  const missing: string[] = [];
  if (!c.email) missing.push("email address");
  if (!c.city) missing.push("city");
  if (!c.province) missing.push("province");
  if (missing.length === 0) return { message: replyText, appended: false, reason: "complete" };

  const first = (c.first_name || (c.name || "").split(" ")[0] || "").trim();
  const lead = first ? `${first}, to ` : "To ";
  const ask =
    `\n\n${lead}make sure you receive the right info from GetWellAfrica, could you share your ` +
    humanList(missing) +
    `? (Just reply, e.g. "Email: you@email.com, City: Pretoria, Province: Gauteng")`;

  await svc
    .from("contacts")
    .update({ demographics_asked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", contactId);

  return { message: `${replyText}${ask}`, appended: true };
}

function humanList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
