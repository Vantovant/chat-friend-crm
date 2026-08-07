import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_contact",
  title: "Get a contact",
  description:
    "Fetch one contact by id or normalized phone number, together with its 10 most recent activity records.",
  inputSchema: {
    contact_id: z.string().uuid().optional().describe("Contact UUID."),
    phone_normalized: z.string().optional().describe("Phone in +E164 format."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contact_id, phone_normalized }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    if (!contact_id && !phone_normalized) {
      return { content: [{ type: "text", text: "Provide contact_id or phone_normalized" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    let query = supabase.from("contacts").select("*").eq("is_deleted", false).limit(1);
    query = contact_id ? query.eq("id", contact_id) : query.eq("phone_normalized", phone_normalized!);
    const { data: contact, error } = await query.maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!contact) return { content: [{ type: "text", text: "Contact not found" }], isError: true };

    const { data: recentActivity } = await supabase
      .from("contact_activity")
      .select("type, metadata, created_at")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false })
      .limit(10);

    const result = { contact, recent_activity: recentActivity ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
