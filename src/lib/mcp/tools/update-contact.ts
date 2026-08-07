import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "update_contact",
  title: "Update a contact",
  description:
    "Update editable fields on a contact: name, email, lead type, temperature, tags, or the do-not-contact flag. Phone numbers are never changed here.",
  inputSchema: {
    contact_id: z.string().uuid().describe("Contact UUID."),
    name: z.string().optional(),
    email: z.string().email().nullable().optional(),
    lead_type: z.enum(["prospect", "registered", "buyer", "vip"]).optional(),
    temperature: z.enum(["hot", "warm", "cold"]).optional(),
    tags: z.array(z.string()).optional(),
    do_not_contact: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const { contact_id, ...fields } = input;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) updates[key] = value;
    }
    if (Object.keys(updates).length === 1) {
      return { content: [{ type: "text", text: "No updatable fields provided" }], isError: true };
    }

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("contacts")
      .update(updates)
      .eq("id", contact_id)
      .eq("is_deleted", false)
      .select("id, name, phone_normalized, email, lead_type, temperature, tags, do_not_contact, updated_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { contact: data },
    };
  },
});
