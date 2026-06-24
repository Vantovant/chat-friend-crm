// Hot-Lead Escalation — Week 1 of Conversion Uplift roadmap.
// Notifies Vanto (admin phone) when intent classifier v2 flags a hot lead.
// Uses existing send-admin-alert (24h WA window → SMS → email cascade).
// Dedup: 1 alert per contact per N minutes. Hard daily cap from settings.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function inQuietHours(): boolean {
  // SAST = UTC+2
  const sastHour = (new Date().getUTCHours() + 2) % 24;
  return sastHour >= 20 || sastHour < 6;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: {
    contact_id?: string;
    conversation_id?: string;
    phone?: string;
    intent?: string;
    temperature_score?: number;
    signals?: string[];
    message_snippet?: string;
  } = {};
  try { body = await req.json(); } catch { /* noop */ }

  if (!body.contact_id || !body.intent || typeof body.temperature_score !== 'number') {
    return json({ ok: false, code: 'BAD_INPUT' }, 400);
  }

  // Settings
  const { data: settings } = await sb
    .from('integration_settings')
    .select('key,value')
    .in('key', [
      'zazi_hot_lead_alerts_enabled',
      'zazi_hot_lead_min_score',
      'zazi_hot_lead_dedup_minutes',
      'zazi_hot_lead_daily_cap',
    ]);
  const map: Record<string, string> = {};
  (settings || []).forEach((s: any) => { map[s.key] = s.value; });

  if ((map['zazi_hot_lead_alerts_enabled'] || 'true').toLowerCase() !== 'true') {
    return json({ ok: false, code: 'DISABLED' });
  }
  const minScore = parseInt(map['zazi_hot_lead_min_score'] || '75', 10);
  const dedupMin = parseInt(map['zazi_hot_lead_dedup_minutes'] || '360', 10);
  const dailyCap = parseInt(map['zazi_hot_lead_daily_cap'] || '20', 10);

  const explicitlyHot = ['buy_now', 'join_business', 'registration_help'].includes(body.intent);
  if (!explicitlyHot && body.temperature_score < minScore) {
    return json({ ok: false, code: 'BELOW_THRESHOLD', score: body.temperature_score, min: minScore });
  }

  // Quiet hours — record but don't send live alert (intent log still kept)
  const quiet = inQuietHours();

  // Dedup
  const since = new Date(Date.now() - dedupMin * 60_000).toISOString();
  const { data: recent } = await sb
    .from('hot_lead_alerts')
    .select('id, created_at')
    .eq('contact_id', body.contact_id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (recent && recent.length > 0) {
    await sb.from('hot_lead_alerts').insert({
      contact_id: body.contact_id,
      conversation_id: body.conversation_id || null,
      phone_normalized: body.phone || null,
      primary_intent: body.intent,
      temperature_score: body.temperature_score,
      signals: body.signals || [],
      message_snippet: body.message_snippet || null,
      alert_status: 'deduped',
      deduped_against: recent[0].id,
    });
    return json({ ok: true, status: 'deduped', against: recent[0].id });
  }

  // Daily cap
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const { count: todayCount } = await sb
    .from('hot_lead_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('alert_status', 'sent')
    .gte('created_at', startOfDay.toISOString());
  if ((todayCount || 0) >= dailyCap) {
    await sb.from('hot_lead_alerts').insert({
      contact_id: body.contact_id,
      conversation_id: body.conversation_id || null,
      phone_normalized: body.phone || null,
      primary_intent: body.intent,
      temperature_score: body.temperature_score,
      signals: body.signals || [],
      message_snippet: body.message_snippet || null,
      alert_status: 'cap_reached',
    });
    return json({ ok: false, status: 'cap_reached', cap: dailyCap });
  }

  // Resolve contact name for the alert
  const { data: contact } = await sb
    .from('contacts')
    .select('id, name, first_name, phone_normalized, lead_type')
    .eq('id', body.contact_id)
    .maybeSingle();

  const displayName = contact?.first_name || contact?.name || 'Unknown';
  const phoneDisplay = contact?.phone_normalized || body.phone || '—';
  const intentPretty = body.intent.replace(/_/g, ' ').toUpperCase();
  const alertText =
    `🔥 HOT LEAD (${body.temperature_score}/100)\n` +
    `${displayName} · ${phoneDisplay}\n` +
    `Intent: ${intentPretty}\n` +
    `Signals: ${(body.signals || []).slice(0, 4).join(', ') || 'n/a'}\n` +
    `Msg: "${(body.message_snippet || '').slice(0, 140)}"\n` +
    `Open inbox to reply now.`;

  let alertResp: any = { ok: false, code: 'QUIET_HOURS' };
  if (!quiet) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-admin-alert`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          'apikey': Deno.env.get('SUPABASE_ANON_KEY') || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: alertText }),
      });
      alertResp = await res.json();
    } catch (e: any) {
      alertResp = { ok: false, error: e?.message };
    }
  }

  const status = quiet ? 'queued_quiet_hours' : (alertResp?.ok ? 'sent' : 'failed');
  await sb.from('hot_lead_alerts').insert({
    contact_id: body.contact_id,
    conversation_id: body.conversation_id || null,
    phone_normalized: body.phone || contact?.phone_normalized || null,
    primary_intent: body.intent,
    temperature_score: body.temperature_score,
    signals: body.signals || [],
    message_snippet: body.message_snippet || null,
    alert_status: status,
    alert_channel: alertResp?.mode || (quiet ? 'suppressed' : null),
    alert_sid: alertResp?.sid || null,
    alert_error: alertResp?.ok ? null : (alertResp?.code || alertResp?.error_message || alertResp?.error || null),
  });

  return json({ ok: true, status, alert: alertResp });
});
