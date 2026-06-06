import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Printer, RefreshCw, Star, Phone } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';

// Tight, word-boundary distributor intent keywords. Avoid generic words like
// "business" or "join" that match casual replies and inflate the flag.
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
  created_at: string;
  updated_at: string;
};

type ThreadMsg = {
  ts: string;
  direction: 'in' | 'out';
  channel: 'twilio' | 'maytapi';
  body: string;
};

type Row = Contact & {
  isDistributor: boolean;
  firstInquiry: string | null;
  lastMessage: string | null;
  thread: ThreadMsg[];
};

type MessageSort = 'none' | 'asc' | 'desc';

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

export function LeadCallReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [onlyDistributors, setOnlyDistributors] = useState(false);
  const [messageSort, setMessageSort] = useState<MessageSort>('none');
  const [generating, setGenerating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      // Pull contacts (most recently updated first, broad sweep)
      const { data: contacts, error: cErr } = await supabase
        .from('contacts')
        .select('id, name, first_name, last_name, phone, phone_normalized, email, lead_type, temperature, interest, tags, notes, created_at, updated_at')
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (cErr) throw cErr;
      const all = (contacts || []) as Contact[];
      if (all.length === 0) {
        setRows([]);
        return;
      }

      const ids = all.map((c) => c.id);
      const phones = all.map((c) => c.phone_normalized).filter(Boolean) as string[];

      // Conversations for these contacts (to get message thread)
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, contact_id')
        .in('contact_id', ids);
      const convIdToContact = new Map<string, string>();
      const convIds: string[] = [];
      (convs || []).forEach((c: any) => {
        convIdToContact.set(c.id, c.contact_id);
        convIds.push(c.id);
      });

      // Twilio messages
      const twilioByContact = new Map<string, ThreadMsg[]>();
      if (convIds.length > 0) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('conversation_id, content, is_outbound, created_at')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: true })
          .limit(5000);
        (msgs || []).forEach((m: any) => {
          const cid = convIdToContact.get(m.conversation_id);
          if (!cid) return;
          const arr = twilioByContact.get(cid) || [];
          arr.push({
            ts: m.created_at,
            direction: m.is_outbound ? 'out' : 'in',
            channel: 'twilio',
            body: m.content || '',
          });
          twilioByContact.set(cid, arr);
        });
      }

      // Maytapi messages — match by contact_id OR phone_e164
      const maytapiByContact = new Map<string, ThreadMsg[]>();
      const { data: mMsgs } = await supabase
        .from('maytapi_messages')
        .select('contact_id, phone_e164, direction, body, received_at')
        .or(`contact_id.in.(${ids.join(',')}),phone_e164.in.(${phones.map((p) => `"${p}"`).join(',') || '""'})`)
        .order('received_at', { ascending: true })
        .limit(5000);
      const phoneToContact = new Map<string, string>();
      all.forEach((c) => { if (c.phone_normalized) phoneToContact.set(c.phone_normalized, c.id); });
      (mMsgs || []).forEach((m: any) => {
        const cid = m.contact_id || (m.phone_e164 ? phoneToContact.get(m.phone_e164) : null);
        if (!cid) return;
        const arr = maytapiByContact.get(cid) || [];
        arr.push({
          ts: m.received_at,
          direction: m.direction === 'outbound' ? 'out' : 'in',
          channel: 'maytapi',
          body: m.body || '',
        });
        maytapiByContact.set(cid, arr);
      });

      // Compose rows — restrict to contacts who first appeared via Twilio inbox
      // (then their Maytapi messages get merged into the same thread).
      const composed: Row[] = all
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
          } as Row & { _hasTwilio: boolean };
        })
        .filter((r) => r._hasTwilio);

      // Selection: distributors first (always), then fill by last activity desc up to HARD_CAP
      const distributors = composed.filter((r) => r.isDistributor);
      const rest = composed
        .filter((r) => !r.isDistributor)
        .sort((a, b) => (b.lastMessage || b.updated_at).localeCompare(a.lastMessage || a.updated_at));

      const capRoom = Math.max(0, HARD_CAP - distributors.length);
      const selected = [...distributors, ...rest.slice(0, capRoom)];

      // Final sort for display: distributors first, then by first inquiry ascending (oldest waiting first)
      selected.sort((a, b) => {
        if (a.isDistributor !== b.isDistributor) return a.isDistributor ? -1 : 1;
        return (a.firstInquiry || '').localeCompare(b.firstInquiry || '');
      });

      setRows(selected);
    } catch (e: any) {
      console.error('[LeadCallReport] load failed', e);
      toast.error('Failed to load report: ' + (e?.message || 'unknown'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => (onlyDistributors ? rows.filter((r) => r.isDistributor) : rows),
    [rows, onlyDistributors]
  );

  const sortedFiltered = useMemo(() => {
    if (messageSort === 'none') return filtered;
    return [...filtered].sort((a, b) =>
      messageSort === 'desc' ? b.thread.length - a.thread.length : a.thread.length - b.thread.length
    );
  }, [filtered, messageSort]);

  const distributorCount = rows.filter((r) => r.isDistributor).length;

  function toggleMessageSort() {
    setMessageSort((current) => (current === 'none' ? 'desc' : current === 'desc' ? 'asc' : 'none'));
  }

  async function generatePDF() {
    setGenerating(true);
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const M = 36;
      const now = new Date();

      // Cover
      doc.setFont('helvetica', 'bold').setFontSize(18);
      doc.text('Vanto CRM — Lead Call Report', M, 50);
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110);
      doc.text(`Generated ${now.toLocaleString('en-ZA')}`, M, 68);
      doc.text(`Total contacts: ${sortedFiltered.length}  ·  Distributors: ${sortedFiltered.filter((r) => r.isDistributor).length}`, M, 82);
      doc.text('Sorted: ★ Distributors first, then oldest first-inquiry first.', M, 96);
      doc.setTextColor(0);

      // Summary table
      autoTable(doc, {
        startY: 116,
        head: [['#', '★', 'Name', 'Phone', 'Type', 'Temp', 'First Inquiry', 'Last Msg']],
        body: sortedFiltered.map((r, i) => [
          String(i + 1),
          r.isDistributor ? '★' : '',
          displayName(r).slice(0, 28),
          r.phone || r.phone_normalized || '—',
          r.lead_type || '—',
          r.temperature || '—',
          fmtDate(r.firstInquiry),
          fmtDate(r.lastMessage),
        ]),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        margin: { left: M, right: M },
      });

      // Per-contact details
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
        if (r.notes) {
          y += 4;
          doc.setTextColor(110); doc.text('Notes', M, y);
          doc.setTextColor(0);
          const lines = doc.splitTextToSize(r.notes, W - 2 * M - 90);
          doc.text(lines, M + 90, y); y += lines.length * 12;
        }

        // Thread
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
            if (y > 780) { doc.addPage(); y = 50; }
          }
        }
      });

      const fname = `lead-call-report-${now.toISOString().slice(0, 10)}.pdf`;
      doc.save(fname);
      toast.success(`Downloaded ${fname}`);
    } catch (e: any) {
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
              {loading ? 'Loading…' : `${sortedFiltered.length} of ${rows.length} contacts · ${distributorCount} distributors · cap ${HARD_CAP}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={onlyDistributors} onCheckedChange={setOnlyDistributors} />
            Only distributors
          </label>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button size="sm" onClick={generatePDF} disabled={generating || sortedFiltered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> {generating ? 'Generating…' : 'Download PDF'}
          </Button>
        </div>
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
              <TableHead>Temp</TableHead>
              <TableHead>First Inquiry</TableHead>
              <TableHead>Last Msg</TableHead>
              <TableHead className="text-right">
                <button
                  type="button"
                  onClick={toggleMessageSort}
                  className="ml-auto inline-flex items-center justify-end gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Sort by message count"
                >
                  Msgs
                  {messageSort === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : messageSort === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5" />}
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedFiltered.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No contacts match the current filter.
                </TableCell>
              </TableRow>
            )}
            {sortedFiltered.map((r, i) => (
              <TableRow key={r.id}>
                <TableCell className="py-2 text-xs text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="py-2">
                  {r.isDistributor && <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />}
                </TableCell>
                <TableCell className="py-2 font-medium">{displayName(r)}</TableCell>
                <TableCell className="py-2 text-xs">{r.phone || r.phone_normalized || '—'}</TableCell>
                <TableCell className="py-2 text-xs">{r.lead_type || '—'}</TableCell>
                <TableCell className="py-2 text-xs capitalize">{r.temperature || '—'}</TableCell>
                <TableCell className="py-2 text-xs">{fmtDate(r.firstInquiry)}</TableCell>
                <TableCell className="py-2 text-xs">{fmtDate(r.lastMessage)}</TableCell>
                <TableCell className="py-2 text-xs text-right">{r.thread.length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
