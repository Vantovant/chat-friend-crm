import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { executeSteps } from "./momentum-plan-logic";
import { adminApi, loadState, refuse, text } from "./momentum-api";

// SAFE DIRECTION ONLY: parks deliveries (hold). It can never schedule, send, resume or switch anything on.
export default defineTool({
  name: "momentum_pause",
  title: "Pause Momentum deliveries (hold)",
  description:
    "Safe-direction write: puts approved items back on hold, which parks their planned deliveries (nothing is deleted or sent). scope 'all' holds every item that has planned deliveries; scope 'item' holds one. A reason is required. Holding removes the item's approval until Vanto re-approves the exact text, so use it when Vanto says pause/stop. For an instant stop of ALL outbound WhatsApp also offer set_maytapi_freeze. Resuming is a separate, deliberate re-approval; this tool cannot resume.",
  inputSchema: { scope: z.enum(["all", "item"]), item_id: z.string().uuid().optional(), reason: z.string().min(3).max(300) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ scope, item_id, reason }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    if (scope === "item" && !item_id) return refuse("item_id is required when scope is 'item'.");
    const api = adminApi(supabaseForUser(ctx));
    const st = await loadState(api); if ("error" in st) return refuse(st.error);
    const targets = st.items.filter((i) => (scope === "item" ? i.id === item_id : true) && ["approved", "in_review"].includes(i.status) && !i.held && (i.deliveries ?? []).some((d) => d.status === "planned"));
    if (targets.length === 0) return text({ paused: [], message: "Nothing to pause: no item with planned deliveries that is not already on hold." });
    const out: any[] = [];
    for (const t of targets) {
      const r = await api("hold", { item_id: t.id, reason, via: "mcp" });
      out.push({ item: t.title, ok: !!r.ok, deliveries_held: r.deliveries_held ?? null, error: r.ok ? undefined : r.error });
    }
    return text({ paused: out, message: "Held. Nothing was deleted. Each item needs Vanto's re-approval of its exact text before it can be scheduled again.", also_available: "set_maytapi_freeze stops all outbound WhatsApp instantly." });
  },
});
