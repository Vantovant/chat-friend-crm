import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  Link2, Plus, X, Loader2, Upload, Search, Mail, ExternalLink,
  FileText as FileIcon, Settings as Cog, Kanban, Table as TableIcon,
  Send, GripVertical, RefreshCcw, Sparkles,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────
type Status = 'queued' | 'contacted' | 'reply' | 'negotiating' | 'published' | 'dead' | 'dnc' | 'blocked' | 'unchecked';

type Target = {
  id: string; name: string; url: string; domain: string | null; status: Status;
  category: string | null; approach: 'A'|'B'|'C'|'D'|null;
  contact_url: string | null; first_line_hook: string | null;
  assigned_to: string | null; domain_rating: number | null;
  last_send_at: string | null; next_action_at: string | null;
  published_url: string | null; notes: string | null;
};

type Template = {
  id: string; code: string; name: string;
  subject_tpl: string; body_tpl: string; active: boolean; version: number;
};

type LogRow = {
  id: string; target_id: string; template_id: string | null;
  event_type: string; direction: string | null;
  subject: string | null; body: string | null;
  metadata: Record<string, unknown>; performed_by: string | null; created_at: string;
};

const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: 'queued',       label: 'Queued',       color: 'hsl(217, 91%, 60%)' },
  { id: 'contacted',    label: 'Contacted',    color: 'hsl(38, 96%, 56%)' },
  { id: 'reply',        label: 'Reply',        color: 'hsl(280, 65%, 60%)' },
  { id: 'negotiating',  label: 'Negotiating',  color: 'hsl(180, 65%, 50%)' },
  { id: 'published',    label: 'Published',    color: 'hsl(140, 65%, 50%)' },
  { id: 'dead',         label: 'Dead',         color: 'hsl(0, 0%, 40%)' },
];

const ALL_STATUS_COLOR: Record<Status, string> = {
  queued: 'hsl(217, 91%, 60%)', contacted: 'hsl(38, 96%, 56%)', reply: 'hsl(280, 65%, 60%)',
  negotiating: 'hsl(180, 65%, 50%)', published: 'hsl(140, 65%, 50%)', dead: 'hsl(0, 0%, 40%)',
  dnc: 'hsl(0, 84%, 60%)', blocked: 'hsl(30, 60%, 50%)', unchecked: 'hsl(0, 0%, 55%)',
};

// ─── Root module ───────────────────────────────────────────────────
export function BacklinkOutreachModule() {
  const [tab, setTab] = useState<'kanban' | 'table' | 'templates' | 'settings'>('kanban');
  const [targets, setTargets] = useState<Target[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Target | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [tRes, tplRes] = await Promise.all([
      supabase.from('backlink_targets' as never).select('*').eq('is_deleted', false).order('created_at', { ascending: false }),
      supabase.from('backlink_templates' as never).select('*').eq('active', true).order('code'),
    ]);
    if (!tRes.error && tRes.data) setTargets(tRes.data as unknown as Target[]);
    if (!tplRes.error && tplRes.data) setTemplates(tplRes.data as unknown as Template[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return targets;
    return targets.filter(t =>
      t.name.toLowerCase().includes(s) || (t.domain || '').includes(s) || (t.category || '').toLowerCase().includes(s)
    );
  }, [targets, q]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap pr-32">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl vanto-gradient flex items-center justify-center shrink-0">
              <Link2 size={18} className="text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground truncate">Backlink Outreach</h2>
              <p className="text-xs text-muted-foreground truncate">Growth · SA backlink pipeline · 5/day/user cap · 14d/domain cooldown</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => load()} className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground" title="Refresh"><RefreshCcw size={14} /></button>
            <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-secondary/60"><Upload size={14} /> Import CSV</button>
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90"><Plus size={14} /> New target</button>
          </div>
        </div>


        {/* Tabs + search */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-lg p-0.5">
            {[
              { id: 'kanban',    label: 'Kanban',    icon: Kanban },
              { id: 'table',     label: 'Table',     icon: TableIcon },
              { id: 'templates', label: 'Templates', icon: FileIcon },
              { id: 'settings',  label: 'Settings',  icon: Cog },
            ].map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  <Icon size={13} /> {t.label}
                </button>
              );
            })}
          </div>
          {(tab === 'kanban' || tab === 'table') && (
            <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search site / domain / category"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <span className="text-xs text-muted-foreground">{filtered.length}/{targets.length}</span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : (
          <>
            {tab === 'kanban'    && <KanbanView   targets={filtered} onOpen={setSelected} onStatusChange={async (id, s) => { await changeStatus(id, s); load(); }} />}
            {tab === 'table'     && <TableView    targets={filtered} onOpen={setSelected} />}
            {tab === 'templates' && <TemplatesView templates={templates} reload={load} />}
            {tab === 'settings'  && <SettingsView />}
          </>
        )}
      </div>

      {selected && (
        <TargetDrawer target={selected} templates={templates} onClose={() => setSelected(null)} reload={load} />
      )}
      {showNew && <NewTargetDialog onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
      {showImport && <ImportCsvDialog onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); load(); }} />}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────
async function changeStatus(id: string, newStatus: Status) {
  const { error } = await supabase.from('backlink_targets' as never).update({ status: newStatus } as never).eq('id', id);
  if (error) { toast({ title: 'Update failed', description: error.message, variant: 'destructive' }); return; }
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('backlink_outreach_log' as never).insert({
    target_id: id, event_type: 'status_change', metadata: { to: newStatus }, performed_by: user?.id ?? null,
  } as never);
}

function renderTemplate(tpl: Template, target: Target): { subject: string; body: string } {
  const site = target.name;
  const hook = target.first_line_hook || `I've been reading ${site} — really enjoyed your recent work.`;
  const first = 'there';
  const map: Record<string, string> = {
    '{SiteName}': site, '{FirstName}': first, '{HOOK}': hook,
    '{URL}': target.url, '{Topic}': target.category || 'wellness / income',
  };
  const sub = (s: string) => Object.entries(map).reduce((acc, [k, v]) => acc.split(k).join(v), s);
  return { subject: sub(tpl.subject_tpl), body: sub(tpl.body_tpl) };
}

// ─── Kanban ────────────────────────────────────────────────────────
function KanbanView({ targets, onOpen, onStatusChange }: {
  targets: Target[]; onOpen: (t: Target) => void; onStatusChange: (id: string, s: Status) => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  return (
    <div className="p-6 flex gap-4 min-w-max h-full">
      {STATUSES.map(col => {
        const items = targets.filter(t => t.status === col.id);
        return (
          <div key={col.id}
            className={cn('w-64 flex flex-col gap-3 rounded-xl p-2', drag ? 'ring-1 ring-dashed ring-primary/30' : '')}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) onStatusChange(id, col.id); setDrag(null); }}>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
              <span className="text-sm font-semibold text-foreground">{col.label}</span>
              <span className="w-5 h-5 rounded-full bg-secondary text-xs flex items-center justify-center text-muted-foreground border border-border">{items.length}</span>
            </div>
            <div className="flex-1 space-y-2 min-h-[60px]">
              {items.map(t => (
                <div key={t.id} draggable
                  onDragStart={e => { e.dataTransfer.setData('text/plain', t.id); setDrag(t.id); }}
                  onDragEnd={() => setDrag(null)}
                  onClick={() => onOpen(t)}
                  className={cn('vanto-card p-3 cursor-pointer hover:border-primary/30 transition-all', drag === t.id && 'opacity-40 scale-95')}>
                  <div className="h-0.5 rounded-full mb-2" style={{ background: col.color, opacity: 0.6 }} />
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{t.domain}</p>
                    </div>
                    <GripVertical size={12} className="text-muted-foreground shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {t.approach && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/10 text-primary border border-primary/30">Template {t.approach}</span>}
                    {t.category && <span className="px-1.5 py-0.5 rounded text-[9px] text-muted-foreground border border-border">{t.category}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Table ─────────────────────────────────────────────────────────
function TableView({ targets, onOpen }: { targets: Target[]; onOpen: (t: Target) => void }) {
  return (
    <div className="p-6">
      <div className="vanto-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Site</th>
              <th className="text-left px-3 py-2">Domain</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Approach</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Last send</th>
              <th className="text-left px-3 py-2">Published URL</th>
            </tr>
          </thead>
          <tbody>
            {targets.map(t => (
              <tr key={t.id} onClick={() => onOpen(t)} className="border-t border-border hover:bg-secondary/40 cursor-pointer">
                <td className="px-3 py-2 font-medium text-foreground">{t.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{t.domain}</td>
                <td className="px-3 py-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold border" style={{ background: `${ALL_STATUS_COLOR[t.status]}22`, color: ALL_STATUS_COLOR[t.status], borderColor: `${ALL_STATUS_COLOR[t.status]}66` }}>
                    {t.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{t.approach || '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{t.category || '—'}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{t.last_send_at ? new Date(t.last_send_at).toLocaleDateString() : '—'}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-[200px]">{t.published_url || '—'}</td>
              </tr>
            ))}
            {targets.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">No targets. Click Import CSV or New target to get started.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Templates ─────────────────────────────────────────────────────
function TemplatesView({ templates, reload }: { templates: Template[]; reload: () => void }) {
  return (
    <div className="p-6 grid gap-4 md:grid-cols-2">
      {templates.map(t => (
        <TemplateCard key={t.id} tpl={t} onSaved={reload} />
      ))}
    </div>
  );
}

function TemplateCard({ tpl, onSaved }: { tpl: Template; onSaved: () => void }) {
  const [subject, setSubject] = useState(tpl.subject_tpl);
  const [body, setBody] = useState(tpl.body_tpl);
  const [saving, setSaving] = useState(false);
  const dirty = subject !== tpl.subject_tpl || body !== tpl.body_tpl;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('backlink_templates' as never).update({
      subject_tpl: subject, body_tpl: body, version: tpl.version + 1,
    } as never).eq('id', tpl.id);
    setSaving(false);
    if (error) return toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    toast({ title: 'Template saved', description: `${tpl.name} → v${tpl.version + 1}` });
    onSaved();
  };

  return (
    <div className="vanto-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Template {tpl.code} — {tpl.name}</p>
          <p className="text-[10px] text-muted-foreground">Placeholders: {'{SiteName}'} · {'{FirstName}'} · {'{HOOK}'} · {'{URL}'} · {'{Topic}'}</p>
        </div>
        <span className="text-[10px] text-muted-foreground">v{tpl.version}</span>
      </div>
      <input value={subject} onChange={e => setSubject(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Subject" />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
        className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono text-xs" placeholder="Body" />
      <div className="flex justify-end">
        <button onClick={save} disabled={!dirty || saving} className="px-3 py-1.5 rounded-lg vanto-gradient text-primary-foreground text-xs font-medium disabled:opacity-40 flex items-center gap-1.5">
          {saving && <Loader2 size={12} className="animate-spin" />} Save
        </button>
      </div>
    </div>
  );
}

// ─── Settings ──────────────────────────────────────────────────────
function SettingsView() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('integration_settings').select('value').eq('key', 'backlink_outreach_enabled').maybeSingle();
      setEnabled(!(data && ['false','off','0','no'].includes(String(data.value).toLowerCase())));
    })();
  }, []);
  const toggle = async () => {
    setSaving(true);
    const next = !enabled;
    const { error } = await supabase.from('integration_settings').upsert({ key: 'backlink_outreach_enabled', value: next ? 'true' : 'false' } as never);
    setSaving(false);
    if (error) return toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    setEnabled(next);
    toast({ title: `Outreach ${next ? 'enabled' : 'PAUSED'}` });
  };
  return (
    <div className="p-6 max-w-2xl space-y-4">
      <div className="vanto-card p-4">
        <p className="text-sm font-semibold text-foreground mb-1">Kill switch</p>
        <p className="text-xs text-muted-foreground mb-3">When paused, all new sends are rejected by the database trigger. Existing rows are unaffected.</p>
        <button onClick={toggle} disabled={saving || enabled === null} className={cn(
          'px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2',
          enabled ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'vanto-gradient text-primary-foreground'
        )}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          {enabled === null ? 'Loading…' : enabled ? 'Pause outreach' : 'Resume outreach'}
        </button>
      </div>
      <div className="vanto-card p-4 text-xs text-muted-foreground space-y-2">
        <p className="text-sm font-semibold text-foreground">Spam-safety caps (enforced in database)</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>≤ 5 sends per user per rolling 24 hours</li>
          <li>≤ 1 send per domain per 14 days</li>
          <li>Kill switch above overrides everything</li>
          <li>Every send writes an audit row in <code className="text-foreground">backlink_outreach_log</code></li>
        </ul>
      </div>
    </div>
  );
}

// ─── Target drawer ─────────────────────────────────────────────────
function TargetDrawer({ target, templates, onClose, reload }: {
  target: Target; templates: Template[]; onClose: () => void; reload: () => void;
}) {
  const [t, setT] = useState<Target>(target);
  const [tplId, setTplId] = useState<string>(templates.find(x => x.code === target.approach)?.id || templates[0]?.id || '');
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('backlink_outreach_log' as never).select('*').eq('target_id', target.id).order('created_at', { ascending: false }).limit(50);
      if (data) setLog(data as unknown as LogRow[]);
    })();
  }, [target.id]);

  useEffect(() => {
    const tpl = templates.find(x => x.id === tplId);
    setPreview(tpl ? renderTemplate(tpl, t) : null);
  }, [tplId, t, templates]);

  const saveField = async (patch: Partial<Target>) => {
    setSaving(true);
    const { error } = await supabase.from('backlink_targets' as never).update(patch as never).eq('id', t.id);
    setSaving(false);
    if (error) return toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    setT({ ...t, ...patch });
    reload();
  };

  const send = async () => {
    if (!preview || !tplId) return;
    setSending(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('backlink_outreach_log' as never).insert({
      target_id: t.id, template_id: tplId, event_type: 'sent', direction: 'outbound',
      subject: preview.subject, body: preview.body,
      metadata: { via: 'mailto', hook_used: t.first_line_hook },
      performed_by: user?.id ?? null,
    } as never);
    setSending(false);
    if (error) {
      const msg = /backlink_daily_cap_exceeded/.test(error.message) ? 'Daily cap reached (5 sends / 24h)'
        : /backlink_domain_cooldown/.test(error.message) ? 'Domain cooldown: another send to this domain within the last 14 days'
        : /backlink_outreach_disabled/.test(error.message) ? 'Outreach is paused (Settings → Kill switch)'
        : error.message;
      return toast({ title: 'Blocked', description: msg, variant: 'destructive' });
    }
    // Bump target
    await supabase.from('backlink_targets' as never).update({
      status: t.status === 'queued' ? 'contacted' : t.status,
      last_send_at: new Date().toISOString(),
    } as never).eq('id', t.id);
    // Open mailto
    const mailto = `mailto:?subject=${encodeURIComponent(preview.subject)}&body=${encodeURIComponent(preview.body)}`;
    window.open(mailto, '_blank');
    toast({ title: 'Logged & mailto opened', description: 'Finish the send from your email client.' });
    reload();
    // Reload log
    const { data } = await supabase.from('backlink_outreach_log' as never).select('*').eq('target_id', t.id).order('created_at', { ascending: false }).limit(50);
    if (data) setLog(data as unknown as LogRow[]);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-2xl h-full bg-background border-l border-border overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-background border-b border-border px-5 py-3 flex items-center justify-between z-10">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{t.name}</p>
            <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 truncate max-w-full">
              {t.url} <ExternalLink size={10} />
            </a>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Meta editable */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select value={t.status} onChange={e => saveField({ status: e.target.value as Status })} className="fld">
                {(['queued','contacted','reply','negotiating','published','dead','dnc','blocked','unchecked'] as Status[]).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Approach">
              <select value={t.approach || ''} onChange={e => { const v = (e.target.value || null) as Target['approach']; saveField({ approach: v }); setTplId(templates.find(x => x.code === v)?.id || tplId); }} className="fld">
                <option value="">—</option>
                {['A','B','C','D'].map(c => <option key={c} value={c}>Template {c}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <input value={t.category || ''} onChange={e => setT({ ...t, category: e.target.value })} onBlur={() => saveField({ category: t.category })} className="fld" />
            </Field>
            <Field label="Contact URL">
              <input value={t.contact_url || ''} onChange={e => setT({ ...t, contact_url: e.target.value })} onBlur={() => saveField({ contact_url: t.contact_url })} className="fld" placeholder="Contact form URL" />
            </Field>
            <Field label="Published backlink URL" span2>
              <input value={t.published_url || ''} onChange={e => setT({ ...t, published_url: e.target.value })} onBlur={() => saveField({ published_url: t.published_url })} className="fld" />
            </Field>
            <Field label="First-line hook (personalisation)" span2>
              <textarea value={t.first_line_hook || ''} rows={3} onChange={e => setT({ ...t, first_line_hook: e.target.value })} onBlur={() => saveField({ first_line_hook: t.first_line_hook })} className="fld font-mono text-xs" />
            </Field>
            <Field label="Notes" span2>
              <textarea value={t.notes || ''} rows={3} onChange={e => setT({ ...t, notes: e.target.value })} onBlur={() => saveField({ notes: t.notes })} className="fld" />
            </Field>
          </div>

          {saving && <p className="text-[10px] text-muted-foreground">Saving…</p>}

          {/* Send flow */}
          <div className="vanto-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Mail size={14} /> Compose outreach</p>
              <select value={tplId} onChange={e => setTplId(e.target.value)} className="fld max-w-[220px]">
                {templates.map(x => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
              </select>
            </div>
            {preview && (
              <>
                <input readOnly value={preview.subject} className="fld text-sm" />
                <textarea readOnly value={preview.body} rows={10} className="fld text-xs font-mono" />
              </>
            )}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[10px] text-muted-foreground flex-1 min-w-[200px]">Send opens your mail client. Every send is logged and counts against caps (5/24h, 1/domain/14d).</p>
              <div className="flex items-center gap-2">
                <DraftGuestPostButton targetId={t.id} onDrafted={reload} />
                <button onClick={send} disabled={sending || !preview} className="px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center gap-2">
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Log & send
                </button>
              </div>
            </div>
          </div>

          {/* Activity */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Activity ({log.length})</p>
            <div className="space-y-2">
              {log.map(l => (
                <div key={l.id} className="vanto-card p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{l.event_type}{l.direction ? ` · ${l.direction}` : ''}</span>
                    <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
                  </div>
                  {l.subject && <p className="text-muted-foreground mt-1 truncate">{l.subject}</p>}
                </div>
              ))}
              {log.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* utility class */}
      <style>{`.fld{width:100%;padding:.5rem .75rem;border-radius:.5rem;background:hsl(var(--secondary));border:1px solid hsl(var(--border));color:hsl(var(--foreground));font-size:.8125rem;outline:none}.fld:focus{box-shadow:0 0 0 1px hsl(var(--primary))}`}</style>
    </div>
  );
}

function Field({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}

// ─── New target ────────────────────────────────────────────────────
function NewTargetDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [category, setCategory] = useState('');
  const [approach, setApproach] = useState<'A'|'B'|'C'|'D'|''>('A'); const [hook, setHook] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || !url.trim()) return toast({ title: 'Name and URL required', variant: 'destructive' });
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('backlink_targets' as never).insert({
      name: name.trim(), url: url.trim(), category: category.trim() || null,
      approach: approach || null, first_line_hook: hook.trim() || null,
      status: 'queued', created_by: user?.id ?? null,
    } as never);
    setSaving(false);
    if (error) return toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    toast({ title: 'Target added' });
    onCreated();
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="vanto-card w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><p className="text-sm font-bold text-foreground">New backlink target</p><button onClick={onClose}><X size={16} /></button></div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Site name" className="fld" />
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className="fld" />
        <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Category (finance / wellness / …)" className="fld" />
        <select value={approach} onChange={e => setApproach(e.target.value as 'A'|'B'|'C'|'D'|'')} className="fld">
          <option value="">Approach —</option>
          <option value="A">A — Guest post</option>
          <option value="B">B — Link insert</option>
          <option value="C">C — Podcast</option>
          <option value="D">D — Forum</option>
        </select>
        <textarea value={hook} onChange={e => setHook(e.target.value)} rows={3} placeholder="Personalised first-line hook" className="fld font-mono text-xs" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm flex items-center gap-2">{saving && <Loader2 size={14} className="animate-spin" />} Create</button>
        </div>
        <style>{`.fld{width:100%;padding:.5rem .75rem;border-radius:.5rem;background:hsl(var(--secondary));border:1px solid hsl(var(--border));color:hsl(var(--foreground));font-size:.8125rem;outline:none}`}</style>
      </div>
    </div>
  );
}

// ─── Import CSV ────────────────────────────────────────────────────
// Expected columns match backlink_tracker_v2.csv:
//   #, Site, Status, Approach, Contact_URL, First_Line_Hook, ...
function ImportCsvDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const parseCsv = (raw: string): string[][] => {
    const rows: string[][] = [];
    let cur: string[] = []; let field = ''; let q = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) {
        if (c === '"' && raw[i+1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else {
        if (c === '"') q = true;
        else if (c === ',') { cur.push(field); field = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && raw[i+1] === '\n') i++; cur.push(field); field=''; if (cur.some(x => x.length)) rows.push(cur); cur = []; }
        else field += c;
      }
    }
    if (field.length || cur.length) { cur.push(field); rows.push(cur); }
    return rows;
  };

  const normalizeStatus = (s: string): Status => {
    const t = s.toUpperCase();
    if (t === 'DEAD') return 'dead';
    if (t === 'BLOCKED') return 'blocked';
    if (t === 'UNCHECKED') return 'unchecked';
    if (t === 'LIVE') return 'queued';
    return 'queued';
  };

  const normalizeApproach = (s: string): 'A'|'B'|'C'|'D'|null => {
    const m = s.trim().charAt(0).toUpperCase();
    return (['A','B','C','D'].includes(m) ? m : null) as 'A'|'B'|'C'|'D'|null;
  };

  const run = async () => {
    const rows = parseCsv(text.trim());
    if (rows.length < 2) return toast({ title: 'No rows to import', variant: 'destructive' });
    const header = rows[0].map(h => h.trim());
    const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
    const iSite = idx('Site'), iStatus = idx('Status'), iApproach = idx('Approach'),
          iContact = idx('Contact_URL'), iHook = idx('First_Line_Hook'), iNotes = idx('Notes');
    if (iSite < 0) return toast({ title: 'CSV missing Site column', variant: 'destructive' });
    setBusy(true);
    let ok = 0, skipped = 0, failed = 0;
    for (const r of rows.slice(1)) {
      const site = r[iSite]?.trim(); if (!site) { skipped++; continue; }
      const url = /^https?:/i.test(site) ? site : `https://${site.replace(/^https?:\/\//,'')}`;
      const payload = {
        name: site, url,
        status: iStatus >= 0 ? normalizeStatus(r[iStatus] || '') : 'queued',
        approach: iApproach >= 0 ? normalizeApproach(r[iApproach] || '') : null,
        contact_url: iContact >= 0 ? (r[iContact]?.trim() || null) : null,
        first_line_hook: iHook >= 0 ? (r[iHook]?.trim() || null) : null,
        notes: iNotes >= 0 ? (r[iNotes]?.trim() || null) : null,
      };
      const { error } = await supabase.from('backlink_targets' as never).insert(payload as never);
      if (error) { if (/duplicate|unique/i.test(error.message)) skipped++; else failed++; } else ok++;
    }
    setBusy(false);
    toast({ title: 'Import done', description: `Added ${ok} · skipped ${skipped} · failed ${failed}` });
    onDone();
  };

  const loadV2 = async () => {
    // paste-in helper: fetch backlink_tracker_v2.csv from documents (user-side); fallback to a small seed
    setText(SEED_CSV_V2);
    toast({ title: 'v2 kit seed loaded', description: '30 targets pre-filled — click Import.' });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="vanto-card w-full max-w-3xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-foreground">Import CSV</p>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <p className="text-xs text-muted-foreground">Paste a CSV with columns: <code>Site, Status, Approach, Contact_URL, First_Line_Hook, Notes</code>. Use the seed button to load the 30-target v2 kit.</p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={14} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Paste CSV here…" />
        <div className="flex items-center justify-between">
          <button onClick={loadV2} className="text-xs text-primary hover:underline">Load v2 Outreach Kit seed (30 targets)</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground">Cancel</button>
            <button onClick={run} disabled={busy || !text.trim()} className="px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm flex items-center gap-2 disabled:opacity-40">
              {busy && <Loader2 size={14} className="animate-spin" />} Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Embedded seed = first row + 30 target rows from backlink_tracker_v2.csv (compact, only used columns)
const SEED_CSV_V2 = `Site,Status,Approach,Contact_URL,First_Line_Hook,Notes
localmoney.co.za,DEAD,,,,Was warm in v1; DNS/timeout Jul 2026
talkingmoneywithnozi.co.za,LIVE,A,https://talkingmoneywithnozi.co.za/contact,"Your recent piece on {latest} — the framing on financial confidence for SA women is exactly the gap I keep hitting in wellness distribution.",SA-women finance angle
theazanianinvestor.com,LIVE,A,https://theazanianinvestor.com/contact,"Your take on income diversification for young SA investors matched something I've been researching from the wellness / MLM angle.",Diversification angle
theforumsa.co.za,LIVE,D,https://theforumsa.co.za,Post 3 useful replies in MLM subforum before any link.,MLM subforum active
wealthanize.com,LIVE,B,https://wealthanize.com/contact,"You've already covered MLM in SA fairly — I run one of the operations you'd probably audit. Happy to be a case study.",HOT - topical match
futurefreedom.co.za,LIVE,B,https://futurefreedom.co.za,"We're not competing (different product line) but our audiences overlap — worth a mutual case-study exchange?",Non-competing MLM
justmoney.co.za,LIVE,A,https://www.justmoney.co.za/contact-us/,"Your loan-comparison and debt-relief content is what SA needs — I'd like to add a piece on legit extra-income options.",High authority
fin24.com,LIVE,A,https://www.news24.com/fin24,"Submitting to MyVoice: op-ed on the SA wellness economy and MLM regulation in 2026.",High bar - big payoff
bizcommunity.com,LIVE,,https://www.bizcommunity.com/PressOffice.aspx,Use their press-release submission form; keep to 400 words.,VantoOS launch PR
skattie.co.za,DEAD,,,,Offline Jul 2026
myfinancialrescue.co.za,DEAD,,,,Offline Jul 2026
smesouthafrica.co.za,BLOCKED,A,https://smesouthafrica.co.za/contact,"Distribution as a micro-business: what SA SMEs can learn from a 200-person APLGO downline.",Bot-blocked; use form
entrepreneurmag.co.za,DEAD,,,,Offline Jul 2026
health24.com,LIVE,A,https://www.health24.com,"Your natural-remedy coverage is one of the few in SA that isn't clickbait — I'd like to contribute a sourced piece on plant-based lozenges.",Contributor programme
longevitylive.com,LIVE,A,https://longevitylive.com/contact-us/,"You accept contributors on natural wellness. I have a 900-word draft on plant-based lozenges and everyday stress — SA data.",Accepts contributors
womenshealthsa.co.za,LIVE,A,https://www.womenshealthsa.co.za,"Your sleep and stress coverage is where I'd like to add a piece — SA numbers on cortisol and everyday stress relief.",Women's health
all4women.co.za,BLOCKED,A,https://www.all4women.co.za/contact-us,"Contributor pitch: '5 natural fixes for SA women running on empty' — 900 words, no ads.",Bot-blocked; use form
reddit.com/r/southafrica,UNCHECKED,D,https://www.reddit.com/r/southafrica,4+ genuine replies before any link.,Strict spam rules
reddit.com/r/PersonalFinanceZA,UNCHECKED,D,https://www.reddit.com/r/PersonalFinanceZA,Answer income questions; no direct promotion.,Strict spam rules
Facebook Groups (Side Hustles SA / MLM SA),UNCHECKED,D,,No cold links; provide value first.,Free but risky
businesslive.co.za,LIVE,A,https://www.businesslive.co.za,"Your Money & Investing section carries op-eds — I'd like to submit one on the informal wellness economy in SA.",BDay / FM online
iol.co.za,LIVE,A,https://www.iol.co.za/personal-finance,"Personal Finance vertical: pitch 'Extra-income options for SA households in 2026 — legit vs scams' with distributor data.",Big reach
sowetanlive.co.za,LIVE,A,https://www.sowetanlive.co.za/contact-us/,"Op-ed pitch: 'What township wellness looks like in 2026' — first-person from a 200+ distributor network.",National reach
htxt.co.za,LIVE,A,https://www.htxt.co.za/contact-us/,"Your startup coverage — happy to be interviewed on VantoOS (open CRM built for SA MLM ops).",Tech / startup angle
biznews.com,LIVE,A,https://www.biznews.com/contact,"Op-ed: 'Why the JSE misses the SA wellness economy — 40k independent distributors and no one's counting.'",Business commentary
wellnesswarehouse.com,LIVE,B,https://www.wellnesswarehouse.com/contact-us,"Your blog covers plant-based supplements — my post on APLGO lozenges might slot into your natural-remedy roundup.",Retailer blog
faithful-to-nature.co.za,BLOCKED,B,https://www.faithful-to-nature.co.za/contact-us,"Resource-page addition: SA-specific natural stress relief guide with pricing and shipping.",Eco retailer
health-e.org.za,LIVE,A,https://health-e.org.za/contact-us/,"Your public-health coverage — I have a data-backed piece on sleep debt in SA households (n=200 survey).",NGO / high trust
mommypage.co.za,DEAD,,,,Offline Jul 2026
parent24.com,BLOCKED,A,https://www.parent24.com/Contact-us,"Contributor pitch: 'Natural energy for SA parents who can't do coffee anymore' — 900 words, sources, no ads.",News24 network`;
