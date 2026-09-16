import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

type Row = {
  origin: "mcp" | "organic";
  id: string;
  page_id: string | null;
  page_name: string | null;
  fb_post_id: string | null;
  message: string | null;
  image_url: string | null;
  permalink_url: string | null;
  status: string;
  scheduled_publish_time: string | null;
  published_at: string | null;
  effective_time: string | null;
  graph_error: unknown;
};

export default defineTool({
  name: "list_fb_posts",
  title: "List Facebook Page posts",
  description:
    "Read-only. Lists Facebook Page posts created through create_fb_post (status published / scheduled / failed, including ones still queued on Facebook's scheduler) merged with organic Page posts already ingested into fb_source_posts. Newest first by scheduled or published time. Use this to answer 'what's scheduled for the next few days' without a raw database query.",
  inputSchema: {
    page_id: z.string().optional().describe("Filter to one Facebook Page id."),
    status: z
      .enum(["published", "scheduled", "failed", "organic"])
      .optional()
      .describe("Filter by status. 'organic' returns only Page posts ingested from Facebook rather than created here."),
    since: z.string().optional().describe("ISO 8601 lower bound on the post's scheduled/published time."),
    until: z.string().optional().describe("ISO 8601 upper bound on the post's scheduled/published time."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows returned (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ page_id, status, since, until, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const max = limit ?? 25;
    const rows: Row[] = [];

    if (status !== "organic") {
      let q = supabase
        .from("fb_outbound_posts")
        .select(
          "id, page_id, page_name, fb_post_id, message, image_url, permalink_url, status, scheduled_publish_time, published_at, created_at, graph_error",
        )
        .order("created_at", { ascending: false })
        .limit(max * 2);
      if (page_id) q = q.eq("page_id", page_id);
      if (status) q = q.eq("status", status);

      const { data, error } = await q;
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };

      for (const r of data ?? []) {
        rows.push({
          origin: "mcp",
          id: r.id as string,
          page_id: r.page_id as string | null,
          page_name: (r.page_name as string | null) ?? null,
          fb_post_id: (r.fb_post_id as string | null) ?? null,
          message: (r.message as string | null) ?? null,
          image_url: (r.image_url as string | null) ?? null,
          permalink_url: (r.permalink_url as string | null) ?? null,
          status: r.status as string,
          scheduled_publish_time: (r.scheduled_publish_time as string | null) ?? null,
          published_at: (r.published_at as string | null) ?? null,
          effective_time:
            (r.scheduled_publish_time as string | null) ??
            (r.published_at as string | null) ??
            (r.created_at as string | null) ??
            null,
          graph_error: r.graph_error ?? null,
        });
      }
    }

    // Organic Page posts already ingested by the Facebook automation.
    if (!status || status === "organic" || status === "published") {
      const { data, error } = await supabase
        .from("fb_source_posts")
        .select("id, fb_post_id, raw_message, permalink_url, posted_at")
        .order("posted_at", { ascending: false, nullsFirst: false })
        .limit(max * 2);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };

      for (const r of data ?? []) {
        rows.push({
          origin: "organic",
          id: r.id as string,
          page_id: null,
          page_name: null,
          fb_post_id: (r.fb_post_id as string | null) ?? null,
          message: (r.raw_message as string | null) ?? null,
          image_url: null,
          permalink_url: (r.permalink_url as string | null) ?? null,
          status: "published",
          scheduled_publish_time: null,
          published_at: (r.posted_at as string | null) ?? null,
          effective_time: (r.posted_at as string | null) ?? null,
          graph_error: null,
        });
      }
    }

    const sinceMs = since ? Date.parse(since) : null;
    const untilMs = until ? Date.parse(until) : null;
    const filtered = rows
      .filter((r) => {
        if (!r.effective_time) return !sinceMs && !untilMs;
        const t = Date.parse(r.effective_time);
        if (sinceMs && t < sinceMs) return false;
        if (untilMs && t > untilMs) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.effective_time ?? "0") - Date.parse(a.effective_time ?? "0"))
      .slice(0, max);

    const result = { count: filtered.length, posts: filtered };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
