import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "add_contact_note",
  title: "Add a note to a contact",
  description:
    "Append a timestamped note to a contact's notes field and record it on the contact activity trail.",
  inputSchema: {
    contact_id: z.string().uuid().describe("Contact UUID."),
    note: z.string().min(1).describe("Note text to append."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ contact_id, note }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data: existing, error: fetchErr } = await supabase
      .from("contacts")
      .select("notes")
      .eq("id", contact_id)
      .eq("is_deleted", false)
      .maybeSingle();
    if (fetchErr) return { content: [{ type: "text", text: fetchErr.message }], isError: true };
    if (!existing) return { content: [{ type: "text", text: "Contact not found" }], isError: true };

    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const appended = existing.notes
      ? `${existing.notes}\n\n[${stamp} · via MCP] ${note}`
      : `[${stamp} · via MCP] ${note}`;

    const { data: updated, error: updateErr } = await supabase
      .from("contacts")
      .update({ notes: appended, updated_at: new Date().toISOString() })
      .eq("id", contact_id)
      .select("id, notes")
      .single();
    if (updateErr) return { content: [{ type: "text", text: updateErr.message }], isError: true };

    await supabase.from("contact_activity").insert({
      contact_id,
      type: "note_added",
      performed_by: ctx.getUserId(),
      metadata: { source: "mcp", note_preview: note.slice(0, 160) },
    });

    return {
      content: [{ type: "text", text: updated.notes ?? "" }],
      structuredContent: { contact_id, notes: updated.notes },
    };
  },
});
