import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { normalizePhone } from "../../phone-utils";

const FIELDS = "id, name, phone_normalized, email, lead_type, contact_category, marketing_consent, auto_reply_enabled, notes, tags, created_by, created_at";

export default defineTool({
  name: "create_contact",
  title: "Create a contact",
  description:
    "Create a contact owned by the signed-in user, or return the existing one with the same phone (idempotent). Business/service/personal contacts get no marketing consent and are never enrolled in prospecting. Sends nothing.",
  inputSchema: {
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(6).max(40).describe("Any format; normalized to +E164 (ZA default)."),
    email: z.string().trim().email().max(255).optional(),
    category: z.enum(["prospect", "business", "service", "personal"]).default("prospect"),
    notes: z.string().max(4000).optional(),
    tags: z.array(z.string().max(60)).max(20).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ name, phone, email, category, notes, tags }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const userId = ctx.getUserId();
    if (!userId) return notAuthenticated;
    const phoneNorm = normalizePhone(phone);
    if (!phoneNorm || phoneNorm.replace(/\D/g, "").length < 11) {
      return { content: [{ type: "text", text: "Phone could not be normalized to +E164" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const find = () =>
      supabase.from("contacts").select(FIELDS).eq("created_by", userId)
        .eq("phone_normalized", phoneNorm).eq("is_deleted", false).maybeSingle();

    const existing = await find();
    if (existing.data) {
      const r = { created: false, contact: existing.data };
      return { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r };
    }
    const general = category !== "prospect";
    const { data, error } = await supabase.from("contacts").insert({
      name, phone: phoneNorm, phone_raw: phone, phone_normalized: phoneNorm,
      email: email?.toLowerCase() ?? null, notes: notes ?? null, tags: tags ?? [],
      created_by: userId, assigned_to: userId, owner_user_id: userId,
      contact_category: category, contact_source: "mcp_create_contact",
      ...(general ? { marketing_consent: false, auto_reply_enabled: false, lead_type: "unclassified" } : {}),
    }).select(FIELDS).single();
    if (error) {
      if (error.code === "23505") {
        const again = await find();
        if (again.data) {
          const r = { created: false, contact: again.data };
          return { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r };
        }
      }
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    await supabase.from("contact_activity").insert({ contact_id: data.id, performed_by: userId, type: "created", metadata: { source: "mcp_create_contact", category } });
    const r = { created: true, contact: data };
    return { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r };
  },
});
