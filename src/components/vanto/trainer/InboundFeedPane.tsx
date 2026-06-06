import { useEffect, useState } from "react";
import { Check, Loader2, Lock, MessageCircle, RefreshCw, Users, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-current-user";
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

type GroupInboundRow = {
  id: string;
  body: string;
  created_at: string;
  conversation_key: string; // group JID
  phone_e164: string | null; // author
  group_name: string;
  aiReply?: { id: string; body: string; created_at: string } | null;
};

export default function InboundFeedPane({ channel, onCorrected }: { channel: TrainerChannel; onCorrected?: () => void }) {
  const currentUser = useCurrentUser();
  const canCorrect = currentUser?.role === "admin" || currentUser?.role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [waRows, setWaRows] = useState<InboundRow[]>([]);
  const [groupRows, setGroupRows] = useState<GroupInboundRow[]>([]);
  const [target, setTarget] = useState<CorrectionTarget | null>(null);

  const loadWhatsApp = async () => {
    setLoading(true);
    const provider = channel === "twilio" ? "twilio" : "maytapi";

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

    // Filter out replies already marked "Reply is correct"
    const paired = rows.filter((r) => r.aiReply);
    const replyIds = paired.map((r) => r.aiReply!.id);
    let approvedSet = new Set<string>();
    if (replyIds.length > 0) {
      const { data: approved } = await supabase
        .from("auto_reply_approved_replies" as any)
        .select("message_id")
        .eq("channel", channel)
        .in("message_id", replyIds);
      approvedSet = new Set((approved || []).map((a: any) => a.message_id));
    }

    setWaRows(paired.filter((r) => !approvedSet.has(r.aiReply!.id)));
    setLoading(false);
  };

  const loadGroups = async () => {
    setLoading(true);

    // 1. Only groups we ACTIVELY post scheduled content to (last 7 days).
    //    These are the morning/noon/evening campaign groups — typically ~11.
    //    All other groups are excluded from the trainer feed AND from auto-reply
    //    (the whatsapp-auto-reply edge function only fires on 1-on-1 DMs, never groups).
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: scheduled, error: sErr } = await supabase
      .from("scheduled_group_posts")
      .select("target_group_jid")
      .gte("scheduled_at", sevenDaysAgo)
      .not("target_group_jid", "is", null);

    if (sErr) {
      toast({ title: "Failed to load scheduled groups", description: sErr.message, variant: "destructive" });
      setGroupRows([]);
      setLoading(false);
      return;
    }

    const activeJids = Array.from(new Set((scheduled || []).map((s: any) => s.target_group_jid).filter(Boolean)));

    if (activeJids.length === 0) {
      setGroupRows([]);
      setLoading(false);
      return;
    }

    // 2. Resolve group names for those JIDs
    const { data: groups, error: gErr } = await supabase
      .from("whatsapp_groups")
      .select("group_jid, group_name")
      .in("group_jid", activeJids);

    if (gErr) {
      toast({ title: "Failed to load groups", description: gErr.message, variant: "destructive" });
      setGroupRows([]);
      setLoading(false);
      return;
    }

    const jidToName = new Map<string, string>();
    (groups || []).forEach((g: any) => { if (g.group_jid) jidToName.set(g.group_jid, g.group_name); });
    activeJids.forEach((j) => { if (!jidToName.has(j)) jidToName.set(j, j); });
    const jids = activeJids;


    // 2. Recent inbound messages from those groups
    const { data: inbound, error: inErr } = await supabase
      .from("maytapi_messages")
      .select("id, body, created_at, conversation_key, phone_e164, direction")
      .eq("direction", "inbound")
      .in("conversation_key", jids)
      .order("created_at", { ascending: false })
      .limit(50);

    if (inErr) {
      toast({ title: "Failed to load group feed", description: inErr.message, variant: "destructive" });
      setGroupRows([]);
      setLoading(false);
      return;
    }

    const rows: GroupInboundRow[] = (inbound || []).map((m: any) => ({
      id: m.id,
      body: m.body || "",
      created_at: m.created_at,
      conversation_key: m.conversation_key,
      phone_e164: m.phone_e164,
      group_name: jidToName.get(m.conversation_key) || m.conversation_key,
    }));

    // 3. Pair with subsequent outbound reply in the same group (if any)
    if (rows.length > 0) {
      const { data: outbound } = await supabase
        .from("maytapi_messages")
        .select("id, body, created_at, conversation_key")
        .eq("direction", "outbound")
        .in("conversation_key", jids)
        .order("created_at", { ascending: true });

      for (const r of rows) {
        const reply = (outbound || []).find(
          (m: any) => m.conversation_key === r.conversation_key && new Date(m.created_at) > new Date(r.created_at)
        );
        if (reply) r.aiReply = { id: reply.id, body: reply.body || "", created_at: reply.created_at };
      }
    }

    // Filter out replies already marked "Reply is correct"
    const replyIds = rows.filter((r) => r.aiReply).map((r) => r.aiReply!.id);
    let approvedSet = new Set<string>();
    if (replyIds.length > 0) {
      const { data: approved } = await supabase
        .from("auto_reply_approved_replies" as any)
        .select("message_id")
        .eq("channel", "groups")
        .in("message_id", replyIds);
      approvedSet = new Set((approved || []).map((a: any) => a.message_id));
    }

    setGroupRows(rows.filter((r) => !r.aiReply || !approvedSet.has(r.aiReply.id)));
    setLoading(false);
  };

  useEffect(() => {
    if (channel === "groups") loadGroups();
    else loadWhatsApp();
  }, [channel]);

  const refresh = () => (channel === "groups" ? loadGroups() : loadWhatsApp());

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

  const openGroupCorrect = (r: GroupInboundRow) => {
    setTarget({
      channel: "groups",
      originalMessage: r.body,
      originalReply: r.aiReply?.body || "",
      messageId: r.aiReply?.id || r.id,
      contactId: null,
      contactLabel: `${r.group_name} · ${r.phone_e164 || "unknown sender"}`,
    });
  };

  const approveReply = async (ch: TrainerChannel, replyId: string | undefined) => {
    if (!replyId) return;
    const { error } = await supabase
      .from("auto_reply_approved_replies" as any)
      .insert({ channel: ch, message_id: replyId });
    if (error && !/duplicate key/i.test(error.message)) {
      toast({ title: "Failed to mark as correct", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Marked as correct", description: "This reply will no longer appear in the feed." });
    refresh();
  };

  return (
    <div className="vanto-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            {channel === "groups" ? <Users size={14} className="text-primary" /> : <MessageCircle size={14} className="text-primary" />}
            Live Inbound Feed
          </h3>
          <p className="text-xs text-muted-foreground">
            {channel === "groups"
              ? "Recent inbound messages from the scheduled-campaign groups only (morning/noon/evening). All other groups are excluded — they never receive auto-replies."
              : "Recent inbound messages where the AI auto-replied."}
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
        ) : channel === "groups" ? (
          groupRows.length === 0 ? (
            <Empty text="No inbound group messages yet (or no active groups with a Maytapi JID)." />
          ) : (
            groupRows.map((r) => (
              <div key={r.id} className="border border-border/50 rounded-md p-3 bg-secondary/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <Users size={11} className="text-primary" /> {r.group_name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mb-1">From: {r.phone_e164 || "unknown"}</p>
                <p className="text-sm text-foreground mb-2">{r.body || <span className="italic text-muted-foreground">(no text)</span>}</p>
                {r.aiReply ? (
                  <p className="text-sm text-primary/90 bg-primary/5 border border-primary/20 rounded p-2 mb-2 line-clamp-3">
                    <span className="font-semibold text-primary">AI/Group reply: </span>{r.aiReply.body}
                  </p>
                ) : (
                  <p className="text-[11px] italic text-muted-foreground mb-2">No subsequent outbound reply in this group.</p>
                )}
                <button onClick={() => openGroupCorrect(r)}
                  disabled={!canCorrect}
                  title={canCorrect ? "Create an override training rule from this group reply" : "Admin or Super Admin role required to train rules"}
                  className="text-xs px-2 h-7 rounded vanto-gradient text-primary-foreground font-medium inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
                  {canCorrect ? <Wand2 size={12} /> : <Lock size={12} />} Correct this reply
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
                disabled={!canCorrect}
                title={canCorrect ? "Create an override training rule from this reply" : "Admin or Super Admin role required to train rules"}
                className="text-xs px-2 h-7 rounded vanto-gradient text-primary-foreground font-medium inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
                {canCorrect ? <Wand2 size={12} /> : <Lock size={12} />} Correct this reply
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
