import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Facebook, MessageCircle, RefreshCw, Loader2, Send, CheckCircle2, Clock } from 'lucide-react';

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

export function FacebookInboxModule() {
  const [comments, setComments] = useState<FbComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'unreplied'>('unreplied');

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from('fb_comments')
      .select('id,fb_comment_id,fb_post_id,parent_comment_id,commenter_name,commenter_psid,comment_text,verb,replied,reply_text,replied_at,created_time')
      .neq('verb', 'remove')
      .order('created_time', { ascending: false })
      .limit(100);
    if (filter === 'unreplied') query = query.eq('replied', false);
    const { data, error } = await query;
    if (!error) setComments((data as FbComment[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sendReply = async (c: FbComment) => {
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

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString() : '—';

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between max-w-4xl flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Facebook size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Facebook Comments</h3>
            <p className="text-xs text-muted-foreground">Comments left on your Page posts/ads. Messenger DMs land here once permission is granted.</p>
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
        ) : comments.length === 0 ? (
          <div className="vanto-card p-6 text-center text-sm text-muted-foreground">
            {filter === 'unreplied' ? 'No unreplied comments.' : 'No comments captured yet.'}
          </div>
        ) : (
          comments.map(c => (
            <div key={c.id} className="vanto-card p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <MessageCircle size={14} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{c.commenter_name || 'Unknown commenter'}</span>
                    <span className="text-[11px] text-muted-foreground">{fmt(c.created_time)}</span>
                    {c.replied ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 size={10} /> replied
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        <Clock size={10} /> awaiting reply
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{c.comment_text || <span className="italic text-muted-foreground">(empty)</span>}</p>

                  {c.replied ? (
                    <div className="mt-2 pl-3 border-l-2 border-emerald-500/30 text-xs text-muted-foreground">
                      <span className="font-medium text-emerald-400">Your reply</span> · {fmt(c.replied_at)}
                      <p className="text-foreground mt-0.5">{c.reply_text}</p>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        value={replyDrafts[c.fb_comment_id] ?? ''}
                        onChange={e => setReplyDrafts(d => ({ ...d, [c.fb_comment_id]: e.target.value }))}
                        placeholder="Write a reply..."
                        className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        onKeyDown={e => { if (e.key === 'Enter') sendReply(c); }}
                      />
                      <button
                        onClick={() => sendReply(c)}
                        disabled={sending.has(c.fb_comment_id) || !(replyDrafts[c.fb_comment_id] ?? '').trim()}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
                      >
                        {sending.has(c.fb_comment_id) ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        Reply
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
