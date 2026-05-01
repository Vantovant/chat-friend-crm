import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  Loader2, RefreshCw, ShieldAlert, CheckCircle2, AlertTriangle, Flame,
  UserX, MessageSquare, Copy, Download, Mic, ClipboardCheck, UserCheck, FileText, Phone,
} from 'lucide-react';
import { downloadVCard, copyContactCard } from '@/lib/vcard';
import { DictateMessage } from './DictateMessage';
import { buildRecoveryDraft } from '@/lib/recovery-drafts';

type Score = 'green' | 'yellow' | 'orange' | 'red';

interface AuditRow {
  id: string;
  conversation_id: string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_source: string | null;
  damage_score: Score;
  recoverable: boolean;
  vanto_step_in: boolean;
  outbound_total: number;
  inbound_total: number;
  duplicate_outbound: number;
  outbound_24h: number;
  had_proof_url: boolean;
  had_aplgo_header: boolean;
  had_shop_link: boolean;
  had_local_number: boolean;
  price_leak_detected: boolean;
  price_leak_text: string | null;
  premature_money_push: boolean;
  duplicate_messages: boolean;
  weak_first_touch: boolean;
  intent: string;
  temperature: string;
  interest_topic: string | null;
  name_known: boolean;
  recommended_action: string | null;
  recovery_draft: string | null;
  first_outbound_snippet: string | null;
  last_outbound_snippet: string | null;
  last_inbound_snippet: string | null;
  scanned_at: string;
  recovery_status?: string | null;
  reviewed_at?: string | null;
  handled_at?: string | null;
  vcard_saved_at?: string | null;
  recovery_angle?: string | null;
}

type Queue = 'all' | 'red' | 'orange' | 'yellow_hot' | 'name_needed' | 'clean';

const SCORE_STYLES: Record<Score, string> = {
  green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  yellow: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  red: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function DamageControlModule() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<Score | 'all'>('all');
  const [stepInOnly, setStepInOnly] = useState(false);
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const [dictateOpen, setDictateOpen] = useState<string | null>(null);
  const [personalDrafts, setPersonalDrafts] = useState<Record<string, string>>({});

  const fetchRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('prospector_damage_audit' as any)
      .select('*')
      .order('damage_score', { ascending: false })
      .order('vanto_step_in', { ascending: false })
      .order('scanned_at', { ascending: false })
      .limit(500);
    if (error) {
      toast({ title: 'Failed to load audit', description: error.message, variant: 'destructive' });
    } else {
      setRows((data as any[]) as AuditRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRows(); }, []);

  const runAudit = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('prospector-damage-audit', { body: {} });
      if (error) throw error;
      const d = data as any;
      toast({
        title: 'Damage audit complete',
        description: `Scanned ${d?.scanned ?? 0} · 🟢${d?.green ?? 0} 🟡${d?.yellow ?? 0} 🟠${d?.orange ?? 0} 🔴${d?.red ?? 0} · Step-in ${d?.vanto_step_in ?? 0} · Names ${d?.name_confirmation_needed ?? 0}`,
      });
      await fetchRows();
    } catch (e: any) {
      toast({ title: 'Audit failed', description: e.message, variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  const exportContact = async (r: AuditRow) => {
    const { data: c } = await supabase
      .from('contacts')
      .select('name, phone, email, first_name, last_name, contact_source')
      .eq('id', r.contact_id)
      .maybeSingle();
    if (!c) return;
    downloadVCard({
      name: c.name,
      first_name: (c as any).first_name,
      last_name: (c as any).last_name,
      phone: c.phone,
      email: c.email,
      source: (c as any).contact_source || r.contact_source,
      interest_topic: r.interest_topic,
      temperature: r.temperature,
      crm_contact_id: r.contact_id,
    });
    toast({ title: 'vCard downloaded', description: 'Save it to your phone — WhatsApp will then show the contact name.' });
  };

  const copyCard = async (r: AuditRow) => {
    const { data: c } = await supabase
      .from('contacts').select('name, phone, email, contact_source').eq('id', r.contact_id).maybeSingle();
    if (!c) return;
    const text = copyContactCard({
      name: c.name, phone: c.phone, email: c.email,
      source: (c as any).contact_source || r.contact_source,
      interest_topic: r.interest_topic, temperature: r.temperature,
      crm_contact_id: r.contact_id,
    });
    await navigator.clipboard.writeText(text);
    toast({ title: 'Contact card copied' });
  };

  const filtered = rows.filter(r => {
    if (scoreFilter !== 'all' && r.damage_score !== scoreFilter) return false;
    if (stepInOnly && !r.vanto_step_in) return false;
    return true;
  });

  const stats = {
    total: rows.length,
    green: rows.filter(r => r.damage_score === 'green').length,
    yellow: rows.filter(r => r.damage_score === 'yellow').length,
    orange: rows.filter(r => r.damage_score === 'orange').length,
    red: rows.filter(r => r.damage_score === 'red').length,
    stepIn: rows.filter(r => r.vanto_step_in).length,
    nameNeeded: rows.filter(r => !r.name_known).length,
    duplicates: rows.reduce((s, r) => s + r.duplicate_outbound, 0),
    weakTouch: rows.filter(r => r.weak_first_touch).length,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 md:px-6 py-4 border-b border-border flex items-center justify-between shrink-0 gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber-400" />
            Master Prospector — Damage Control (Level 1)
          </h3>
          <p className="text-xs text-muted-foreground">
            Read-only audit. No bulk send. No auto recovery. One-by-one approval only.
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Run Damage Audit
        </button>
      </div>

      <div className="px-4 md:px-6 py-4 border-b border-border grid grid-cols-3 md:grid-cols-6 gap-2 shrink-0">
        {[
          { label: 'Total', value: stats.total, icon: MessageSquare, color: 'text-foreground' },
          { label: 'Green', value: stats.green, icon: CheckCircle2, color: 'text-emerald-400', f: 'green' as const },
          { label: 'Yellow', value: stats.yellow, icon: AlertTriangle, color: 'text-amber-400', f: 'yellow' as const },
          { label: 'Orange', value: stats.orange, icon: AlertTriangle, color: 'text-orange-400', f: 'orange' as const },
          { label: 'Red', value: stats.red, icon: ShieldAlert, color: 'text-destructive', f: 'red' as const },
          { label: 'Step-In', value: stats.stepIn, icon: Flame, color: 'text-red-500' },
        ].map(s => {
          const Icon = s.icon;
          const active = s.f && scoreFilter === s.f;
          return (
            <button
              key={s.label}
              onClick={() => s.f && setScoreFilter(active ? 'all' : s.f)}
              className={cn('vanto-card p-2 flex items-center gap-2 text-left transition-colors', active && 'border-primary/50')}
            >
              <Icon size={16} className={s.color} />
              <div>
                <p className={cn('text-lg font-bold leading-none', s.color)}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-4 md:px-6 py-2 border-b border-border flex items-center gap-3 text-xs shrink-0 flex-wrap">
        <span className="text-muted-foreground">Filters:</span>
        {(['all', 'green', 'yellow', 'orange', 'red'] as const).map(s => (
          <button
            key={s}
            onClick={() => setScoreFilter(s)}
            className={cn(
              'px-2 py-1 rounded capitalize',
              scoreFilter === s ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => setStepInOnly(v => !v)}
          className={cn(
            'ml-2 px-2 py-1 rounded flex items-center gap-1',
            stepInOnly ? 'bg-red-500/20 text-red-400' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Flame size={12} /> Vanto step-in only
        </button>
        <span className="ml-auto text-muted-foreground">
          Duplicates: <strong className="text-amber-400">{stats.duplicates}</strong> · Weak first-touch: <strong className="text-orange-400">{stats.weakTouch}</strong> · Names needed: <strong className="text-blue-400">{stats.nameNeeded}</strong>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
            <ShieldAlert size={24} className="opacity-40" />
            <p>No audit rows match. Click "Run Damage Audit" to scan all conversations.</p>
          </div>
        ) : (
          filtered.map(r => (
            <div key={r.id} className={cn(
              'vanto-card p-3 md:p-4 flex flex-col gap-2',
              r.damage_score === 'red' && 'border-l-4 border-l-destructive',
              r.damage_score === 'orange' && 'border-l-4 border-l-orange-500',
              r.damage_score === 'yellow' && 'border-l-4 border-l-amber-500',
            )}>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-foreground truncate">
                      {r.contact_name || r.contact_phone || 'Unknown'}
                    </p>
                    <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold border uppercase', SCORE_STYLES[r.damage_score])}>
                      {r.damage_score}
                    </span>
                    {r.vanto_step_in && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-red-500/15 text-red-400 border-red-500/30 uppercase flex items-center gap-1">
                        <Flame size={10} /> VANTO STEP IN
                      </span>
                    )}
                    {!r.name_known && (
                      <span className="px-2 py-0.5 rounded text-[10px] border bg-blue-500/15 text-blue-400 border-blue-500/30 uppercase flex items-center gap-1">
                        <UserX size={10} /> name needed
                      </span>
                    )}
                    {r.price_leak_detected && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-destructive/15 text-destructive border-destructive/30 uppercase">
                        ⚠ price leak
                      </span>
                    )}
                    {r.duplicate_messages && (
                      <span className="px-2 py-0.5 rounded text-[10px] border bg-amber-500/15 text-amber-400 border-amber-500/30">
                        {r.duplicate_outbound} dup
                      </span>
                    )}
                    {r.weak_first_touch && (
                      <span className="px-2 py-0.5 rounded text-[10px] border bg-orange-500/15 text-orange-400 border-orange-500/30 uppercase">
                        weak first-touch
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded text-[10px] border bg-secondary text-muted-foreground border-border uppercase">
                      {r.intent}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] border bg-secondary text-muted-foreground border-border uppercase">
                      {r.temperature}
                    </span>
                    {r.interest_topic && (
                      <span className="px-2 py-0.5 rounded text-[10px] border bg-primary/10 text-primary border-primary/20">
                        {r.interest_topic}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
                    <span>📞 {r.contact_phone || '—'}</span>
                    <span>↗ {r.outbound_total} out · ↘ {r.inbound_total} in · 24h: {r.outbound_24h}</span>
                    <span>Source: {r.contact_source || 'unknown'}</span>
                    <span className="text-foreground/80">First-touch:
                      <span className={cn('ml-1', r.had_proof_url ? 'text-emerald-400' : 'text-destructive')}>{r.had_proof_url ? '✓' : '✗'}proof</span>
                      <span className={cn('ml-1', r.had_aplgo_header ? 'text-emerald-400' : 'text-destructive')}>{r.had_aplgo_header ? '✓' : '✗'}APLGO</span>
                      <span className={cn('ml-1', r.had_shop_link ? 'text-emerald-400' : 'text-destructive')}>{r.had_shop_link ? '✓' : '✗'}shop</span>
                      <span className={cn('ml-1', r.had_local_number ? 'text-emerald-400' : 'text-destructive')}>{r.had_local_number ? '✓' : '✗'}local#</span>
                    </span>
                  </div>
                  {r.price_leak_text && (
                    <p className="text-xs text-destructive italic mt-1 line-clamp-2">⚠ Price leak: "{r.price_leak_text}"</p>
                  )}
                  {r.last_inbound_snippet && (
                    <p className="text-xs text-muted-foreground italic mt-1 line-clamp-1">↘ "{r.last_inbound_snippet}"</p>
                  )}
                  {r.last_outbound_snippet && (
                    <p className="text-xs text-muted-foreground/70 italic mt-1 line-clamp-1">↗ "{r.last_outbound_snippet}"</p>
                  )}
                  {r.recommended_action && (
                    <p className="text-xs font-medium text-foreground mt-2">→ {r.recommended_action}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => exportContact(r)}
                    title="Export vCard (.vcf) — save on phone so WhatsApp shows the name"
                    className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] bg-secondary hover:bg-secondary/80 text-foreground border border-border"
                  >
                    <Download size={12} /> vCard
                  </button>
                  <button
                    onClick={() => copyCard(r)}
                    title="Copy contact card text"
                    className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] bg-secondary hover:bg-secondary/80 text-foreground border border-border"
                  >
                    <Copy size={12} /> Copy
                  </button>
                </div>
              </div>

              {r.recovery_draft && (
                <div className="mt-1 pt-2 border-t border-border">
                  <button
                    onClick={() => setOpenDraft(openDraft === r.id ? null : r.id)}
                    className="text-[11px] uppercase font-semibold text-primary hover:text-primary/80"
                  >
                    {openDraft === r.id ? 'Hide' : 'View'} recovery draft (read-only — copy to send manually)
                  </button>
                  {openDraft === r.id && (
                    <div className="mt-2 rounded-lg bg-secondary/40 border border-border p-3 space-y-2">
                      <pre className="text-xs text-foreground whitespace-pre-wrap font-sans">{r.recovery_draft}</pre>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            await navigator.clipboard.writeText(r.recovery_draft || '');
                            toast({ title: 'Draft copied', description: 'Send it manually after review.' });
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-primary/15 text-primary border border-primary/30"
                        >
                          <Copy size={12} /> Copy draft
                        </button>
                        <span className="text-[10px] text-muted-foreground self-center">
                          Auto-send disabled in Level 1. Vanto sends manually after review.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(r.damage_score === 'orange' || r.damage_score === 'red') && (
                <div className="mt-1 pt-2 border-t border-border">
                  <button
                    onClick={() => setDictateOpen(dictateOpen === r.id ? null : r.id)}
                    className="flex items-center gap-1 text-[11px] uppercase font-semibold text-primary hover:text-primary/80"
                  >
                    <Mic size={12} /> {dictateOpen === r.id ? 'Hide' : 'Dictate'} personal recovery message
                  </button>
                  {dictateOpen === r.id && (
                    <div className="mt-2 rounded-lg bg-secondary/40 border border-border p-3 space-y-2">
                      <DictateMessage
                        size="compact"
                        value={personalDrafts[r.id] || ''}
                        onChange={(v) => setPersonalDrafts((prev) => ({ ...prev, [r.id]: v }))}
                        warning={
                          r.damage_score === 'red'
                            ? 'VANTO STEP IN — personal message recommended. This lead has trust damage. Review carefully before sending.'
                            : 'This lead has trust damage. Review carefully before sending.'
                        }
                        languageHint="South African English, may mix isiZulu / Sesotho / Setswana"
                      />
                      <textarea
                        value={personalDrafts[r.id] || ''}
                        onChange={(e) => setPersonalDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        rows={4}
                        placeholder="Your dictated/edited message will appear here. Send manually after review."
                        className="w-full rounded-md bg-background/60 border border-border px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
