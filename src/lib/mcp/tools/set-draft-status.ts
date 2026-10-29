import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "set_draft_status",
  title: "Set a message draft's status",
  description:
    "WRITES: sets one Call Sheet draft to approved, rejected or sent_by_vanto (sent_by_vanto only records that Vanto sent it himself; this tool sends nothing). Approval needs Vanto's explicit instruction in this conversation: pass explicit_user_instruction: true only when Vanto has clearly said to approve this exact draft. Never approve on your own judgement.",
  inputSchema: {
    draft_id: z.string().uuid(),
    status: z.enum(["approved", "rejected", "sent_by_vanto"]),
    explicit_user_instruction: z.boolean().optional().describe("Required true for approved: Vanto explicitly asked to approve this draft."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ draft_id, status, explicit_user_instruction }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    if (status === "approved" && explicit_user_instruction !== true) {
      return { content: [{ type: "text", text: "Refused: approving a draft needs Vanto's explicit instruction (explicit_user_instruction: true)." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const patch: Record<string, unknown> = { status };
    if (status === "approved") patch.approved_via = "connector";
    const { data, error } = await supabase.from("call_list_drafts").update(patch as never).eq("id", draft_id)
      .select("id, contact_id, status, approved_at, approved_via").maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Draft not found." }], isError: true };
    const result = { draft: data as { id: string; contact_id: string; status: string; approved_at: string | null; approved_via: string | null }, sent: false };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
