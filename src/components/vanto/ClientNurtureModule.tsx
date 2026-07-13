import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Mail, Plus, X, Loader2, Send, Users, RefreshCcw, Search } from 'lucide-react';

type Campaign = {
  id: string; name: string; subject_tpl: string; body_tpl: string;
  active: boolean; cooldown_days: number; audience: string | null; created_at: string;
};

type Send = {
  id: string; campaign_id: string; contact_id: string | null; contact_email: string;
  contact_name: string | null; subject: string; body: string; status: string;
  error: string | null; created_at: string;
};

type Contact = { id: string; name: string; email: string | null; lead_type: string | null };

export function ClientNurtureModule() {
  const [tab, setTab] = useState<'campaigns' | 'sends'>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sends, setSends] = useState<Send[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, sRes] = await Promise.all([
      supabase.from('client_nurture_campaigns' as never).select('*').order('created_at', { ascending: false }),
      supabase.from('client_nurture_sends' as never).select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    if (cRes.data) setCampaigns(cRes.data as unknown as Campaign[]);
    if (sRes.data) setSends(sRes.data as unknown as Send[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap pr-32">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl vanto-gradient flex items-center justify-center shrink-0">
              <Mail size={18} className="text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground truncate">Client Email Nurture</h2>
              <p className="text-xs text-muted-foreground truncate">1-on-1 email prospector · existing clients · per-campaign cooldown + 12h cross-channel quiet window</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={load} className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground"><RefreshCcw size={14} /></button>
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium"><Plus size={14} /> New campaign</button>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-lg p-0.5 w-fit">
          {(['campaigns','sends'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-1.5 rounded-md text-xs font-medium capitalize', tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{t}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        : tab === 'campaigns' ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {campaigns.map(c => (
              <button key={c.id} onClick={() => setSelected(c)} className="vanto-card text-left p-4 hover:border-primary/40 transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn('w-2 h-2 rounded-full', c.active ? 'bg-primary' : 'bg-muted')} />
                  <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                </div>
                <p className="text-xs text-muted-foreground truncate mb-2">{c.subject_tpl}</p>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>Cooldown {c.cooldown_days}d</span>
                  {c.audience && <span className="truncate">· {c.audience}</span>}
                </div>
              </button>
            ))}
            {!campaigns.length && <p className="text-sm text-muted-foreground">No campaigns yet. Create one to start 1-on-1 email nurture.</p>}
          </div>
        ) : (
          <div className="vanto-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Contact</th><th className="text-left px-3 py-2">Subject</th><th className="text-left px-3 py-2">Status</th></tr>
              </thead>
              <tbody>
                {sends.map(s => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground text-xs">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 text-foreground">{s.contact_name || s.contact_email}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[280px]">{s.subject}</td>
                    <td className="px-3 py-2"><span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">{s.status}</span></td>
                  </tr>
                ))}
                {!sends.length && <tr><td colSpan={4} className="p-6 text-center text-sm text-muted-foreground">No sends logged yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <NewCampaign onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load(); }} />}
      {selected && <CampaignDrawer campaign={selected} onClose={() => setSelected(null)} reload={load} />}
    </div>
  );
}

function NewCampaign({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('Hi {FirstName},\n\n...\n\n— Vanto');
  const [cooldown, setCooldown] = useState(45);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || !subject.trim() || !body.trim()) return toast({ title: 'All fields required', variant: 'destructive' });
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('client_nurture_campaigns' as never).insert({
      name: name.trim(), subject_tpl: subject, body_tpl: body, cooldown_days: cooldown, created_by: user?.id ?? null,
    } as never);
    setBusy(false);
    if (error) return toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="vanto-card w-full max-w-lg p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><p className="text-sm font-bold">New nurture campaign</p><button onClick={onClose}><X size={16} /></button></div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Campaign name" className="fld" />
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject — use {FirstName}, {Product}" className="fld" />
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="fld font-mono text-xs" />
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Cooldown (days)</label>
          <input type="number" min={1} max={365} value={cooldown} onChange={e => setCooldown(parseInt(e.target.value) || 30)} className="fld w-24" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground">Cancel</button>
          <button onClick={save} disabled={busy} className="px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />} Create</button>
        </div>
        <style>{`.fld{width:100%;padding:.5rem .75rem;border-radius:.5rem;background:hsl(var(--secondary));border:1px solid hsl(var(--border));color:hsl(var(--foreground));font-size:.8125rem;outline:none}`}</style>
      </div>
    </div>
  );
}

function CampaignDrawer({ campaign, onClose, reload }: { campaign: Campaign; onClose: () => void; reload: () => void }) {
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const query = supabase.from('contacts').select('id,name,email,lead_type').eq('is_deleted', false).not('email', 'is', null).limit(50);
      if (q.trim()) {
        const s = q.trim();
        query.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
      }
      const { data } = await query;
      if (data) setContacts(data as unknown as Contact[]);
      setLoading(false);
    })();
  }, [q]);

  const send = async (c: Contact) => {
    setSending(c.id);
    const { data, error } = await supabase.functions.invoke('client-nurture-send', { body: { campaign_id: campaign.id, contact_id: c.id } });
    setSending(null);
    if (error) return toast({ title: 'Blocked', description: error.message, variant: 'destructive' });
    const r = data as { mailto?: string; error?: string; detail?: string };
    if (r.error) return toast({ title: r.error, description: r.detail || 'Blocked by guardrail', variant: 'destructive' });
    if (r.mailto) window.open(r.mailto, '_blank');
    toast({ title: 'Logged & mailto opened', description: c.name });
    reload();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-2xl h-full bg-background border-l border-border overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-background border-b border-border px-5 py-3 flex items-center justify-between z-10">
          <div><p className="text-sm font-bold text-foreground">{campaign.name}</p><p className="text-[11px] text-muted-foreground">{campaign.subject_tpl}</p></div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="vanto-card p-3 space-y-2">
            <div className="flex items-center gap-2"><Users size={14} className="text-primary" /><p className="text-sm font-semibold text-foreground">Send to a client (1-on-1)</p></div>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or email…" className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary border border-border text-sm" />
            </div>
            <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
              {loading ? <p className="text-xs text-muted-foreground p-2">Loading…</p>
              : contacts.map(c => (
                <div key={c.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{c.name || c.email}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.email} · {c.lead_type || '—'}</p>
                  </div>
                  <button onClick={() => send(c)} disabled={sending === c.id} className="px-3 py-1.5 rounded-lg vanto-gradient text-primary-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-40">
                    {sending === c.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send
                  </button>
                </div>
              ))}
              {!loading && !contacts.length && <p className="text-xs text-muted-foreground p-2">No matching contacts with email.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
