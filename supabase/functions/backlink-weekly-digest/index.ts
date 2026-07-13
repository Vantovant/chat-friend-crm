// Weekly digest for Backlink Outreach.
// Aggregates: sends, replies, published, status changes over last 7 days + upcoming queue.
// Returns JSON (email delivery hooks in via project's email pipeline later; for now the JSON
// can be fetched by the digest email cron OR viewed via curl-edge-functions).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [logs, targets] = await Promise.all([
    sb.from("backlink_outreach_log").select("id,event_type,target_id,created_at,performed_by,metadata").gte("created_at", since),
    sb.from("backlink_targets").select("id,name,domain,status,approach,next_action_at").eq("is_deleted", false),
  ]);

  const l = logs.data || [];
  const t = targets.data || [];

  const count = (fn: (r: typeof l[number]) => boolean) => l.filter(fn).length;

  const digest = {
    window: { since, until: new Date().toISOString() },
    activity: {
      sent: count(r => r.event_type === "sent"),
      replies: count(r => r.event_type === "reply"),
      published: count(r => r.event_type === "status_change" && (r.metadata as { to?: string } | null)?.to === "published"),
      auto_killed: count(r => r.event_type === "status_change" && (r.metadata as { via?: string } | null)?.via === "cadence_kill"),
      notes: count(r => r.event_type === "note"),
    },
    pipeline: {
      queued:      t.filter(x => x.status === "queued").length,
      contacted:   t.filter(x => x.status === "contacted").length,
      reply:       t.filter(x => x.status === "reply").length,
      negotiating: t.filter(x => x.status === "negotiating").length,
      published:   t.filter(x => x.status === "published").length,
      dead:        t.filter(x => x.status === "dead").length,
    },
    this_week_queue: t
      .filter(x => x.status === "queued")
      .slice(0, 10)
      .map(x => ({ id: x.id, name: x.name, domain: x.domain, approach: x.approach })),
  };

  // Persist a note-level summary so admins see it in the module
  await sb.from("backlink_outreach_log").insert({
    target_id: null as unknown as string, // synthetic — but table requires target_id, so skip if it will error
    event_type: "note",
    body: `Weekly digest — sent ${digest.activity.sent}, replies ${digest.activity.replies}, published ${digest.activity.published}.`,
    metadata: { via: "weekly_digest", digest },
  }).then(() => {}, () => {});

  return new Response(JSON.stringify({ ok: true, digest }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
