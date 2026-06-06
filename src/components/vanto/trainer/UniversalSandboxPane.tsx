import { useState } from "react";
import { Globe, Loader2, Send, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";
import CorrectReplyModal, { CorrectionTarget } from "./CorrectReplyModal";

type Result = {
  question: string;
  detected_product: string | null;
  matched_rules: string[];
  knowledge_hits: number;
  reply: string | null;
  raw_error?: string | null;
};

export default function UniversalSandboxPane() {
  const currentUser = useCurrentUser();
  const canCorrect = currentUser?.role === "admin" || currentUser?.role === "super_admin";
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [target, setTarget] = useState<CorrectionTarget | null>(null);

  const run = async () => {
    if (!input.trim()) return;
    setRunning(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("auto-reply-dryrun", {
      body: { questions: [input.trim()], channel: "all" },
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

  const openCorrect = () => {
    if (!result) return;
    setTarget({
      channel: "all",
      originalMessage: result.question,
      originalReply: result.reply || "",
      messageId: null,
      contactId: null,
      contactLabel: "Universal correction (applies to Maytapi, Twilio, Facebook, Groups)",
    });
  };

  return (
    <div className="vanto-card p-4 space-y-3 border-primary/30">
      <div>
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          <Globe size={14} className="text-primary" /> Universal Sandbox & Correction
        </h3>
        <p className="text-xs text-muted-foreground">
          Test a question using rules from <span className="text-primary font-semibold">every channel</span>. Any correction saved here is applied across <span className="text-primary font-semibold">Maytapi, Twilio, Facebook and Groups</span>.
        </p>
      </div>

      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder='Ask anything — e.g. "How do I join APLGO?"'
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

          <div className="flex justify-end pt-1">
            <button onClick={openCorrect}
              disabled={!canCorrect}
              title={canCorrect ? "Save a universal correction (applies to every channel)" : "Admin or Super Admin role required"}
              className="text-xs px-3 h-8 rounded vanto-gradient text-primary-foreground font-semibold inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
              <Wand2 size={12} /> Correct this reply for all channels
            </button>
          </div>
        </div>
      )}

      {target && (
        <CorrectReplyModal
          target={target}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            toast({ title: "Universal correction saved", description: "Applied to Maytapi, Twilio, Facebook and Groups." });
          }}
        />
      )}
    </div>
  );
}
