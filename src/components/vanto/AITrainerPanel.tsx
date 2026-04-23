import { useEffect, useState } from "react";
import { Plus, Trash2, Save, X, Loader2, Sparkles, Power, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
  updated_at: string;
}

const PRIORITY_META: Record<Priority, { label: string; color: string; desc: string }> = {
  advisory: { label: "Advisory", color: "bg-muted text-muted-foreground", desc: "Considered when relevant" },
  strong: { label: "Strong", color: "bg-amber-500/15 text-amber-500", desc: "Followed unless contradicted by knowledge" },
  override: { label: "Hard Override", color: "bg-destructive/15 text-destructive", desc: "Beats inference — must follow" },
};

const EMPTY: Omit<TrainerRule, "id" | "updated_at"> = {
  title: "",
  triggers: [],
  product: "",
  instruction: "",
  priority: "strong",
  enabled: true,
  notes: "",
};

export default function AITrainerPanel() {
  const [rules, setRules] = useState<TrainerRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TrainerRule | null>(null);
  const [draft, setDraft] = useState<typeof EMPTY>(EMPTY);
  const [search, setSearch] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<TrainerRule[]>([]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ai_trainer_rules" as any)
      .select("*")
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load rules", description: error.message, variant: "destructive" });
    } else {
      setRules((data || []) as any);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing({ id: "", updated_at: "", ...EMPTY } as TrainerRule); setDraft(EMPTY); };
  const startEdit = (r: TrainerRule) => {
    setEditing(r);
    setDraft({
      title: r.title, triggers: r.triggers || [], product: r.product || "",
      instruction: r.instruction, priority: r.priority, enabled: r.enabled, notes: r.notes || "",
    });
  };
  const cancel = () => { setEditing(null); setDraft(EMPTY); };

  const save = async () => {
    if (!draft.title.trim() || !draft.instruction.trim()) {
      toast({ title: "Title and instruction are required", variant: "destructive" });
      return;
    }
    const payload = {
      title: draft.title.trim(),
      triggers: draft.triggers.map((t) => t.trim()).filter(Boolean),
      product: draft.product?.trim() || null,
      instruction: draft.instruction.trim(),
      priority: draft.priority,
      enabled: draft.enabled,
      notes: draft.notes?.trim() || null,
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

  const runTest = () => {
    const lc = testInput.toLowerCase();
    const matched = rules.filter((r) => {
      if (!r.enabled) return false;
      const productHit = r.product && lc.includes(r.product.toLowerCase());
      const triggerHit = (r.triggers || []).some((t) => t && lc.includes(t.toLowerCase()));
      return productHit || triggerHit;
    });
    const weight = { override: 3, strong: 2, advisory: 1 } as const;
    matched.sort((a, b) => weight[b.priority] - weight[a.priority]);
    setTestResult(matched);
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
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-foreground mb-1 flex items-center gap-2">
          <Sparkles size={16} className="text-primary" /> AI Trainer Rules
        </h3>
        <p className="text-xs text-muted-foreground">
          Teach and correct the WhatsApp AI without code. Trainer rules are applied <em>before</em> the AI generates a reply,
          on top of Knowledge Vault grounding. Hard Overrides win over generic inference.
        </p>
      </div>

      {/* Test box */}
      <div className="vanto-card p-4 space-y-3">
        <p className="text-xs font-semibold text-foreground flex items-center gap-2">
          <AlertTriangle size={12} className="text-primary" /> Test Trainer
        </p>
        <div className="flex gap-2">
          <input
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="e.g. I'm always tired"
            className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
            onKeyDown={(e) => e.key === "Enter" && runTest()}
          />
          <button onClick={runTest} className="px-3 h-9 rounded-md vanto-gradient text-primary-foreground text-sm font-medium">
            Match
          </button>
        </div>
        {testResult.length > 0 ? (
          <div className="space-y-2">
            {testResult.map((r) => (
              <div key={r.id} className="rounded-md border border-border/50 bg-secondary/30 p-2 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("px-2 py-0.5 rounded text-[10px] font-medium", PRIORITY_META[r.priority].color)}>
                    {PRIORITY_META[r.priority].label}
                  </span>
                  <span className="font-medium">{r.title}</span>
                </div>
                <p className="text-muted-foreground">{r.instruction}</p>
              </div>
            ))}
          </div>
        ) : testInput && (
          <p className="text-[11px] text-muted-foreground">No trainer rules matched. AI will rely on Knowledge Vault only.</p>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rules…"
          className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
        />
        <button onClick={startNew} className="px-3 h-9 rounded-md vanto-gradient text-primary-foreground text-sm font-medium flex items-center gap-1">
          <Plus size={14} /> New Rule
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 size={14} className="animate-spin" /> Loading rules…</div>
      ) : visible.length === 0 ? (
        <div className="vanto-card p-6 text-center text-sm text-muted-foreground">No trainer rules yet. Click <strong>New Rule</strong> to teach the AI.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <div key={r.id} className={cn("vanto-card p-3", !r.enabled && "opacity-50")}>
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

      {/* Editor modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="vanto-card w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={cancel} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
            <h4 className="text-base font-bold text-foreground mb-4">{editing.id ? "Edit Trainer Rule" : "New Trainer Rule"}</h4>
            <div className="space-y-3">
              <Field label="Title*">
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" />
              </Field>
              <Field label="Trigger phrases (comma-separated)" hint="The AI will match these against the user's message.">
                <input
                  value={draft.triggers.join(", ")}
                  onChange={(e) => setDraft({ ...draft, triggers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  placeholder="tired, fatigue, low energy"
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" />
              </Field>
              <Field label="Product / topic (optional)">
                <input value={draft.product || ""} onChange={(e) => setDraft({ ...draft, product: e.target.value })}
                  placeholder="e.g. PWR" className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" />
              </Field>
              <Field label="Instruction to the AI*" hint="Plain English. The AI will follow this when the rule matches.">
                <textarea value={draft.instruction} onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
                  rows={5}
                  placeholder='Never say "PWR" alone. PWR Lemon = men, PWR Apricot = women. If gender unknown, ask first.'
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm" />
              </Field>
              <Field label="Priority">
                <div className="grid grid-cols-3 gap-2">
                  {(["advisory", "strong", "override"] as Priority[]).map((p) => (
                    <button key={p} type="button" onClick={() => setDraft({ ...draft, priority: p })}
                      className={cn(
                        "p-2 rounded-md border text-left text-xs",
                        draft.priority === p ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/40"
                      )}>
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
