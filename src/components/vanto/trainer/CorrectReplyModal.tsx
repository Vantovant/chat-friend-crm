import { useState } from "react";
import { X, Save, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { TrainerChannel } from "../AutoReplyTrainerModule";

export type CorrectionTarget = {
  channel: TrainerChannel | "all";
  originalMessage: string;
  originalReply: string;
  messageId: string | null;
  contactId: string | null;
  contactLabel: string;
};

export default function CorrectReplyModal({
  target,
  onClose,
  onSaved,
}: {
  target: CorrectionTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [correctedReply, setCorrectedReply] = useState("");
  const [title, setTitle] = useState("");
  const [triggers, setTriggers] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!correctedReply.trim()) {
      toast({ title: "Corrected reply is required", variant: "destructive" });
      return;
    }
    if (!title.trim()) {
      toast({ title: "Rule title is required", variant: "destructive" });
      return;
    }
    setSaving(true);

    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id || null;

    // Default triggers: derived from first 4 significant words of the user message
    const derivedTriggers = triggers.trim()
      ? triggers.split(",").map((s) => s.trim()).filter(Boolean)
      : target.originalMessage
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 4)
          .slice(0, 4);

    // 1. Insert trainer rule (always new — Option A)
    const ruleRes: any = await supabase
      .from("ai_trainer_rules" as any)
      .insert({
        title: title.trim(),
        triggers: derivedTriggers,
        product: null,
        instruction: `When the user message matches this trigger, reply with the canonical text below verbatim. Do not paraphrase.`,
        priority: "override",
        enabled: true,
        notes: reason.trim() || null,
        channel: target.channel,
        correct_answer: correctedReply.trim(),
        source_message_id: target.messageId,
        created_by: userId,
      })
      .select("id")
      .single();

    if (ruleRes.error || !ruleRes.data) {
      setSaving(false);
      toast({ title: "Failed to create rule", description: ruleRes.error?.message, variant: "destructive" });
      return;
    }
    const newRuleId = (ruleRes.data as { id: string }).id;

    // 2. Insert correction audit row
    const { error: corrErr } = await supabase.from("auto_reply_corrections" as any).insert({
      channel: target.channel,
      contact_id: target.contactId,
      message_id: target.messageId,
      original_message: target.originalMessage,
      original_reply: target.originalReply || null,
      corrected_reply: correctedReply.trim(),
      reason: reason.trim() || null,
      trainer_rule_id: newRuleId,
      created_by: userId,
    });

    setSaving(false);
    if (corrErr) {
      toast({ title: "Rule saved, but audit row failed", description: corrErr.message, variant: "destructive" });
    } else {
      toast({ title: "Correction saved", description: "AI will use this canonical reply for matching messages." });
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="vanto-card w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
        <h4 className="text-base font-bold text-foreground mb-1 flex items-center gap-2">
          <AlertTriangle size={14} className="text-primary" /> Correct this reply
        </h4>
        <p className="text-[11px] text-muted-foreground mb-4">
          Channel: <span className="text-primary font-semibold capitalize">{target.channel}</span> · {target.contactLabel}
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">User message</label>
            <div className="text-sm bg-secondary/30 border border-border rounded p-2 max-h-24 overflow-y-auto">
              {target.originalMessage}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Original AI reply</label>
            <div className="text-sm bg-secondary/30 border border-border rounded p-2 max-h-32 overflow-y-auto">
              {target.originalReply || <span className="text-muted-foreground italic">(no AI reply captured)</span>}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Corrected reply (what the AI should have said) *</label>
            <textarea value={correctedReply} onChange={(e) => setCorrectedReply(e.target.value)} rows={5}
              placeholder="Type the canonical reply the AI must use next time…"
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Rule title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. PWR pricing — always include Lemon/Apricot"
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Trigger phrases (comma-separated). Leave blank to auto-derive from the user message.
            </label>
            <input value={triggers} onChange={(e) => setTriggers(e.target.value)}
              placeholder="pwr price, how much is pwr, cost of pwr"
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Why was the original reply wrong? (optional)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2 rounded-md border border-border text-sm">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-md vanto-gradient text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save correction
          </button>
        </div>
      </div>
    </div>
  );
}
