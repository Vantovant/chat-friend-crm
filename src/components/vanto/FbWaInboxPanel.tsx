import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Facebook, ExternalLink, RefreshCw, Loader2, Send } from 'lucide-react';

type FbPost = {
  id: string;
  fb_post_id: string;
  source_type: string;
  raw_message: string | null;
  permalink_url: string | null;
  posted_at: string | null;
  fetched_at: string;
};

export function FbWaInboxPanel() {
  const [posts, setPosts] = useState<FbPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('fb_source_posts')
      .select('id,fb_post_id,source_type,raw_message,permalink_url,posted_at,fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(50);
    if (error) toast({ title: 'Failed to load posts', description: error.message, variant: 'destructive' });
    else setPosts((data as FbPost[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    const v = input.trim();
    if (!v) return;
    setSubmitting(true);
    const isUrl = /^https?:\/\//i.test(v);
    const body = isUrl ? { post_url: v } : { text: v };
    const { data, error } = await supabase.functions.invoke('fb-ingest', { body });
    setSubmitting(false);
    if (error) {
      toast({ title: 'Ingest failed', description: error.message, variant: 'destructive' });
      return;
    }
    if ((data as any)?.ok === false) {
      toast({ title: 'Ingest error', description: (data as any).error ?? 'unknown', variant: 'destructive' });
      return;
    }
    toast({ title: 'Post stored', description: 'It will appear in the list below.' });
    setInput('');
    load();
  };

  const runPoll = async () => {
    setPolling(true);
    const { data, error } = await supabase.functions.invoke('fb-poll-fallback', { body: {} });
    setPolling(false);
    if (error) {
      toast({ title: 'Poll failed', description: error.message, variant: 'destructive' });
      return;
    }
    const d = data as any;
    if (d?.ok === false) {
      toast({ title: 'Poll error', description: d.error ?? 'unknown', variant: 'destructive' });
      return;
    }
    toast({ title: 'Poll complete', description: `Fetched ${d?.fetched ?? 0}, upserted ${d?.upserted ?? 0}.` });
    load();
  };

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString() : '—';

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="vanto-card p-5 max-w-3xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Facebook size={20} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-foreground">FB → WA Inbox</h3>
            <p className="text-xs text-muted-foreground">Phase 2: ingest only. AI summaries and queueing come in Phase 3.</p>
          </div>
          <button
            onClick={runPoll}
            disabled={polling}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {polling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Run poll now
          </button>
        </div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Facebook post URL or text</label>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="https://facebook.com/.../posts/123  — or paste raw post text"
          className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary min-h-[80px]"
        />
        <div className="flex justify-end mt-3">
          <button
            onClick={submit}
            disabled={submitting || !input.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Fetch & Store
          </button>
        </div>
      </div>

      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-foreground">Ingested posts</h4>
          <span className="text-xs text-muted-foreground">{posts.length} most recent</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-24 gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading...
          </div>
        ) : posts.length === 0 ? (
          <div className="vanto-card p-6 text-center text-sm text-muted-foreground">
            No posts yet. Paste a URL above or run the poll.
          </div>
        ) : (
          <div className="vanto-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Preview</th>
                  <th className="px-4 py-2 font-medium w-24">Type</th>
                  <th className="px-4 py-2 font-medium w-44">Posted</th>
                  <th className="px-4 py-2 font-medium w-16">Link</th>
                </tr>
              </thead>
              <tbody>
                {posts.map(p => (
                  <tr key={p.id} className="border-t border-border hover:bg-secondary/30">
                    <td className="px-4 py-3 text-foreground">
                      <p className="line-clamp-2 max-w-xl">{p.raw_message || <span className="text-muted-foreground italic">(no text)</span>}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary border border-primary/30 uppercase">{p.source_type}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(p.posted_at ?? p.fetched_at)}</td>
                    <td className="px-4 py-3">
                      {p.permalink_url ? (
                        <a href={p.permalink_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                          <ExternalLink size={14} />
                        </a>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
