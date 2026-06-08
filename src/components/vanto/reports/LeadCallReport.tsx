import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Printer, RefreshCw, Star, Phone, Sparkles, Pencil, ClipboardPaste } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { LEAD_TYPES, type LeadType } from '@/lib/vanto-data';

// Tight, word-boundary distributor intent keywords.
const DISTRIBUTOR_PATTERNS: RegExp[] = [
  /\bdistributor(s)?\b/i,
  /\bdistributorship\b/i,
  /\br\s?375\b/i,
  /\bmembership\b/i,
  /\bmember\s?(ship)? fee\b/i,
  /\bbusiness associate\b/i,
  /\bbe(ing)? (a )?(distributor(s)?|member|business associate|partner)\b/i,
  /\bhow (do|can) i (be|become|join|register|sign up)\b.*\b(distributor(s)?|member|business associate|partner)\b/i,
  /\binterested\b.{0,80}\b(distributor(s)?|membership|member|business opportunity|business associate|partner)\b/i,
  /\b(distributor(s)?|membership|business opportunity|business associate|partner)\b.{0,80}\binterested\b/i,
  /\bi want to (be|become|join|register|sign up)\b.*\b(distributor(s)?|member|business associate|partner)\b/i,
  /\bjoin (aplgo|the business|as a distributor)\b/i,
  /\bbusiness opportunity\b/i,
  /\bopportunity to earn\b/i,
  /\bearn (extra )?(income|money)\b/i,
  /\bsponsor me\b/i,
  /\bsign me up\b/i,
  /\bregister (me )?as (a )?distributor\b/i,
  /\bbecome (a )?(distributor|member|partner)\b/i,
];

const HARD_CAP = 100;

type Contact = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  lead_type: string | null;
  temperature: string | null;
  interest: string | null;
  tags: string[] | null;
  notes: string | null;
  stage_id: string | null;
  created_at: string;
  updated_at: string;
};

type ThreadMsg = {
  ts: string;
  direction: 'in' | 'out';
  channel: 'twilio' | 'maytapi';
  body: string;
};

type Summary = {
  intent: string;
  distributor_interest: 'yes' | 'no' | 'maybe';
  key_questions: string[];
  answers_given: string[];
  open_items: string[];
  last_status: string;
  summary_text: string;
};

type Row = Contact & {
  isDistributor: boolean;
  firstInquiry: string | null;
  lastMessage: string | null;
  thread: ThreadMsg[];
  summary?: Summary | null;
};

type SortDir = 'none' | 'asc' | 'desc';
type SortKey = 'msgs' | 'firstInquiry' | 'lastMessage';

type ConversationRow = { id: string; contact_id: string | null };
type TwilioMessageRow = { conversation_id: string; content: string | null; is_outbound: boolean | null; created_at: string };
type MaytapiMessageRow = { contact_id: string | null; phone_e164: string | null; direction: string | null; body: string | null; received_at: string };
type CachedSummaryRow = { contact_id: string; summary: Summary };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown';
}

function detectDistributor(c: Contact, thread: ThreadMsg[]): boolean {
  const blob = `${c.lead_type || ''} ${c.interest || ''} ${c.notes || ''} ${c.tags?.join(' ') || ''} ${thread.map((m) => m.body).join(' ')}`;
  if (c.interest?.toLowerCase() === 'business') return true;
  return DISTRIBUTOR_PATTERNS.some((rx) => rx.test(blob));
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function displayName(c: Contact): string {
  if (c.name && c.name.trim()) return c.name;
  const fn = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return fn || c.phone || 'Unnamed';
}
function SortButton({ label, active, dir, onClick, align = 'left' }: { label: string; active: boolean; dir: SortDir; onClick: () => void; align?: 'left' | 'right' }) {
  const Icon = !active || dir === 'none' ? ArrowUpDown : dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-muted hover:text-foreground ${active && dir !== 'none' ? 'text-foreground' : 'text-muted-foreground'} ${align === 'right' ? 'ml-auto justify-end' : ''}`}
      title={`Sort by ${label}`}
    >
      {label}
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}


export function LeadCallReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [onlyDistributors, setOnlyDistributors] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('msgs');
  const [sortDir, setSortDir] = useState<SortDir>('none');
  const [fiFrom, setFiFrom] = useState('');
  const [fiTo, setFiTo] = useState('');
  const [lmFrom, setLmFrom] = useState('');
  const [lmTo, setLmTo] = useState('');
  const [generating, setGenerating] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeProgress, setSummarizeProgress] = useState<{ done: number; total: number } | null>(null);
  const [compactPdf, setCompactPdf] = useState(true);
  const [editor, setEditor] = useState<{ row: Row; lead_type: LeadType; notes: string; stage_id: string | null } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [stages, setStages] = useState<{ id: string; name: string; color: string | null }[]>([]);

  useEffect(() => {
    supabase.from('pipeline_stages').select('id, name, color').order('stage_order').then(({ data }) => {
      if (data) setStages(data as any);
    });
  }, []);

  function summaryAsText(s: Summary | null | undefined): string {
    if (!s) return '';
    const parts = [
      `[AI Summary]`,
      s.summary_text,
      s.intent ? `Interest: ${s.intent}` : '',
      `Distributor interest: ${s.distributor_interest.toUpperCase()}`,
      s.open_items.length ? `Next: ${s.open_items.join('; ')}` : '',
      s.last_status ? `Status: ${s.last_status}` : '',
    ].filter(Boolean);
    return parts.join('\n');
  }

  function openEditor(row: Row) {
    const allowed = LEAD_TYPES.map((l) => l.value);
    const current = allowed.includes(row.lead_type as LeadType) ? (row.lead_type as LeadType) : 'prospect';
    setEditor({ row, lead_type: current, notes: row.notes || '', stage_id: row.stage_id || null });
  }

  function pasteSummaryToNotes() {
    if (!editor) return;
    const block = summaryAsText(editor.row.summary);
    if (!block) { toast.info('No AI summary yet — generate it first.'); return; }
    const stamp = new Date().toLocaleString('en-ZA');
    const addition = `\n\n--- ${stamp} ---\n${block}`;
    setEditor({ ...editor, notes: (editor.notes || '').trimEnd() + addition });
  }

  async function saveEditor() {
    if (!editor) return;
    setSavingEdit(true);
    try {
      const prevStageId = editor.row.stage_id || null;
      const newStageId = editor.stage_id || null;
      const { error } = await supabase
        .from('contacts')
        .update({
          lead_type: editor.lead_type,
          notes: editor.notes.trim() || null,
          stage_id: newStageId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editor.row.id);
      if (error) throw error;

      if (prevStageId !== newStageId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const fromName = stages.find((s) => s.id === prevStageId)?.name || 'Unassigned';
          const toName = stages.find((s) => s.id === newStageId)?.name || 'Unassigned';
          await supabase.from('contact_activity').insert({
            contact_id: editor.row.id,
            performed_by: user.id,
            type: 'stage_changed',
            metadata: { from_stage: fromName, to_stage: toName, from_stage_id: prevStageId, to_stage_id: newStageId, source: 'lead_call_report' },
          });
        }
      }

      setRows((prev) => prev.map((r) => r.id === editor.row.id ? { ...r, lead_type: editor.lead_type, notes: editor.notes.trim() || null, stage_id: newStageId } : r));
      toast.success('Contact updated — visible in Contacts & CRM Pipeline.');
      setEditor(null);
    } catch (e) {
      toast.error('Save failed: ' + getErrorMessage(e));
    } finally {
      setSavingEdit(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const { data: contacts, error: cErr } = await supabase
        .from('contacts')
        .select('id, name, first_name, last_name, phone, phone_normalized, email, lead_type, temperature, interest, tags, notes, stage_id, created_at, updated_at')
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (cErr) throw cErr;
      const all = (contacts || []) as Contact[];
      if (all.length === 0) { setRows([]); return; }

      const ids = all.map((c) => c.id);
      const phones = all.map((c) => c.phone_normalized).filter(Boolean) as string[];

      const { data: convs } = await supabase
        .from('conversations')
        .select('id, contact_id')
        .in('contact_id', ids);
      const convIdToContact = new Map<string, string>();
      const convIds: string[] = [];
      ((convs || []) as ConversationRow[]).forEach((c) => {
        if (!c.contact_id) return;
        convIdToContact.set(c.id, c.contact_id);
        convIds.push(c.id);
      });

      const twilioByContact = new Map<string, ThreadMsg[]>();
      if (convIds.length > 0) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('conversation_id, content, is_outbound, created_at')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: true })
          .limit(5000);
        ((msgs || []) as TwilioMessageRow[]).forEach((m) => {
          const cid = convIdToContact.get(m.conversation_id);
          if (!cid) return;
          const arr = twilioByContact.get(cid) || [];
          arr.push({ ts: m.created_at, direction: m.is_outbound ? 'out' : 'in', channel: 'twilio', body: m.content || '' });
          twilioByContact.set(cid, arr);
        });
      }

      const maytapiByContact = new Map<string, ThreadMsg[]>();
      const { data: mMsgs } = await supabase
        .from('maytapi_messages')
        .select('contact_id, phone_e164, direction, body, received_at')
        .or(`contact_id.in.(${ids.join(',')}),phone_e164.in.(${phones.map((p) => `"${p}"`).join(',') || '""'})`)
        .order('received_at', { ascending: true })
        .limit(5000);
      const phoneToContact = new Map<string, string>();
      all.forEach((c) => { if (c.phone_normalized) phoneToContact.set(c.phone_normalized, c.id); });
      ((mMsgs || []) as MaytapiMessageRow[]).forEach((m) => {
        const cid = m.contact_id || (m.phone_e164 ? phoneToContact.get(m.phone_e164) : null);
        if (!cid) return;
        const arr = maytapiByContact.get(cid) || [];
        arr.push({ ts: m.received_at, direction: m.direction === 'outbound' ? 'out' : 'in', channel: 'maytapi', body: m.body || '' });
        maytapiByContact.set(cid, arr);
      });

      const composed: (Row & { _hasTwilio: boolean })[] = all
        .map((c) => {
          const twilio = twilioByContact.get(c.id) || [];
          const maytapi = maytapiByContact.get(c.id) || [];
          const thread = [...twilio, ...maytapi].sort((a, b) => a.ts.localeCompare(b.ts));
          const firstInbound = thread.find((m) => m.direction === 'in');
          const lastMsg = thread[thread.length - 1];
          return {
            ...c,
            _hasTwilio: twilio.length > 0,
            isDistributor: detectDistributor(c, thread),
            firstInquiry: firstInbound?.ts || c.created_at,
            lastMessage: lastMsg?.ts || null,
            thread,
            summary: null,
          };
        })
        .filter((r) => r._hasTwilio);

      const distributors = composed.filter((r) => r.isDistributor);
      const rest = composed
        .filter((r) => !r.isDistributor)
        .sort((a, b) => (b.lastMessage || b.updated_at).localeCompare(a.lastMessage || a.updated_at));

      const capRoom = Math.max(0, HARD_CAP - distributors.length);
      const selected = [...distributors, ...rest.slice(0, capRoom)];

      selected.sort((a, b) => {
        if (a.isDistributor !== b.isDistributor) return a.isDistributor ? -1 : 1;
        return (a.firstInquiry || '').localeCompare(b.firstInquiry || '');
      });

      // Load any cached summaries
      const selIds = selected.map((r) => r.id);
      if (selIds.length > 0) {
        const { data: cachedRows } = await supabase
          .from('lead_call_summaries')
          .select('contact_id, summary')
          .in('contact_id', selIds);
        const map = new Map<string, Summary>();
        ((cachedRows || []) as CachedSummaryRow[]).forEach((r) => map.set(r.contact_id, r.summary));
        selected.forEach((r) => { r.summary = map.get(r.id) || null; });
      }

      setRows(selected);
    } catch (e: unknown) {
      console.error('[LeadCallReport] load failed', e);
      toast.error('Failed to load report: ' + getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let out = onlyDistributors ? rows.filter((r) => r.isDistributor) : rows;
    if (fiFrom) out = out.filter((r) => r.firstInquiry && r.firstInquiry.slice(0, 10) >= fiFrom);
    if (fiTo) out = out.filter((r) => r.firstInquiry && r.firstInquiry.slice(0, 10) <= fiTo);
    if (lmFrom) out = out.filter((r) => r.lastMessage && r.lastMessage.slice(0, 10) >= lmFrom);
    if (lmTo) out = out.filter((r) => r.lastMessage && r.lastMessage.slice(0, 10) <= lmTo);
    return out;
  }, [rows, onlyDistributors, fiFrom, fiTo, lmFrom, lmTo]);

  const sortedFiltered = useMemo(() => {
    if (sortDir === 'none') return filtered;
    const dirMul = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'msgs') return (a.thread.length - b.thread.length) * dirMul;
      const av = (sortKey === 'firstInquiry' ? a.firstInquiry : a.lastMessage) || '';
      const bv = (sortKey === 'firstInquiry' ? b.firstInquiry : b.lastMessage) || '';
      return av.localeCompare(bv) * dirMul;
    });
  }, [filtered, sortKey, sortDir]);

  const distributorCount = rows.filter((r) => r.isDistributor).length;
  const missingSummaries = sortedFiltered.filter((r) => !r.summary).length;

  function toggleSort(key: SortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir('desc'); return; }
    setSortDir((d) => (d === 'none' ? 'desc' : d === 'desc' ? 'asc' : 'none'));
  }

  async function summarizeOne(row: Row, force = false): Promise<Summary | null> {
    try {
      const { data, error } = await supabase.functions.invoke('summarize-lead-conversation', {
        body: {
          contact_id: row.id,
          name: displayName(row),
          messages: row.thread,
          force,
        },
      });
      if (error) throw error;
      return (data?.summary as Summary) || null;
    } catch (e) {
      console.error('[summarize] failed for', row.id, e);
      return null;
    }
  }

  async function generateSummaries(missingOnly = true) {
    const targets = missingOnly ? sortedFiltered.filter((r) => !r.summary) : sortedFiltered;
    if (targets.length === 0) {
      toast.info('All summaries already generated.');
      return;
    }
    setSummarizing(true);
    setSummarizeProgress({ done: 0, total: targets.length });
    let done = 0;
    const concurrency = 4;
    let cursor = 0;
    const updated = new Map<string, Summary>();

    async function worker() {
      while (cursor < targets.length) {
        const idx = cursor++;
        const row = targets[idx];
        const s = await summarizeOne(row, !missingOnly);
        if (s) updated.set(row.id, s);
        done++;
        setSummarizeProgress({ done, total: targets.length });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));

    setRows((prev) => prev.map((r) => (updated.has(r.id) ? { ...r, summary: updated.get(r.id)! } : r)));
    setSummarizing(false);
    setSummarizeProgress(null);
    toast.success(`Summarized ${updated.size} of ${targets.length} leads.`);
  }

  async function generatePDF() {
    setGenerating(true);
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 36;
      const now = new Date();

      doc.setFont('helvetica', 'bold').setFontSize(18);
      doc.text('Vanto CRM — Lead Call Report', M, 50);
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110);
      doc.text(`Generated ${now.toLocaleString('en-ZA')}`, M, 68);
      doc.text(
        `Total: ${sortedFiltered.length}  ·  Distributors: ${sortedFiltered.filter((r) => r.isDistributor).length}  ·  Mode: ${compactPdf ? 'Compact (AI summaries)' : 'Full (raw messages)'}`,
        M, 82
      );
      doc.text('Sorted: ★ Distributors first, then oldest first-inquiry first.', M, 96);
      doc.setTextColor(0);

      autoTable(doc, {
        startY: 116,
        head: [['#', '★', 'Name', 'Phone', 'Type', 'First Inquiry', 'Last Msg', 'Msgs']],
        body: sortedFiltered.map((r, i) => [
          String(i + 1),
          r.isDistributor ? '★' : '',
          displayName(r).slice(0, 28),
          r.phone || r.phone_normalized || '—',
          r.lead_type || '—',
          fmtDate(r.firstInquiry),
          fmtDate(r.lastMessage),
          String(r.thread.length),
        ]),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        margin: { left: M, right: M },
      });

      if (compactPdf) {
        // Compact mode: ~3-4 leads per page, AI summary only.
        let y = H; // force new page on first
        sortedFiltered.forEach((r, i) => {
          const blockH = 175;
          if (y + blockH > H - M) { doc.addPage(); y = 50; }

          // Header line
          doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0);
          const head = `${i + 1}. ${r.isDistributor ? '★ ' : ''}${displayName(r)}`;
          doc.text(head, M, y);
          doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110);
          const meta = `${r.phone || r.phone_normalized || '—'}  ·  ${r.lead_type || '—'}  ·  Msgs: ${r.thread.length}  ·  First: ${fmtDate(r.firstInquiry)}  ·  Last: ${fmtDate(r.lastMessage)}`;
          doc.text(meta, M, y + 13);
          y += 28;
          doc.setTextColor(0);

          const s = r.summary;
          if (!s) {
            doc.setFont('helvetica', 'italic').setFontSize(9).setTextColor(140);
            doc.text('No AI summary yet — click "Generate summaries" to fill this in.', M, y);
            doc.setTextColor(0);
            y += 18;
          } else {
            doc.setFont('helvetica', 'bold').setFontSize(9);
            doc.text(`Interest: `, M, y);
            doc.setFont('helvetica', 'normal');
            const intent = doc.splitTextToSize(`${s.intent}  ·  Distributor interest: ${s.distributor_interest.toUpperCase()}`, W - 2 * M - 50);
            doc.text(intent, M + 50, y); y += intent.length * 11 + 2;

            doc.setFont('helvetica', 'bold'); doc.text('Discussion:', M, y);
            doc.setFont('helvetica', 'normal');
            const body = doc.splitTextToSize(s.summary_text, W - 2 * M - 70);
            doc.text(body, M + 70, y); y += body.length * 11 + 4;

            if (s.key_questions.length) {
              doc.setFont('helvetica', 'bold'); doc.text('Questions:', M, y);
              doc.setFont('helvetica', 'normal');
              const t = doc.splitTextToSize('• ' + s.key_questions.join('  • '), W - 2 * M - 70);
              doc.text(t, M + 70, y); y += t.length * 11 + 2;
            }
            if (s.open_items.length) {
              doc.setFont('helvetica', 'bold'); doc.text('Open / Next:', M, y);
              doc.setFont('helvetica', 'normal');
              const t = doc.splitTextToSize('• ' + s.open_items.join('  • '), W - 2 * M - 70);
              doc.text(t, M + 70, y); y += t.length * 11 + 2;
            }
            doc.setFont('helvetica', 'bold'); doc.text('Status:', M, y);
            doc.setFont('helvetica', 'normal');
            const st = doc.splitTextToSize(s.last_status, W - 2 * M - 70);
            doc.text(st, M + 70, y); y += st.length * 11 + 6;
          }

          // Divider
          doc.setDrawColor(220); doc.line(M, y, W - M, y);
          y += 14;
        });
      } else {
        // Full mode (legacy): per-contact details + raw thread.
        sortedFiltered.forEach((r, i) => {
          doc.addPage();
          let y = 50;
          doc.setFont('helvetica', 'bold').setFontSize(13);
          doc.text(`${i + 1}. ${r.isDistributor ? '★ ' : ''}${displayName(r)}`, M, y); y += 18;
          doc.setFont('helvetica', 'normal').setFontSize(10);
          const info: [string, string][] = [
            ['Phone', r.phone || r.phone_normalized || '—'],
            ['Email', r.email || '—'],
            ['Lead Type', r.lead_type || '—'],
            ['Temperature', r.temperature || '—'],
            ['Interest', r.interest || '—'],
            ['First Inquiry', fmtDate(r.firstInquiry)],
            ['Last Message', fmtDate(r.lastMessage)],
            ['Tags', (r.tags || []).join(', ') || '—'],
          ];
          info.forEach(([k, v]) => {
            doc.setTextColor(110); doc.text(k, M, y);
            doc.setTextColor(0); doc.text(String(v).slice(0, 90), M + 90, y);
            y += 13;
          });
          y += 10;
          doc.setFont('helvetica', 'bold').setFontSize(11);
          doc.text(`Conversation (${r.thread.length} messages)`, M, y); y += 14;
          doc.setFont('helvetica', 'normal').setFontSize(9);
          if (r.thread.length === 0) {
            doc.setTextColor(140); doc.text('No messages on record.', M, y); doc.setTextColor(0); y += 12;
          } else {
            for (const m of r.thread) {
              const label = `[${fmtDate(m.ts)}] ${m.direction === 'in' ? '◀ IN ' : '▶ OUT'} (${m.channel})`;
              doc.setTextColor(90); doc.text(label, M, y); y += 11;
              doc.setTextColor(0);
              const body = doc.splitTextToSize(m.body || '(empty)', W - 2 * M);
              doc.text(body, M, y); y += body.length * 11 + 4;
              if (y > H - 50) { doc.addPage(); y = 50; }
            }
          }
        });
      }

      const fname = `lead-call-report-${compactPdf ? 'compact-' : ''}${now.toISOString().slice(0, 10)}.pdf`;
      doc.save(fname);
      toast.success(`Downloaded ${fname}`);
    } catch (e: unknown) {
      console.error(e);
      toast.error('PDF generation failed');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
            <Phone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Lead Call Report</h2>
            <p className="text-xs text-muted-foreground">
              {loading
                ? 'Loading…'
                : `${sortedFiltered.length} of ${rows.length} contacts · ${distributorCount} distributors · ${sortedFiltered.length - missingSummaries}/${sortedFiltered.length} summarized · cap ${HARD_CAP}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={onlyDistributors} onCheckedChange={setOnlyDistributors} />
            Only distributors
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={compactPdf} onCheckedChange={setCompactPdf} />
            Compact PDF
          </label>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateSummaries(true)}
            disabled={summarizing || sortedFiltered.length === 0}
          >
            <Sparkles className={`h-4 w-4 mr-1 ${summarizing ? 'animate-pulse' : ''}`} />
            {summarizing && summarizeProgress
              ? `Summarizing ${summarizeProgress.done}/${summarizeProgress.total}…`
              : missingSummaries > 0
                ? `Generate summaries (${missingSummaries})`
                : 'Regenerate summaries'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button size="sm" onClick={generatePDF} disabled={generating || sortedFiltered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> {generating ? 'Generating…' : 'Download PDF'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">First Inquiry from</label>
          <input type="date" className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground" value={fiFrom} onChange={(e) => setFiFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">First Inquiry to</label>
          <input type="date" className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground" value={fiTo} onChange={(e) => setFiTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Last Msg from</label>
          <input type="date" className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground" value={lmFrom} onChange={(e) => setLmFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Last Msg to</label>
          <input type="date" className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground" value={lmTo} onChange={(e) => setLmTo(e.target.value)} />
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setFiFrom(''); setFiTo(''); setLmFrom(''); setLmTo(''); }}>
          Reset dates
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="w-8"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>
                <SortButton label="First Inquiry" active={sortKey === 'firstInquiry'} dir={sortDir} onClick={() => toggleSort('firstInquiry')} />
              </TableHead>
              <TableHead>
                <SortButton label="Last Msg" active={sortKey === 'lastMessage'} dir={sortDir} onClick={() => toggleSort('lastMessage')} />
              </TableHead>
              <TableHead className="min-w-[280px]">Summary</TableHead>
              <TableHead className="text-right">
                <SortButton label="Msgs" active={sortKey === 'msgs'} dir={sortDir} onClick={() => toggleSort('msgs')} align="right" />
              </TableHead>
              <TableHead className="w-20 text-right">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedFiltered.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  No contacts match the current filter.
                </TableCell>
              </TableRow>
            )}
            {sortedFiltered.map((r, i) => (
              <TableRow key={r.id}>
                <TableCell className="py-2 text-xs text-muted-foreground align-top">{i + 1}</TableCell>
                <TableCell className="py-2 align-top">
                  {r.isDistributor && <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />}
                </TableCell>
                <TableCell className="py-2 font-medium align-top">{displayName(r)}</TableCell>
                <TableCell className="py-2 text-xs align-top">{r.phone || r.phone_normalized || '—'}</TableCell>
                <TableCell className="py-2 text-xs align-top">{r.lead_type || '—'}</TableCell>
                <TableCell className="py-2 text-xs align-top">{fmtDate(r.firstInquiry)}</TableCell>
                <TableCell className="py-2 text-xs align-top">{fmtDate(r.lastMessage)}</TableCell>
                <TableCell className="py-2 text-xs align-top">
                  {r.summary ? (
                    <div className="space-y-1">
                      <div className="text-foreground">{r.summary.summary_text}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Distributor interest: <span className="uppercase">{r.summary.distributor_interest}</span>
                        {r.summary.open_items.length > 0 && <> · Next: {r.summary.open_items[0]}</>}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">Not summarized yet</span>
                  )}
                </TableCell>
                <TableCell className="py-2 text-xs text-right align-top">{r.thread.length}</TableCell>
                <TableCell className="py-2 text-right align-top">
                  <Button variant="ghost" size="sm" onClick={() => openEditor(r)} title="Edit lead type & notes — syncs to Contacts and CRM Pipeline">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editor ? `Edit — ${displayName(editor.row)}` : 'Edit contact'}
            </DialogTitle>
          </DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                {editor.row.phone || editor.row.phone_normalized || '—'} · saves to Contacts & CRM Pipeline
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Lead Type</label>
                <select
                  value={editor.lead_type}
                  onChange={(e) => setEditor({ ...editor, lead_type: e.target.value as LeadType })}
                  className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                >
                  {LEAD_TYPES.map((lt) => (
                    <option key={lt.value} value={lt.value}>{lt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Notes</label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={pasteSummaryToNotes}
                    disabled={!editor.row.summary}
                    title={editor.row.summary ? 'Append AI summary to notes' : 'Generate summary first'}
                  >
                    <ClipboardPaste className="h-3.5 w-3.5 mr-1" />
                    Paste AI summary
                  </Button>
                </div>
                <textarea
                  value={editor.notes}
                  onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
                  rows={10}
                  className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 resize-y font-mono"
                  placeholder="Notes for this contact…"
                />
              </div>

              {editor.row.summary && (
                <details className="text-xs text-muted-foreground bg-secondary/30 rounded-lg p-3">
                  <summary className="cursor-pointer text-foreground">AI summary preview</summary>
                  <pre className="whitespace-pre-wrap mt-2">{summaryAsText(editor.row.summary)}</pre>
                </details>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditor(null)} disabled={savingEdit}>Cancel</Button>
            <Button onClick={saveEditor} disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
