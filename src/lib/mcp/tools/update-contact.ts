import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "update_contact",
  title: "Update a contact",
  description:
    "Update editable fields on a contact: name, email, lead type, temperature, tags, notes, pipeline stage, or the do-not-contact flag. Phone numbers are never changed here. A pipeline stage change is logged to contact_activity.",
  inputSchema: {
    contact_id: z.string().uuid().describe("Contact UUID."),
    name: z.string().optional(),
    email: z.string().email().nullable().optional(),
    lead_type: z.enum(["prospect", "registered", "buyer", "vip"]).optional(),
    temperature: z.enum(["hot", "warm", "cold"]).optional(),
    tags: z.array(z.string()).optional(),
    do_not_contact: z.boolean().optional(),
    notes: z.string().nullable().optional(),
    stage_id: z.string().uuid().nullable().optional().describe("Pipeline stage UUID, or null to unassign."),
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

    let prevStageId: string | null = null;
    const stageChangeRequested = fields.stage_id !== undefined;
    if (stageChangeRequested) {
      const { data: current, error: readErr } = await supabase
        .from("contacts")
        .select("stage_id")
        .eq("id", contact_id)
        .eq("is_deleted", false)
        .maybeSingle();
      if (readErr) return { content: [{ type: "text", text: readErr.message }], isError: true };
      if (!current) return { content: [{ type: "text", text: "Contact not found" }], isError: true };
      prevStageId = (current.stage_id as string | null) ?? null;
    }

    const { data, error } = await supabase
      .from("contacts")
      .update(updates)
      .eq("id", contact_id)
      .eq("is_deleted", false)
      .select("id, name, phone_normalized, email, lead_type, temperature, tags, notes, stage_id, do_not_contact, updated_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    let stage_change_logged = false;
    const newStageId = (fields.stage_id ?? null) as string | null;
    if (stageChangeRequested && prevStageId !== newStageId) {
      const stageIds = [prevStageId, newStageId].filter((id): id is string => !!id);
      const nameById = new Map<string, string>();
      if (stageIds.length > 0) {
        const { data: stages } = await supabase.from("pipeline_stages").select("id, name").in("id", stageIds);
        for (const s of (stages ?? []) as Record<string, any>[]) nameById.set(s.id, s.name);
      }
      const performedBy = ctx.getUserId();
      if (performedBy) {
        const { error: actErr } = await supabase.from("contact_activity").insert({
          contact_id,
          performed_by: performedBy,
          type: "stage_changed",
          metadata: {
            from_stage: (prevStageId && nameById.get(prevStageId)) || "Unassigned",
            to_stage: (newStageId && nameById.get(newStageId)) || "Unassigned",
            from_stage_id: prevStageId,
            to_stage_id: newStageId,
            source: "lead_call_report",
          },
        });
        stage_change_logged = !actErr;
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ contact: data, stage_change_logged }) }],
      structuredContent: { contact: data, stage_change_logged },
    };
  },
});
