import { useEffect, useState } from "react";
import { Sparkles, MessageSquare, Smartphone, Users, FileText, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import TrainerRulesPane from "./trainer/TrainerRulesPane";
import InboundFeedPane from "./trainer/InboundFeedPane";
import SandboxPane from "./trainer/SandboxPane";
import CorrectionsPane from "./trainer/CorrectionsPane";
import { PlaybooksModule } from "./PlaybooksModule";

export type TrainerChannel = "maytapi" | "twilio" | "groups";

const CHANNELS: { id: TrainerChannel; label: string; icon: any; flagKey: string }[] = [
  { id: "maytapi", label: "Maytapi WhatsApp (DMs)", icon: Smartphone, flagKey: "trainer_channel_maytapi_enabled" },
  { id: "twilio", label: "Twilio WhatsApp", icon: MessageSquare, flagKey: "trainer_channel_twilio_enabled" },
  { id: "groups", label: "WhatsApp Groups", icon: Users, flagKey: "trainer_channel_groups_enabled" },
];

export function AutoReplyTrainerModule() {
  const [channel, setChannel] = useState<TrainerChannel>("maytapi");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [flagLoading, setFlagLoading] = useState(true);

  const loadFlags = async () => {
    setFlagLoading(true);
    const keys = CHANNELS.map((c) => c.flagKey);
    const { data } = await supabase
      .from("integration_settings")
      .select("key,value")
      .in("key", keys);
    const next: Record<string, boolean> = {};
    (data || []).forEach((r: any) => {
      next[r.key] = r.value === "true" || r.value === "1";
    });
    setFlags(next);
    setFlagLoading(false);
  };

  useEffect(() => { loadFlags(); }, []);

  const toggleFlag = async (flagKey: string) => {
    const current = flags[flagKey] || false;
    const nextVal = !current;
    const { error } = await supabase
      .from("integration_settings")
      .upsert({ key: flagKey, value: nextVal ? "true" : "false" }, { onConflict: "key" });
    if (error) {
      toast({ title: "Failed to update flag", description: error.message, variant: "destructive" });
    } else {
      setFlags({ ...flags, [flagKey]: nextVal });
      toast({ title: `Trainer ${nextVal ? "enabled" : "disabled"} for this channel` });
    }
  };

  const activeMeta = CHANNELS.find((c) => c.id === channel)!;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Sparkles size={22} className="text-primary" /> Auto-Reply Trainer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Teach and correct the AI for every channel. Corrections are added as override rules — they beat generic inference.
        </p>
      </div>

      <Tabs value={channel} onValueChange={(v) => setChannel(v as TrainerChannel)} className="w-full">
        <TabsList className="grid grid-cols-4 w-full md:w-auto">
          {CHANNELS.map((c) => {
            const Icon = c.icon;
            const enabled = flags[c.flagKey];
            return (
              <TabsTrigger key={c.id} value={c.id} className="flex items-center gap-2">
                <Icon size={14} />
                <span className="hidden md:inline">{c.label}</span>
                <span className="md:hidden capitalize">{c.id}</span>
                <span
                  className={cn(
                    "ml-1 w-1.5 h-1.5 rounded-full",
                    enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
                  )}
                  title={enabled ? "Trainer active" : "Trainer disabled"}
                />
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="legacy" className="flex items-center gap-2">
            <FileText size={14} />
            <span className="hidden md:inline">Legacy Scripts</span>
            <span className="md:hidden">Legacy</span>
          </TabsTrigger>
        </TabsList>

        {/* One TabsContent per channel — same layout, different channel */}
        {CHANNELS.map((c) => (
          <TabsContent key={c.id} value={c.id} className="space-y-6 mt-6">
            {/* Channel header with flag toggle */}
            <div className="vanto-card p-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <c.icon size={14} className="text-primary" /> {c.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {flags[c.flagKey]
                    ? "Trainer rules are being injected into AI replies for this channel."
                    : "Trainer is OFF — AI uses Knowledge Vault only on this channel."}
                </p>
              </div>
              <button
                onClick={() => toggleFlag(c.flagKey)}
                disabled={flagLoading}
                className={cn(
                  "px-4 h-9 rounded-md text-sm font-semibold transition-colors",
                  flags[c.flagKey]
                    ? "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                )}
              >
                {flagLoading ? <Loader2 size={14} className="animate-spin" /> : flags[c.flagKey] ? "Trainer ON" : "Trainer OFF"}
              </button>
            </div>

            {/* Sub-grid: feed | sandbox */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <InboundFeedPane channel={c.id} onCorrected={() => { /* noop */ }} />
              <SandboxPane channel={c.id} />
            </div>

            <TrainerRulesPane channel={c.id} />

            <CorrectionsPane channel={c.id} />
          </TabsContent>
        ))}

        <TabsContent value="legacy" className="mt-6">
          <div className="vanto-card p-3 mb-4 text-xs text-muted-foreground">
            <strong className="text-foreground">Legacy Playbooks</strong> — kept for reference. New trainer corrections live in the channel tabs above. This section will be removed in a future release.
          </div>
          <PlaybooksModule />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AutoReplyTrainerModule;
