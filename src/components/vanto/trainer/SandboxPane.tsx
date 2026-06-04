import { useState } from "react";
import { Beaker, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { TrainerChannel } from "../AutoReplyTrainerModule";

type Result = {
  question: string;
  detected_product: string | null;
  matched_rules: string[];
  knowledge_hits: number;
  reply: string | null;
  raw_error?: string | null;
};

export default function SandboxPane({ channel }: { channel: TrainerChannel }) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async () => {
    if (!input.trim()) return;
    setRunning(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("auto-reply-dryrun", {
      body: { questions: [input.trim()], channel },
    });
    setRunning(false);
    if (error) {
      toast({ title: "Sandbox call failed", description: error.message, variant: "destructive" });
      return;
    }
    const first = (data as any)?.results?.[0];
    if (first) setResult(first);
    else toast({ title: "No result returned", variant: "destructive" });
  };

  return (
    <div className="vanto-card p-4 space-y-3">
      <div>
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          <Beaker size={14} className="text-primary" /> Test Sandbox
        </h3>
        <p className="text-xs text-muted-foreground">
          Send a fake user message through the live AI pipeline (using <span className="capitalize text-primary">{channel}</span> trainer rules). Nothing is saved or sent.
        </p>
      </div>

      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder='e.g. "I am always tired"'
          onKeyDown={(e) => e.key === "Enter" && !running && run()}
          className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm" />
        <button onClick={run} disabled={running || !input.trim()}
          className="px-3 h-9 rounded-md vanto-gradient text-primary-foreground text-sm font-medium flex items-center gap-1 disabled:opacity-50">
          {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Run
        </button>
      </div>

      {result && (
        <div className="space-y-2 pt-2 border-t border-border/40">
          <div className="flex flex-wrap gap-2 text-[10px]">
            {result.detected_product && (
              <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">Product: {result.detected_product}</span>
            )}
            <span className="px-2 py-0.5 rounded bg-secondary/60 text-muted-foreground">{result.knowledge_hits} knowledge hits</span>
            <span className="px-2 py-0.5 rounded bg-secondary/60 text-muted-foreground">{result.matched_rules.length} trainer rule matches</span>
          </div>

          {result.matched_rules.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground">Matched rules:</p>
              {result.matched_rules.map((r, i) => {
                const [priority, ...rest] = r.split(":");
                const title = rest.join(":");
                return (
                  <div key={i} className="text-xs flex items-center gap-2">
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium",
                      priority === "override" ? "bg-destructive/15 text-destructive"
                      : priority === "strong" ? "bg-amber-500/15 text-amber-500"
                      : "bg-muted text-muted-foreground")}>{priority}</span>
                    <span className="text-foreground">{title}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <p className="text-[11px] font-semibold text-muted-foreground mb-1">AI reply:</p>
            <div className="text-sm bg-primary/5 border border-primary/20 rounded p-3 whitespace-pre-wrap">
              {result.reply || <span className="text-destructive italic">No reply — {result.raw_error || "unknown error"}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
