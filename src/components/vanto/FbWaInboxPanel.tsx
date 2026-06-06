import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  Facebook, ExternalLink, RefreshCw, Loader2, Send,
  ChevronDown, ChevronRight, AlertTriangle, Power, Save, Image as ImageIcon,
} from 'lucide-react';

type FbPost = {
  id: string;
  fb_post_id: string;
  source_type: string;
  source_ref: string | null;
  raw_message: string | null;
  permalink_url: string | null;
  posted_at: string | null;
  fetched_at: string;
  attachments: any;
};

type Variant = {
  id: string;
  fb_source_post_id: string;
  variant: 'group' | 'status' | 'cta' | 'emotional';
  body: string;
  status: 'draft' | 'approved' | 'rejected' | 'sent';
  ai_safety_flags: any;
  created_at: string;
};

type DispatchLog = {
  id: string;
  fb_generated_post_id: string;
  target_group_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

const VARIANT_COLORS: Record<Variant['variant'], string> = {
  group: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  status: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  cta: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  emotional: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
};
const STATUS_COLORS: Record<Variant['status'], string> = {
  draft: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  approved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  sent: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

export function FbWaInboxPanel() {
  const [posts, setPosts] = useState<FbPost[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<Array<{ id: string; group_name: string; group_jid: string | null }>>([]);
  const [instantEnabled, setInstantEnabled] = useState(true);
  const [defaultGroups, setDefaultGroups] = useState<Set<string>>(new Set());
  const [savingGroups, setSavingGroups] = useState(false);

  const load = async () => {
    setLoading(true);
    const [p, v, l, g, stop, defs] = await Promise.all([
      supabase.from('fb_source_posts')
        .select('id,fb_post_id,source_type,source_ref,raw_message,permalink_url,posted_at,fetched_at,attachments')
        .order('fetched_at', { ascending: false }).limit(50),
      supabase.from('fb_generated_posts')
        .select('id,fb_source_post_id,variant,body,status,ai_safety_flags,created_at')
        .order('created_at', { ascending: false }).limit(400),
      supabase.from('fb_dispatch_log')
        .select('id,fb_generated_post_id,target_group_id,status,error,created_at')
        .order('created_at', { ascending: false }).limit(30),
      supabase.from('whatsapp_groups').select('id,group_name,group_jid').order('group_name'),
      supabase.from('integration_settings').select('value').eq('key', 'fb_instant_enabled').maybeSingle(),
      supabase.from('integration_settings').select('value').eq('key', 'fb_auto_target_groups').maybeSingle(),
    ]);
    if (!p.error) setPosts((p.data as FbPost[]) ?? []);
    if (!v.error) setVariants((v.data as Variant[]) ?? []);
    if (!l.error) setLogs((l.data as DispatchLog[]) ?? []);
    if (!g.error) setGroups((g.data as any) ?? []);
    setInstantEnabled(stop.data ? (stop.data.value === 'true' || stop.data.value === '1') : true);
    if (defs.data?.value) {
      try {
        const arr = JSON.parse(defs.data.value);
        if (Array.isArray(arr)) setDefaultGroups(new Set(arr.map(String)));
      } catch { /* ignore */ }
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const variantsByPost = useMemo(() => {
    const m = new Map<string, Variant[]>();
    for (const v of variants) {
      const arr = m.get(v.fb_source_post_id) ?? [];
      arr.push(v);
      m.set(v.fb_source_post_id, arr);
    }
    return m;
  }, [variants]);

  const submit = async () => {
    const v = input.trim();
    if (!v) return;
    setSubmitting(true);
    const isUrl = /^https?:\/\//i.test(v);
    const body = isUrl ? { post_url: v } : { text: v };
    const { data, error } = await supabase.functions.invoke('fb-ingest', { body });
    setSubmitting(false);
    if (error) { toast({ title: 'Ingest failed', description: error.message, variant: 'destructive' }); return; }
    if ((data as any)?.ok === false) {
      toast({ title: 'Ingest error', description: (data as any).error ?? 'unknown', variant: 'destructive' }); return;
    }
    toast({ title: 'Post stored', description: 'AI variants will be prepared. WhatsApp dispatch must be scheduled manually.' });
    setInput('');
    setTimeout(load, 1500);
    setTimeout(load, 15000);
  };

  const runPoll = async () => {
    setPolling(true);
    const { data, error } = await supabase.functions.invoke('fb-poll-fallback', { body: {} });
    setPolling(false);
    if (error) { toast({ title: 'Poll failed', description: error.message, variant: 'destructive' }); return; }
    const d = data as any;
    if (d?.ok === false) { toast({ title: 'Poll error', description: d.error ?? 'unknown', variant: 'destructive' }); return; }
    toast({ title: 'Poll complete', description: `Fetched ${d?.fetched ?? 0}, upserted ${d?.upserted ?? 0}.` });
    load();
  };

  const regenerate = async (postId: string) => {
    const { error } = await supabase.functions.invoke('fb-summarize', { body: { fb_source_post_id: postId } });
    if (error) toast({ title: 'Regen failed', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Regenerating', description: 'Variants will refresh shortly.' }); setTimeout(load, 4000); }
  };

  const toggleExpand = (id: string) => {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleInstantEnabled = async (next: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('integration_settings')
      .upsert({ key: 'fb_instant_enabled', value: next ? 'true' : 'false', updated_by: u.user?.id ?? null }, { onConflict: 'key' });
    if (error) toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    else {
      setInstantEnabled(next);
      toast({ title: next ? 'Facebook dispatch unlocked' : 'EMERGENCY STOP active', description: next ? 'Manual scheduled dispatch can be used; instant blasting remains blocked.' : 'No new Facebook injections will be queued.' });
    }
  };

  const saveDefaultGroups = async () => {
    setSavingGroups(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('integration_settings')
      .upsert({ key: 'fb_auto_target_groups', value: JSON.stringify(Array.from(defaultGroups)), updated_by: u.user?.id ?? null }, { onConflict: 'key' });
    setSavingGroups(false);
    if (error) toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    else toast({ title: 'Default target groups saved', description: `${defaultGroups.size} group${defaultGroups.size === 1 ? '' : 's'} will receive future FB posts.` });
  };

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString() : '—';

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Auto-send banner */}
      <div className={`max-w-5xl flex items-start gap-3 p-4 rounded-lg border ${instantEnabled ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
        {instantEnabled
          ? <Power size={18} className="text-emerald-400 mt-0.5" />
          : <AlertTriangle size={18} className="text-red-400 mt-0.5" />}
        <div className="flex-1">
          <p className={`text-sm font-semibold ${instantEnabled ? 'text-emerald-300' : 'text-red-300'}`}>
            {instantEnabled ? 'Facebook dispatch is unlocked' : 'Emergency stop is ACTIVE'}
          </p>
          <p className={`text-xs ${instantEnabled ? 'text-emerald-300/80' : 'text-red-300/80'}`}>
            {instantEnabled
              ? 'New Facebook posts are summarized for review. WhatsApp sending requires an explicit future schedule.'
              : 'No FB → WA injections will be queued. The morning/noon/evening scheduler is unaffected.'}
          </p>
        </div>
        <button
          onClick={() => toggleInstantEnabled(!instantEnabled)}
          className={`text-xs px-3 py-1.5 rounded border ${instantEnabled ? 'bg-red-500/20 text-red-200 border-red-500/40 hover:bg-red-500/30' : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40 hover:bg-emerald-500/30'}`}
        >
          {instantEnabled ? 'Emergency Stop' : 'Resume'}
        </button>
      </div>

      {/* Default target groups */}
      <div className="vanto-card p-5 max-w-3xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-foreground">Default target groups</h3>
            <p className="text-xs text-muted-foreground">Approved groups for manually scheduled Facebook-to-WhatsApp posts.</p>
          </div>
          <button
            onClick={saveDefaultGroups} disabled={savingGroups}
            className="flex items-center gap-2 px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            {savingGroups ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save selection
          </button>
        </div>
        <div className="flex gap-2 mb-2">
          <button onClick={() => setDefaultGroups(new Set(groups.map(g => g.group_name)))} className="text-[11px] text-primary hover:underline">Select all</button>
          <button onClick={() => setDefaultGroups(new Set())} className="text-[11px] text-muted-foreground hover:underline">Clear</button>
          <span className="text-[11px] text-muted-foreground ml-auto">{defaultGroups.size} / {groups.length} selected</span>
        </div>
        <div className="max-h-56 overflow-y-auto border border-border rounded-lg p-2 space-y-1 bg-secondary/30">
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground italic p-2">No WhatsApp groups captured yet.</p>
          ) : groups.map(g => (
            <label key={g.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-secondary cursor-pointer">
              <input
                type="checkbox" checked={defaultGroups.has(g.group_name)}
                onChange={e => setDefaultGroups(s => {
                  const n = new Set(s);
                  e.target.checked ? n.add(g.group_name) : n.delete(g.group_name);
                  return n;
                })}
                className="accent-primary"
              />
              <span className="text-xs text-foreground flex-1 truncate">{g.group_name}</span>
              {g.group_jid && <span className="text-[10px] text-emerald-400">JID ✓</span>}
            </label>
          ))}
        </div>
      </div>

      {/* Manual ingest */}
      <div className="vanto-card p-5 max-w-3xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Facebook size={20} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-foreground">Manual ingest</h3>
            <p className="text-xs text-muted-foreground">Paste a Facebook URL or text — used for backfill. Live webhook handles new posts automatically.</p>
          </div>
          <button
            onClick={runPoll} disabled={polling}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {polling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Run poll now
          </button>
        </div>
        <textarea
          value={input} onChange={e => setInput(e.target.value)}
          placeholder="https://facebook.com/.../posts/123 — or paste raw post text"
          className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary min-h-[80px]"
        />
        <div className="flex justify-end mt-3">
          <button
            onClick={submit} disabled={submitting || !input.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Ingest & Prepare
          </button>
        </div>
      </div>

      {/* Ingested posts + variants (read-only) */}
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-foreground">Ingested posts & AI variants (read-only)</h4>
          <span className="text-xs text-muted-foreground">{posts.length} most recent</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-24 gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading...
          </div>
        ) : posts.length === 0 ? (
          <div className="vanto-card p-6 text-center text-sm text-muted-foreground">
            No posts yet. Webhook will populate this automatically. You can also paste a URL above.
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map(p => {
              const pv = variantsByPost.get(p.id) ?? [];
              const isOpen = expanded.has(p.id);
              const imageUrl = (p.attachments && typeof p.attachments === 'object' && !Array.isArray(p.attachments)) ? p.attachments.image_url : null;
              return (
                <div key={p.id} className="vanto-card overflow-hidden">
                  <div className="p-4 flex items-start gap-3">
                    <button onClick={() => toggleExpand(p.id)} className="mt-0.5 text-muted-foreground hover:text-foreground">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    {imageUrl && (
                      <img src={imageUrl} alt="" className="w-14 h-14 rounded object-cover border border-border" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary border border-primary/30 uppercase">{p.source_type}</span>
                        <span className="text-[11px] text-muted-foreground">{fmt(p.posted_at ?? p.fetched_at)}</span>
                        <span className="text-[11px] text-muted-foreground">· {pv.length} variant{pv.length === 1 ? '' : 's'}</span>
                        {imageUrl && <span className="text-[10px] text-emerald-400 inline-flex items-center gap-1"><ImageIcon size={10} /> image</span>}
                        {p.permalink_url && (
                          <a href={p.permalink_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-[11px]">
                            <ExternalLink size={11} /> open
                          </a>
                        )}
                      </div>
                      <p className={isOpen ? 'text-sm text-foreground whitespace-pre-wrap' : 'text-sm text-foreground line-clamp-2'}>
                        {p.raw_message || <span className="text-muted-foreground italic">(no text)</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => regenerate(p.id)}
                      className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                    >
                      Regenerate
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-border bg-secondary/20 p-4 space-y-3">
                      {pv.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic">No variants yet — generation may still be running.</div>
                      ) : pv.sort((a, b) => a.variant.localeCompare(b.variant)).map(v => (
                        <div key={v.id} className="vanto-card p-3 bg-background">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${VARIANT_COLORS[v.variant]}`}>{v.variant}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${STATUS_COLORS[v.status]}`}>{v.status}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{v.body.length} chars</span>
                          </div>
                          <pre className="text-xs text-foreground whitespace-pre-wrap font-sans">{v.body || <span className="text-muted-foreground italic">(empty)</span>}</pre>
                          {v.ai_safety_flags && (
                            <div className="mt-2 text-[10px] text-red-400">⚠ {JSON.stringify(v.ai_safety_flags)}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Audit log */}
      <div className="max-w-5xl">
        <h4 className="text-sm font-semibold text-foreground mb-2">Dispatch log (last 30)</h4>
        {logs.length === 0 ? (
          <div className="vanto-card p-4 text-xs text-muted-foreground italic">
            No dispatch events yet.
          </div>
        ) : (
          <div className="vanto-card overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Variant</th>
                  <th className="px-3 py-2">Group</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{fmt(l.created_at)}</td>
                    <td className="px-3 py-2 text-foreground">{l.fb_generated_post_id.slice(0, 8)}…</td>
                    <td className="px-3 py-2 text-foreground">{l.target_group_id ?? '—'}</td>
                    <td className="px-3 py-2 text-foreground">{l.status}</td>
                    <td className="px-3 py-2 text-red-400">{l.error ?? '—'}</td>
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
