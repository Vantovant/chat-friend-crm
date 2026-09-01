/**
 * Vanto CRM — group-data-quality-snapshot
 * Computes a daily data-quality snapshot for the APLGO | Health and Biz WhatsApp group:
 * total members, how many are matched to a CRM contact, and among those how many have a
 * real name vs a placeholder name.
 *
 * READ-ONLY with respect to WhatsApp: never sends anything. Only reads group/contact data
 * and upserts into group_data_quality_snapshots.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROUP_JID = '120363419298058298@g.us';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Same heuristic as maytapi-webhook-inbound, kept consistent on purpose.
function isPlaceholderName(n: string | null | undefined): boolean {
  if (!n) return true;
  const s = String(n).trim();
  if (!s) return true;
  if (/^\+?\d[\d\s\-().]{4,}$/.test(s)) return true;
  if (s.toLowerCase() === 'unknown') return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    let groupJid = GROUP_JID;
    try {
      const body = await req.json();
      if (body?.group_jid) groupJid = String(body.group_jid);
    } catch { /* no body */ }

    const { data: members, error: mErr } = await supabase
      .from('whatsapp_group_members')
      .select('id, contact_id')
      .eq('group_jid', groupJid)
      .limit(5000);
    if (mErr) throw mErr;

    const rows = members || [];
    const total = rows.length;
    const contactIds = Array.from(
      new Set(rows.map((r: any) => r.contact_id).filter(Boolean)),
    ) as string[];
    const matched = rows.filter((r: any) => !!r.contact_id).length;

    let realNames = 0;
    let placeholderNames = 0;
    const nameById = new Map<string, string | null>();
    for (let i = 0; i < contactIds.length; i += 500) {
      const slice = contactIds.slice(i, i + 500);
      const { data: contacts, error: cErr } = await supabase
        .from('contacts')
        .select('id, name')
        .in('id', slice);
      if (cErr) throw cErr;
      (contacts || []).forEach((c: any) => nameById.set(c.id, c.name));
    }
    for (const r of rows as any[]) {
      if (!r.contact_id) continue;
      if (isPlaceholderName(nameById.get(r.contact_id))) placeholderNames++;
      else realNames++;
    }

    const snapshotDate = new Date().toISOString().slice(0, 10);
    const { data: saved, error: sErr } = await supabase
      .from('group_data_quality_snapshots')
      .upsert(
        {
          group_jid: groupJid,
          snapshot_date: snapshotDate,
          total_members: total,
          matched_members: matched,
          real_name_count: realNames,
          placeholder_name_count: placeholderNames,
        },
        { onConflict: 'group_jid,snapshot_date' },
      )
      .select()
      .single();
    if (sErr) throw sErr;

    return jsonRes({ ok: true, snapshot: saved });
  } catch (e) {
    console.error('[group-data-quality-snapshot] error', e);
    return jsonRes({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
