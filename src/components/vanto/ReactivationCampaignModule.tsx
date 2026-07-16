import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { Loader2, Send, RefreshCw, Pause, Play, Upload, Users, MessageSquare, GraduationCap } from 'lucide-react';

interface Recipient {
  id: string;
  member_id: string | null;
  name: string;
  first_name: string | null;
  phone_normalized: string;
  rank: string | null;
  expired_on: string | null;
  batch_label: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  reply_preview: string | null;
  error: string | null;
  attempts: number;
  contact_id: string | null;
  graduated_at: string | null;
}

interface Reply {
  id: string;
  recipient_id: string;
  phone_normalized: string;
  body: string;
  received_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  executing: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  sent: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  delivered: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
  read: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  replied: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  failed: 'bg-red-500/20 text-red-300 border-red-500/40',
};

// Normalize phone to +E164, default ZA (+27), min 11 digits
function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('0')) s = '+27' + s.slice(1); // ZA default
  if (!s.startsWith('+')) {
    if (s.startsWith('27') || s.startsWith('1') || s.startsWith('44')) s = '+' + s;
    else s = '+27' + s;
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return s;
}

interface ParsedRow {
  name: string;
  phone_normalized: string;
  rank?: string;
  expired_on?: string;
  member_id?: string;
  _raw_phone?: string;
  _dup?: boolean;
  _invalid?: boolean;
}

export function ReactivationCampaignModule() {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);

  const load = async () => {
    setLoading(true);
    const [recRes, repRes, killRes] = await Promise.all([
      supabase.from('reactivation_campaign_recipients').select('*').order('created_at', { ascending: true }),
      supabase.from('reactivation_campaign_replies').select('*').order('received_at', { ascending: false }).limit(500),
      supabase.from('integration_settings').select('value').eq('key', 'reactivation_campaign_enabled').maybeSingle(),
    ]);
    setRows((recRes.data as any) || []);
    setReplies((repRes.data as any) || []);
    setEnabled(String(killRes.data?.value || 'true').toLowerCase() === 'true');
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel('reactivation-campaign')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactivation_campaign_recipients' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactivation_campaign_replies' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const toggleEnabled = async (next: boolean) => {
    setEnabled(next);
    await supabase.from('integration_settings').upsert(
      { key: 'reactivation_campaign_enabled', value: next ? 'true' : 'false' },
      { onConflict: 'key' },
    );
    toast({ title: next ? 'Campaign resumed' : 'Campaign paused' });
  };

  const sendOne = async (id: string) => {
    setBusy(id);
    try {
      const { data, error } = await supabase.functions.invoke('reactivation-campaign-tick', {
        body: { cap: 1, force_ids: [id] },
      });
      if (error) throw error;
      const r = (data as any)?.results?.[0];
      if (r?.ok) toast({ title: 'Sent', description: r.message_id || 'ok' });
      else toast({ title: 'Send failed', description: r?.error || 'unknown', variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setBusy(null); load(); }
  };

  const requeue = async (id: string) => {
    await supabase.from('reactivation_campaign_recipients').update({ status: 'queued', error: null }).eq('id', id);
    load();
  };

  const graduate = async (r: Recipient) => {
    if (!confirm(`Add ${r.name} to main Contacts as a Customer?\n\nUse only if they have actually reactivated. Their inbound replies will then flow into the normal Inbox.`)) return;
    setBusy(r.id);
    try {
      // Check duplicate
      const { data: existing } = await supabase.from('contacts')
        .select('id').eq('phone_normalized', r.phone_normalized).eq('is_deleted', false).maybeSingle();
      let contactId = existing?.id;
      if (!contactId) {
        const { data: nc, error: ce } = await supabase.from('contacts').insert({
          name: r.name,
          first_name: r.first_name || (r.name?.split(/\s+/)[0] ?? null),
          phone: r.phone_normalized,
          phone_normalized: r.phone_normalized,
          phone_raw: r.phone_normalized,
          whatsapp_id: r.phone_normalized,
          lead_type: 'Purchase_Status',
          interest: 'high',
          temperature: 'hot',
          notes: `Graduated from July 2026 Reactivation Campaign${r.rank ? ` · Rank: ${r.rank}` : ''}`,
        } as any).select('id').single();
        if (ce) throw ce;
        contactId = nc!.id;
      }
      await supabase.from('reactivation_campaign_recipients').update({
        contact_id: contactId, graduated_at: new Date().toISOString(),
      }).eq('id', r.id);
      toast({ title: 'Graduated to Contacts', description: r.name });
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    } finally { setBusy(null); load(); }
  };

  const counts = rows.reduce((acc: Record<string, number>, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const fmt = (t: string | null) => (t ? new Date(t).toLocaleString('en-ZA', { hour12: false }) : '—');

  const repliesByRecipient = useMemo(() => {
    const m = new Map<string, Reply[]>();
    for (const r of replies) {
      const arr = m.get(r.recipient_id) || [];
      arr.push(r);
      m.set(r.recipient_id, arr);
    }
    return m;
  }, [replies]);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">July Reactivation (Expired Members)</h1>
          <p className="text-sm text-muted-foreground">
            Isolated pipeline · does NOT touch main Contacts · Maytapi 1-on-1 · 8 sends/day @ 10:00–11:00 SAST
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            {enabled ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4 text-amber-400" />}
            <span>{enabled ? 'Auto-send ON' : 'PAUSED'}</span>
            <Switch checked={enabled} onCheckedChange={toggleEnabled} />
          </div>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        {['total', 'queued', 'sent', 'delivered', 'read', 'replied', 'failed'].map((k) => {
          const val = k === 'total' ? rows.length : counts[k] || 0;
          return (
            <Card key={k} className="p-3 text-center">
              <div className="text-xs uppercase text-muted-foreground">{k}</div>
              <div className="text-2xl font-bold">{val}</div>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="recipients">
        <TabsList>
          <TabsTrigger value="recipients"><Users className="w-4 h-4 mr-1" />Recipients</TabsTrigger>
          <TabsTrigger value="import"><Upload className="w-4 h-4 mr-1" />Import</TabsTrigger>
          <TabsTrigger value="replies"><MessageSquare className="w-4 h-4 mr-1" />Replies ({replies.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="recipients">
          <Card className="overflow-hidden">
            {loading ? (
              <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="p-2">Name</th>
                      <th className="p-2">Phone</th>
                      <th className="p-2">Rank</th>
                      <th className="p-2">Expired</th>
                      <th className="p-2">Batch</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Sent</th>
                      <th className="p-2">Delivered</th>
                      <th className="p-2">Read</th>
                      <th className="p-2">Reply</th>
                      <th className="p-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                        <td className="p-2 font-medium">
                          {r.name}
                          {r.graduated_at && <Badge variant="outline" className="ml-1 bg-purple-500/20 text-purple-300 border-purple-500/40 text-[10px]">Graduated</Badge>}
                        </td>
                        <td className="p-2 font-mono text-xs">{r.phone_normalized}</td>
                        <td className="p-2 text-xs">{r.rank}</td>
                        <td className="p-2 text-xs">{r.expired_on}</td>
                        <td className="p-2 text-xs">{r.batch_label || '—'}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={STATUS_STYLES[r.status] || ''}>{r.status}</Badge>
                          {r.error && <div className="text-xs text-red-400 mt-1 max-w-[200px] truncate" title={r.error}>{r.error}</div>}
                        </td>
                        <td className="p-2 text-xs">{fmt(r.sent_at)}</td>
                        <td className="p-2 text-xs">{fmt(r.delivered_at)}</td>
                        <td className="p-2 text-xs">{fmt(r.read_at)}</td>
                        <td className="p-2 text-xs max-w-[200px] truncate" title={r.reply_preview || ''}>{r.reply_preview || '—'}</td>
                        <td className="p-2 space-x-1 whitespace-nowrap">
                          {(r.status === 'queued' || r.status === 'failed') && (
                            <Button size="sm" onClick={() => sendOne(r.id)} disabled={busy === r.id}>
                              {busy === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Send className="w-3 h-3 mr-1" />Send</>}
                            </Button>
                          )}
                          {['sent', 'delivered', 'read', 'replied'].includes(r.status) && (
                            <Button size="sm" variant="ghost" onClick={() => requeue(r.id)}>Resend</Button>
                          )}
                          {!r.contact_id && (
                            <Button size="sm" variant="outline" onClick={() => graduate(r)} disabled={busy === r.id} title="Add to Contacts as Customer (only if they reactivated)">
                              <GraduationCap className="w-3 h-3 mr-1" />Graduate
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="import"><ImportPanel onDone={load} existingPhones={rows.map(r => r.phone_normalized)} /></TabsContent>

        <TabsContent value="replies">
          <Card className="p-4 space-y-3">
            {replies.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No replies yet. Replies from expired members stay here (not the main Inbox) so they never become prospects.</p>
            ) : (
              Array.from(repliesByRecipient.entries()).map(([recipientId, msgs]) => {
                const recipient = rows.find(r => r.id === recipientId);
                return (
                  <Card key={recipientId} className="p-3 space-y-2 border-l-4 border-l-amber-500/60">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{recipient?.name || 'Unknown'} <span className="text-xs text-muted-foreground font-mono ml-2">{recipient?.phone_normalized}</span></div>
                        <div className="text-xs text-muted-foreground">{recipient?.batch_label ? `Batch: ${recipient.batch_label}` : ''}</div>
                      </div>
                      {recipient && !recipient.contact_id && (
                        <Button size="sm" variant="outline" onClick={() => graduate(recipient)} disabled={busy === recipient.id}>
                          <GraduationCap className="w-3 h-3 mr-1" />Graduate to Contacts
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {msgs.map(m => (
                        <div key={m.id} className="text-sm bg-muted/30 rounded p-2">
                          <div className="text-xs text-muted-foreground mb-1">{fmt(m.received_at)}</div>
                          <div className="whitespace-pre-wrap">{m.body}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ImportPanel({ onDone, existingPhones }: { onDone: () => void; existingPhones: string[] }) {
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [batchLabel, setBatchLabel] = useState(`Batch ${new Date().toISOString().slice(0, 10)}`);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const existingSet = useMemo(() => new Set(existingPhones), [existingPhones]);

  const processRows = (raw: Array<Record<string, any>>): ParsedRow[] => {
    return raw.map((row) => {
      const lower: Record<string, any> = {};
      for (const k of Object.keys(row)) lower[k.toLowerCase().trim()] = row[k];
      const name = String(
        lower.name || lower['full name'] || lower.fullname ||
        [lower['first name'], lower['last name']].filter(Boolean).join(' ') ||
        lower.member || lower.contact || ''
      ).trim();
      const rawPhone = String(
        lower.e164 || lower.phone || lower.mobile || lower.cell || lower.whatsapp || lower['phone number'] || ''
      ).trim();
      const phone = normalizePhone(rawPhone);
      const rank = lower.rank ? String(lower.rank).trim() : undefined;
      const expired = lower['expiry'] || lower['expired'] || lower['expired on'] || lower['expiry date'] || lower.expired_on;
      let expired_on: string | undefined;
      if (expired) {
        const d = expired instanceof Date ? expired : new Date(expired);
        if (!isNaN(d.getTime())) expired_on = d.toISOString().slice(0, 10);
      }
      const member_id = lower.id || lower['member id'] || lower.member_id;
      return {
        name: name || 'Unknown',
        phone_normalized: phone || '',
        rank, expired_on,
        member_id: member_id ? String(member_id) : undefined,
        _raw_phone: rawPhone,
        _invalid: !phone,
        _dup: !!phone && existingSet.has(phone),
      } as ParsedRow;
    });
  };

  const handleFile = async (f: File) => {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
    setParsed(processRows(raw));
  };

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    const lines = pasteText.trim().split(/\r?\n/).filter(Boolean);
    // Detect delimiter
    const first = lines[0];
    const delim = first.includes('\t') ? '\t' : first.includes(',') ? ',' : /\s{2,}/;
    const hasHeader = /name|phone|e164|mobile|rank/i.test(first);
    let headers: string[];
    let dataLines: string[];
    if (hasHeader) {
      headers = first.split(delim as any).map(s => s.trim());
      dataLines = lines.slice(1);
    } else {
      headers = ['name', 'phone'];
      dataLines = lines;
    }
    const raw = dataLines.map(line => {
      const cells = line.split(delim as any).map(s => s.trim());
      const obj: Record<string, any> = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
      return obj;
    });
    setParsed(processRows(raw));
  };

  const commit = async () => {
    const valid = parsed.filter(p => !p._invalid && !p._dup);
    if (!valid.length) { toast({ title: 'Nothing to import', variant: 'destructive' }); return; }
    setBusy(true);
    const payload = valid.map(v => ({
      name: v.name,
      first_name: v.name.split(/\s+/)[0] || null,
      phone_normalized: v.phone_normalized,
      rank: v.rank || null,
      expired_on: v.expired_on || null,
      member_id: v.member_id || null,
      batch_label: batchLabel || null,
      status: 'queued',
    }));
    const { error } = await supabase.from('reactivation_campaign_recipients').insert(payload as any);
    setBusy(false);
    if (error) { toast({ title: 'Import failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Imported', description: `${valid.length} recipient(s) queued in batch "${batchLabel}"` });
    setParsed([]); setPasteText('');
    onDone();
  };

  const validCount = parsed.filter(p => !p._invalid && !p._dup).length;
  const dupCount = parsed.filter(p => p._dup).length;
  const invalidCount = parsed.filter(p => p._invalid).length;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div className="text-sm text-muted-foreground bg-amber-500/10 border border-amber-500/30 rounded p-3">
          <strong>Isolated import:</strong> These people go into the reactivation queue only. They will <em>not</em> appear in main Contacts and their WhatsApp replies will land in the "Replies" tab here (not the main Inbox), so no auto-prospect classification or cadence.
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Upload .xlsx / .csv</label>
            <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <p className="text-xs text-muted-foreground">Recognized columns: Name, Phone / E164 / Mobile, Rank, Expiry / Expired On, ID</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Or paste rows (CSV / TSV)</label>
            <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4} placeholder={'Name, Phone, Rank\nJane Doe, 0821234567, Silver'} />
            <Button size="sm" variant="outline" onClick={handlePaste}>Parse pasted text</Button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Batch label</label>
          <Input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} placeholder="e.g. July batch 2" />
        </div>
      </Card>

      {parsed.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-3 text-sm">
              <span className="text-emerald-400">✓ {validCount} valid</span>
              <span className="text-amber-400">↻ {dupCount} duplicate</span>
              <span className="text-red-400">✗ {invalidCount} invalid</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setParsed([])}>Clear</Button>
              <Button size="sm" onClick={commit} disabled={busy || validCount === 0}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
                Commit {validCount} to queue
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 sticky top-0">
                <tr className="text-left"><th className="p-2">Status</th><th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Rank</th><th className="p-2">Expired</th></tr>
              </thead>
              <tbody>
                {parsed.map((p, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="p-2">
                      {p._invalid ? <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/40">Invalid phone</Badge>
                        : p._dup ? <Badge variant="outline" className="bg-amber-500/20 text-amber-300 border-amber-500/40">Duplicate</Badge>
                        : <Badge variant="outline" className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">Valid</Badge>}
                    </td>
                    <td className="p-2">{p.name}</td>
                    <td className="p-2 font-mono text-xs">{p.phone_normalized || <span className="text-red-400">{p._raw_phone}</span>}</td>
                    <td className="p-2 text-xs">{p.rank || '—'}</td>
                    <td className="p-2 text-xs">{p.expired_on || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
