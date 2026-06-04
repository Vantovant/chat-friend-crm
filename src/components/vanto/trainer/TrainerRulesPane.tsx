import { useEffect, useState } from "react";
import { Plus, Trash2, Save, X, Loader2, Power } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { TrainerChannel } from "../AutoReplyTrainerModule";

type Priority = "advisory" | "strong" | "override";

interface TrainerRule {
  id: string;
  title: string;
  triggers: string[];
  product: string | null;
  instruction: string;
  priority: Priority;
  enabled: boolean;
  notes: string | null;
  channel: TrainerChannel;
  correct_answer: string | null;
  source_message_id: string | null;
  updated_at: string;
}

const PRIORITY_META: Record<Priority, { label: string; color: string; desc: string }> = {
  advisory: { label: "Advisory", color: "bg-muted text-muted-foreground", desc: "Considered when relevant" },
  strong: { label: "Strong", color: "bg-amber-500/15 text-amber-500", desc: "Followed unless contradicted" },
  override: { label: "Hard Override", color: "bg-destructive/15 text-destructive", desc: "Beats inference" },
};

const EMPTY = {
  title: "",
  triggers: [] as string[],
  product: "",
  instruction: "",
  priority: "strong" as Priority,
  enabled: true,
  notes: "",
  correct_answer: "",
};

export default function TrainerRulesPane({ channel }: { channel: TrainerChannel }) {
  const [rules, setRules] = useState<TrainerRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TrainerRule | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ai_trainer_rules" as any)
      .select("*")
      .eq("channel", channel)
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) toast({ title: "Failed to load rules", description: error.message, variant: "destructive" });
    else setRules((data || []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [channel]);

  const startNew = () => { setEditing({ id: "" } as TrainerRule); setDraft(EMPTY); };
  const startEdit = (r: TrainerRule) => {
    setEditing(r);
    setDraft({
      title: r.title, triggers: r.triggers || [], product: r.product || "",
      instruction: r.instruction, priority: r.priority, enabled: r.enabled,
      notes: r.notes || "", correct_answer: r.correct_answer || "",
    });
  };
  const cancel = () => { setEditing(null); setDraft(EMPTY); };

  const save = async () => {
    if (!draft.title.trim() || !draft.instruction.trim()) {
      toast({ title: "Title and instruction are required", variant: "destructive" });
      return;
    }
    const payload: any = {
      title: draft.title.trim(),
      triggers: draft.triggers.map((t) => t.trim()).filter(Boolean),
      product: draft.product?.trim() || null,
      instruction: draft.instruction.trim(),
      priority: draft.priority,
      enabled: draft.enabled,
      notes: draft.notes?.trim() || null,
      correct_answer: draft.correct_answer?.trim() || null,
      channel,
    };
    let error;
    if (editing && editing.id) {
      ({ error } = await supabase.from("ai_trainer_rules" as any).update(payload).eq("id", editing.id));
    } else {
      const { data: u } = await supabase.auth.getUser();
      ({ error } = await supabase.from("ai_trainer_rules" as any).insert({ ...payload, created_by: u.user?.id }));
    }
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Trainer rule saved" }); cancel(); load(); }
  };

  const toggleEnabled = async (r: TrainerRule) => {
    const { error } = await supabase.from("ai_trainer_rules" as any).update({ enabled: !r.enabled }).eq("id", r.id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else load();
  };

  const remove = async (r: TrainerRule) => {
    if (!confirm(`Delete rule "${r.title}"?`)) return;
    const { error } = await supabase.from("ai_trainer_rules" as any).delete().eq("id", r.id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Rule deleted" }); load(); }
  };

  const visible = rules.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.title.toLowerCase().includes(q) ||
      (r.product || "").toLowerCase().includes(q) ||
      (r.triggers || []).some((t) => t.toLowerCase().includes(q)) ||
      r.instruction.toLowerCase().includes(q)
    );
  });

  return (
    <div className="vanto-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-foreground">Trainer Rules</h3>
          <p className="text-xs text-muted-foreground">{rules.length} rule{rules.length === 1 ? "" : "s"} for this channel</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules…"
            className="h-9 px-3 rounded-md border border-input bg-background text-sm w-48" />
          <button onClick={startNew}
            className="px-3 h-9 rounded-md vanto-gradient text-primary-foreground text-sm font-medium flex items-center gap-1">
            <Plus size={14} /> New Rule
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading rules…
        </div>
      ) : visible.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-md">
          No trainer rules for this channel yet. Use the Inbound Feed to correct an AI reply, or click <strong>New Rule</strong> to add one manually.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <div key={r.id} className={cn("border border-border/50 rounded-md p-3 bg-secondary/20", !r.enabled && "opacity-50")}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-medium", PRIORITY_META[r.priority].color)}>
                      {PRIORITY_META[r.priority].label}
                    </span>
                    {r.product && <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">{r.product}</span>}
                    <span className="text-sm font-semibold text-foreground truncate">{r.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{r.instruction}</p>
                  {r.correct_answer && (
                    <p className="text-[11px] text-foreground bg-background/40 border border-border/40 rounded p-2 mb-2 line-clamp-2">
                      <span className="font-semibold text-primary">Canonical reply: </span>{r.correct_answer}
                    </p>
                  )}
                  {r.triggers?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.triggers.map((t, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-secondary/60 text-[10px] text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleEnabled(r)} title={r.enabled ? "Disable" : "Enable"} className="p-1.5 rounded hover:bg-secondary/60">
                    <Power size={14} className={r.enabled ? "text-primary" : "text-muted-foreground"} />
                  </button>
                  <button onClick={() => startEdit(r)} className="px-2 h-7 rounded text-xs hover:bg-secondary/60">Edit</button>
                  <button onClick={() => remove(r)} className="p-1.5 rounded hover:bg-destructive/10">
                    <Trash2 size={14} className="text-destructive" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="vanto-card w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={cancel} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
            <h4 className="text-base font-bold text-foreground mb-1">{editing.id ? "Edit Trainer Rule" : "New Trainer Rule"}</h4>
            <p className="text-[11px] text-muted-foreground mb-4">Channel: <span className="text-primary font-semibold capitalize">{channel}</span></p>
            <div className="space-y-3">
              <Field label="Title*">
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" />
              </Field>
              <Field label="Trigger phrases (comma-separated)">
                <input value={draft.triggers.join(", ")}
                  onChange={(e) => setDraft({ ...draft, triggers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  placeholder="tired, fatigue, low energy"
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" />
              </Field>
              <Field label="Product / topic (optional)">
                <input value={draft.product || ""} onChange={(e) => setDraft({ ...draft, product: e.target.value })}
                  placeholder="e.g. PWR LEMON" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" />
              </Field>
              <Field label="Instruction to the AI*">
                <textarea value={draft.instruction} onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
                  rows={4} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
              </Field>
              <Field label="Canonical reply (override priority only — optional)">
                <textarea value={draft.correct_answer} onChange={(e) => setDraft({ ...draft, correct_answer: e.target.value })}
                  rows={3} placeholder="Exact text the AI should reply with for this trigger…"
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
              </Field>
              <Field label="Priority">
                <div className="grid grid-cols-3 gap-2">
                  {(["advisory", "strong", "override"] as Priority[]).map((p) => (
                    <button key={p} type="button" onClick={() => setDraft({ ...draft, priority: p })}
                      className={cn("p-2 rounded-md border text-left text-xs",
                        draft.priority === p ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/40")}>
                      <p className="font-semibold text-foreground">{PRIORITY_META[p].label}</p>
                      <p className="text-[10px] text-muted-foreground">{PRIORITY_META[p].desc}</p>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Internal notes (optional)">
                <textarea value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  rows={2} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
              </Field>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  className="accent-[hsl(var(--primary))]" /> Enabled
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={cancel} className="flex-1 py-2 rounded-md border border-border text-sm">Cancel</button>
              <button onClick={save} className="flex-1 py-2 rounded-md vanto-gradient text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2">
                <Save size={14} /> Save Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      {children}
    </div>
  );
}
