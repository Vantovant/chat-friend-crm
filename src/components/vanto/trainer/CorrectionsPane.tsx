import { useEffect, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { TrainerChannel } from "../AutoReplyTrainerModule";

type Correction = {
  id: string;
  channel: string;
  original_message: string;
  original_reply: string | null;
  corrected_reply: string;
  reason: string | null;
  created_at: string;
  trainer_rule_id: string | null;
  rule?: { title: string; enabled: boolean } | null;
};

export default function CorrectionsPane({ channel }: { channel: TrainerChannel }) {
  const [rows, setRows] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("auto_reply_corrections" as any)
      .select("id, channel, original_message, original_reply, corrected_reply, reason, created_at, trainer_rule_id, ai_trainer_rules(title, enabled)")
      .eq("channel", channel)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast({ title: "Failed to load corrections", description: error.message, variant: "destructive" });
    setRows(((data || []) as any[]).map((r) => ({ ...r, rule: r.ai_trainer_rules || null })));
    setLoading(false);
  };

  useEffect(() => { load(); }, [channel]);

  return (
    <div className="vanto-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <History size={14} className="text-primary" /> Correction History
          </h3>
          <p className="text-xs text-muted-foreground">{rows.length} correction{rows.length === 1 ? "" : "s"} for this channel</p>
        </div>
        <button onClick={load} disabled={loading} className="p-2 rounded hover:bg-secondary/60" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin text-muted-foreground" : "text-foreground"} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-md">
          No corrections recorded for this channel yet.
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {rows.map((c) => (
            <details key={c.id} className="border border-border/50 rounded-md bg-secondary/20">
              <summary className="cursor-pointer p-3 flex items-center justify-between gap-2 hover:bg-secondary/30">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {c.rule?.title || "(rule deleted)"}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.original_message.slice(0, 100)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.rule && !c.rule.enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">disabled</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
              </summary>
              <div className="px-3 pb-3 space-y-2 text-xs">
                <div>
                  <p className="font-semibold text-muted-foreground mb-1">User message</p>
                  <p className="bg-background/40 rounded p-2 border border-border/40">{c.original_message}</p>
                </div>
                {c.original_reply && (
                  <div>
                    <p className="font-semibold text-muted-foreground mb-1">Original AI reply</p>
                    <p className="bg-background/40 rounded p-2 border border-border/40 line-through opacity-70">{c.original_reply}</p>
                  </div>
                )}
                <div>
                  <p className="font-semibold text-primary mb-1">Corrected reply</p>
                  <p className="bg-primary/5 rounded p-2 border border-primary/20">{c.corrected_reply}</p>
                </div>
                {c.reason && (
                  <div>
                    <p className="font-semibold text-muted-foreground mb-1">Reason</p>
                    <p className="text-foreground">{c.reason}</p>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
