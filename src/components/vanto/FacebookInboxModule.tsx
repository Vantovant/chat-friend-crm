import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Facebook, MessageCircle, Send, RefreshCw, Loader2, CheckCircle2, Clock, MessagesSquare } from 'lucide-react';

type FbComment = {
  id: string;
  fb_comment_id: string;
  fb_post_id: string | null;
  parent_comment_id: string | null;
  commenter_name: string | null;
  commenter_psid: string | null;
  comment_text: string | null;
  verb: string;
  replied: boolean;
  reply_text: string | null;
  replied_at: string | null;
  created_time: string | null;
};

type ConvRow = {
  id: string;
  contact_id: string;
  last_message: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number | null;
  contacts: { name: string | null; messenger_psid: string | null } | null;
};

// Unified feed item — a comment or a Messenger conversation, normalized to one shape
// so both render in the same list, sorted by time, matching the panel's own promise:
// "Comments left on your Page posts/ads. Messenger DMs land here too."
type FeedItem =
  | { kind: 'comment'; key: string; name: string; text: string; time: string | null; awaitingReply: boolean; comment: FbComment }
  | { kind: 'messenger'; key: string; name: string; text: string; time: string | null; awaitingReply: boolean; conv: ConvRow };

export function FacebookInboxModule() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'unreplied'>('unreplied');
  const currentUser = useCurrentUser();

  const load = async () => {
    setLoading(true);

    // Multi-tenant scoping: non-admins only see the Pages they personally connected.
    // Admins keep seeing everything, including the legacy env-configured Page.
    const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
    let myPageIds: string[] | null = null;
    if (currentUser && !isAdmin) {
      const { data: conns } = await supabase
        .from('facebook_page_connections')
        .select('page_id')
        .eq('status', 'active');
      myPageIds = [...new Set((conns ?? []).map(c => c.page_id as string))];
    }
    if (myPageIds && myPageIds.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    // ── Comments ──
    let commentQuery = supabase
      .from('fb_comments')
      .select('id,fb_comment_id,fb_post_id,parent_comment_id,commenter_name,commenter_psid,comment_text,verb,replied,reply_text,replied_at,created_time')
      .neq('verb', 'remove')
      .order('created_time', { ascending: false })
      .limit(100);
    if (filter === 'unreplied') commentQuery = commentQuery.eq('replied', false);
    if (myPageIds) commentQuery = commentQuery.in('page_id', myPageIds);
    const { data: commentRows } = await commentQuery;

    const commentItems: FeedItem[] = ((commentRows as FbComment[]) ?? []).map(c => ({
      kind: 'comment',
      key: `comment:${c.id}`,
      name: c.commenter_name || 'Unknown commenter',
      text: c.comment_text || '',
      time: c.created_time,
      awaitingReply: !c.replied,
      comment: c,
    }));

    // ── Messenger conversations ──
    const { data: msgProviderRows } = await supabase
      .from('messages').select('conversation_id').eq('provider', 'facebook_messenger').limit(500);
    const convIds = [...new Set((msgProviderRows ?? []).map(r => r.conversation_id as string))];

    let messengerItems: FeedItem[] = [];
    if (convIds.length > 0) {
      let convQuery = supabase
        .from('conversations')
        .select('id, contact_id, last_message, last_message_at, last_inbound_at, last_outbound_at, unread_count, contacts(name, messenger_psid)')
        .in('id', convIds)
        .order('last_message_at', { ascending: false })
        .limit(100);
      if (myPageIds) convQuery = convQuery.in('page_id', myPageIds);
      const { data: convRows } = await convQuery;

      messengerItems = ((convRows as unknown as ConvRow[]) ?? [])
        .map(cv => {
          const awaiting = !!cv.last_inbound_at && (!cv.last_outbound_at || cv.last_outbound_at < cv.last_inbound_at);
          return {
            kind: 'messenger' as const,
            key: `messenger:${cv.id}`,
            name: cv.contacts?.name || 'Messenger user',
            text: cv.last_message || '',
            time: cv.last_message_at,
            awaitingReply: awaiting,
            conv: cv,
          };
        })
        .filter(i => (filter === 'unreplied' ? i.awaitingReply : true));
    }

    const merged = [...commentItems, ...messengerItems].sort((a, b) => {
      const ta = a.time ? new Date(a.time).getTime() : 0;
      const tb = b.time ? new Date(b.time).getTime() : 0;
      return tb - ta;
    });

    setItems(merged);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter, currentUser?.id]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sendCommentReply = async (c: FbComment) => {
    const text = (replyDrafts[c.fb_comment_id] ?? '').trim();
    if (!text) return;
    setSending(s => new Set(s).add(c.fb_comment_id));
    const { data, error } = await supabase.functions.invoke('fb-reply-comment', {
      body: { fb_comment_id: c.fb_comment_id, reply_text: text },
    });
    setSending(s => { const n = new Set(s); n.delete(c.fb_comment_id); return n; });
    if (error) {
      toast({ title: 'Reply failed', description: error.message, variant: 'destructive' });
      return;
    }
    const d = data as any;
    if (!d?.ok) {
      const msg = d?.graph_error?.error?.message ?? d?.error ?? 'Meta rejected the reply';
      toast({ title: 'Meta rejected the reply', description: msg, variant: 'destructive' });
      return;
    }
    toast({ title: 'Reply sent', description: 'Posted publicly under the comment on Facebook.' });
    setReplyDrafts(d0 => { const n = { ...d0 }; delete n[c.fb_comment_id]; return n; });
    load();
  };

  const sendMessengerReply = async (cv: ConvRow) => {
    const draftKey = `conv:${cv.id}`;
    const text = (replyDrafts[draftKey] ?? '').trim();
    if (!text) return;
    setSending(s => new Set(s).add(draftKey));
    const { data, error } = await supabase.functions.invoke('send-message', {
      body: { conversation_id: cv.id, content: text },
    });
    setSending(s => { const n = new Set(s); n.delete(draftKey); return n; });
    if (error) {
      toast({ title: 'Reply failed', description: error.message, variant: 'destructive' });
      return;
    }
    const d = data as any;
    if (!d?.ok) {
      toast({ title: 'Send failed', description: d?.message || 'Messenger send failed', variant: 'destructive' });
      return;
    }
    toast({ title: 'Reply sent', description: 'Delivered via Messenger.' });
    setReplyDrafts(d0 => { const n = { ...d0 }; delete n[draftKey]; return n; });
    load();
  };

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString() : '—';

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between max-w-4xl flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Facebook size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Facebook Inbox</h3>
            <p className="text-xs text-muted-foreground">Comments on your Page posts/ads, and Messenger DMs — one combined feed.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              onClick={() => setFilter('unreplied')}
              className={`px-3 py-1.5 ${filter === 'unreplied' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary'}`}
            >
              Unreplied
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 ${filter === 'all' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary'}`}
            >
              All
            </button>
          </div>
          <button
            onClick={refresh} disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      <div className="max-w-4xl space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-24 gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading...
          </div>
        ) : items.length === 0 ? (
          <div className="vanto-card p-6 text-center text-sm text-muted-foreground">
            {filter === 'unreplied' ? 'Nothing awaiting reply.' : 'Nothing captured yet.'}
          </div>
        ) : (
          items.map(item => {
            const draftKey = item.kind === 'comment' ? item.comment.fb_comment_id : `conv:${item.conv.id}`;
            const isSending = sending.has(draftKey);
            return (
              <div key={item.key} className="vanto-card p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    {item.kind === 'comment'
                      ? <MessageCircle size={14} className="text-muted-foreground" />
                      : <MessagesSquare size={14} className="text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{item.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground uppercase tracking-wide">
                        {item.kind === 'comment' ? 'Comment' : 'Messenger'}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{fmt(item.time)}</span>
                      {item.awaitingReply ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          <Clock size={10} /> awaiting reply
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          <CheckCircle2 size={10} /> replied
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {item.text || <span className="italic text-muted-foreground">(empty)</span>}
                    </p>

                    {!item.awaitingReply && item.kind === 'comment' && item.comment.reply_text ? (
                      <div className="mt-2 pl-3 border-l-2 border-emerald-500/30 text-xs text-muted-foreground">
                        <span className="font-medium text-emerald-400">Your reply</span> · {fmt(item.comment.replied_at)}
                        <p className="text-foreground mt-0.5">{item.comment.reply_text}</p>
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          value={replyDrafts[draftKey] ?? ''}
                          onChange={e => setReplyDrafts(d => ({ ...d, [draftKey]: e.target.value }))}
                          placeholder="Write a reply..."
                          className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          onKeyDown={e => {
                            if (e.key !== 'Enter') return;
                            item.kind === 'comment' ? sendCommentReply(item.comment) : sendMessengerReply(item.conv);
                          }}
                        />
                        <button
                          onClick={() => item.kind === 'comment' ? sendCommentReply(item.comment) : sendMessengerReply(item.conv)}
                          disabled={isSending || !(replyDrafts[draftKey] ?? '').trim()}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
                        >
                          {isSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                          Reply
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
