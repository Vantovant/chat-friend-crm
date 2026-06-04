import { useEffect, useState } from "react";
import { Loader2, MessageCircle, RefreshCw, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { TrainerChannel } from "../AutoReplyTrainerModule";
import CorrectReplyModal, { CorrectionTarget } from "./CorrectReplyModal";

type InboundRow = {
  id: string;
  content: string;
  created_at: string;
  conversation_id: string;
  provider: string | null;
  contact?: { id: string; name: string | null; phone_normalized: string | null } | null;
  aiReply?: { id: string; content: string; created_at: string } | null;
};

type FbRow = {
  id: string;
  body: string;
  status: string;
  created_at: string;
  variant: string;
  fb_source_post_id: string;
  source?: { raw_message: string | null; permalink_url: string | null } | null;
};

export default function InboundFeedPane({ channel, onCorrected }: { channel: TrainerChannel; onCorrected?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [waRows, setWaRows] = useState<InboundRow[]>([]);
  const [fbRows, setFbRows] = useState<FbRow[]>([]);
  const [target, setTarget] = useState<CorrectionTarget | null>(null);

  const loadWhatsApp = async () => {
    setLoading(true);
    const provider = channel === "twilio" ? "twilio" : "maytapi";

    // 1. Recent inbound messages for this provider
    const { data: msgs, error } = await supabase
      .from("messages")
      .select("id, content, created_at, conversation_id, provider, conversations!inner(contact_id, contacts(id, name, phone_normalized))")
      .eq("is_outbound", false)
      .eq("provider", provider)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      toast({ title: "Failed to load feed", description: error.message, variant: "destructive" });
      setWaRows([]);
      setLoading(false);
      return;
    }

    const rows: InboundRow[] = (msgs || []).map((m: any) => ({
      id: m.id,
      content: m.content,
      created_at: m.created_at,
      conversation_id: m.conversation_id,
      provider: m.provider,
      contact: m.conversations?.contacts || null,
    }));

    // 2. For each inbound, look up the AI's outbound reply in the same conversation, after the inbound.
    const convIds = Array.from(new Set(rows.map((r) => r.conversation_id)));
    if (convIds.length > 0) {
      const { data: replies } = await supabase
        .from("messages")
        .select("id, content, created_at, conversation_id")
        .eq("is_outbound", true)
        .eq("provider", provider)
        .in("conversation_id", convIds)
        .order("created_at", { ascending: true });

      for (const r of rows) {
        const reply = (replies || []).find(
          (m: any) => m.conversation_id === r.conversation_id && new Date(m.created_at) > new Date(r.created_at)
        );
        if (reply) r.aiReply = { id: reply.id, content: reply.content, created_at: reply.created_at };
      }
    }

    // Only keep rows where the AI actually replied — those are the ones worth correcting.
    setWaRows(rows.filter((r) => r.aiReply));
    setLoading(false);
  };

  const loadFacebook = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("fb_generated_posts")
      .select("id, body, status, created_at, variant, fb_source_post_id, fb_source_posts(raw_message, permalink_url)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast({ title: "Failed to load FB feed", description: error.message, variant: "destructive" });
    setFbRows((data || []).map((r: any) => ({ ...r, source: r.fb_source_posts || null })) as any);
    setLoading(false);
  };

  useEffect(() => {
    if (channel === "facebook") loadFacebook();
    else loadWhatsApp();
  }, [channel]);

  const refresh = () => (channel === "facebook" ? loadFacebook() : loadWhatsApp());

  const openWaCorrect = (r: InboundRow) => {
    setTarget({
      channel,
      originalMessage: r.content,
      originalReply: r.aiReply?.content || "",
      messageId: r.aiReply?.id || r.id,
      contactId: r.contact?.id || null,
      contactLabel: r.contact?.name || r.contact?.phone_normalized || "Unknown contact",
    });
  };

  const openFbCorrect = (r: FbRow) => {
    setTarget({
      channel: "facebook",
      originalMessage: r.source?.raw_message || "(no source message)",
      originalReply: r.body,
      messageId: null,
      contactId: null,
      contactLabel: `${r.variant} variant`,
    });
  };

  return (
    <div className="vanto-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <MessageCircle size={14} className="text-primary" /> Live Inbound Feed
          </h3>
          <p className="text-xs text-muted-foreground">
            {channel === "facebook" ? "Recent generated FB posts." : "Recent inbound messages where the AI auto-replied."}
          </p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="p-2 rounded hover:bg-secondary/60" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin text-muted-foreground" : "text-foreground"} />
        </button>
      </div>

      <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : channel === "facebook" ? (
          fbRows.length === 0 ? (
            <Empty text="No FB generated posts yet." />
          ) : (
            fbRows.map((r) => (
              <div key={r.id} className="border border-border/50 rounded-md p-3 bg-secondary/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {r.variant} · {r.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                {r.source?.raw_message && (
                  <p className="text-[11px] text-muted-foreground italic mb-1 line-clamp-2">
                    Source: {r.source.raw_message.slice(0, 140)}…
                  </p>
                )}
                <p className="text-sm text-foreground mb-2 line-clamp-3">{r.body}</p>
                <button onClick={() => openFbCorrect(r)}
                  className="text-xs px-2 h-7 rounded vanto-gradient text-primary-foreground font-medium inline-flex items-center gap-1">
                  <Wand2 size={12} /> Correct this reply
                </button>
              </div>
            ))
          )
        ) : waRows.length === 0 ? (
          <Empty text={`No ${channel === "twilio" ? "Twilio" : "Maytapi"} inbound + AI-reply pairs yet.`} />
        ) : (
          waRows.map((r) => (
            <div key={r.id} className="border border-border/50 rounded-md p-3 bg-secondary/20">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-foreground">
                  {r.contact?.name || r.contact?.phone_normalized || "Unknown"}
                </span>
                <span className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <p className="text-sm text-foreground mb-2">
                <span className="text-muted-foreground">User: </span>{r.content}
              </p>
              {r.aiReply && (
                <p className="text-sm text-primary/90 bg-primary/5 border border-primary/20 rounded p-2 mb-2 line-clamp-3">
                  <span className="font-semibold text-primary">AI: </span>{r.aiReply.content}
                </p>
              )}
              <button onClick={() => openWaCorrect(r)}
                className="text-xs px-2 h-7 rounded vanto-gradient text-primary-foreground font-medium inline-flex items-center gap-1">
                <Wand2 size={12} /> Correct this reply
              </button>
            </div>
          ))
        )}
      </div>

      {target && (
        <CorrectReplyModal
          target={target}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            onCorrected?.();
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-md">{text}</div>;
}
