import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_contacts",
  title: "List contacts",
  description:
    "List CRM contacts visible to the signed-in user, newest first. Optional filters by lead type, temperature, tag or free-text search on name/phone.",
  inputSchema: {
    lead_type: z.string().optional().describe("Filter by lead type."),
    temperature: z.string().optional().describe("Filter by temperature (hot/warm/cold)."),
    tag: z.string().optional().describe("Filter by a single tag."),
    search: z.string().optional().describe("Free-text match on name or phone."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ lead_type, temperature, tag, search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    let query = supabase
      .from("contacts")
      .select("id, name, phone_normalized, email, lead_type, temperature, tags, notes, do_not_contact, updated_at")
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .limit(limit ?? 25);
    if (lead_type) query = query.eq("lead_type", lead_type);
    if (temperature) query = query.eq("temperature", temperature);
    if (tag) query = query.contains("tags", [tag]);
    if (search) query = query.or(`name.ilike.%${search}%,phone_normalized.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify({ count: data?.length ?? 0, contacts: data ?? [] }, null, 2) }],
      structuredContent: { count: data?.length ?? 0, contacts: data ?? [] },
    };
  },
});
