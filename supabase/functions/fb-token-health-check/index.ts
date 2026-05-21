// Daily FB Page Access Token health check.
// - Reads integration_settings.fb_page_token_set_at to compute days elapsed.
// - Calls Graph /me to verify the token is still alive.
// - Inserts a row into fb_token_alerts at days 50 (warning), 55 (urgent), 58+ (critical).
// - Inserts a 'dead' alert immediately if Graph /me fails.
// - Avoids duplicate alerts for the same severity within 24h.
// - Optionally fans out via send-admin-alert.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? '';
const GRAPH = 'https://graph.facebook.com/v19.0';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1. Read token-set date
  const { data: setting } = await supabase
    .from('integration_settings')
    .select('value, updated_at')
    .eq('key', 'fb_page_token_set_at')
    .maybeSingle();

  let setAt: Date | null = null;
  if (setting?.value) {
    const v = String(setting.value).trim();
    const parsed = new Date(v);
    if (!isNaN(parsed.getTime())) setAt = parsed;
  }
  if (!setAt && setting?.updated_at) setAt = new Date(setting.updated_at);

  const daysElapsed = setAt
    ? Math.floor((Date.now() - setAt.getTime()) / 86_400_000)
    : null;

  // 2. Probe Graph /me
  let graphOk = false;
  let graphError: string | null = null;
  if (PAGE_TOKEN) {
    try {
      const r = await fetch(`${GRAPH}/me?access_token=${PAGE_TOKEN}`);
      const d = await r.json();
      if (r.ok && d?.id) graphOk = true;
      else graphError = JSON.stringify(d?.error ?? d).slice(0, 400);
    } catch (e) {
      graphError = String(e).slice(0, 400);
    }
  } else {
    graphError = 'META_PAGE_ACCESS_TOKEN not configured';
  }

  // 3. Decide severity
  let severity: 'info' | 'warning' | 'urgent' | 'critical' | 'dead' | null = null;
  let message = '';

  if (!graphOk) {
    severity = 'dead';
    message = `Facebook Page token failed verification. Rotate immediately. Graph said: ${graphError ?? 'unknown error'}`;
  } else if (daysElapsed !== null) {
    if (daysElapsed >= 58) {
      severity = 'critical';
      message = `Facebook Page token is ${daysElapsed} days old. Rotate TODAY — it will expire any moment.`;
    } else if (daysElapsed >= 55) {
      severity = 'urgent';
      message = `Facebook Page token is ${daysElapsed} days old. Rotate this week.`;
    } else if (daysElapsed >= 50) {
      severity = 'warning';
      message = `Facebook Page token is ${daysElapsed} days old. Rotate within 10 days.`;
    }
  }

  let inserted = false;
  if (severity) {
    // De-dupe: skip if same severity alert raised in last 24h (or "dead" in last 6h)
    const dedupeWindowMs = severity === 'dead' || severity === 'critical' ? 6 * 3600_000 : 24 * 3600_000;
    const since = new Date(Date.now() - dedupeWindowMs).toISOString();
    const { data: recent } = await supabase
      .from('fb_token_alerts')
      .select('id')
      .eq('severity', severity)
      .eq('resolved', false)
      .gte('created_at', since)
      .maybeSingle();

    if (!recent) {
      await supabase.from('fb_token_alerts').insert({
        severity,
        days_elapsed: daysElapsed,
        message,
        graph_ok: graphOk,
      });
      inserted = true;

      // Best-effort admin WhatsApp ping. Don't fail the function if it errors.
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-admin-alert`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify({
            subject: `[FB Token ${severity.toUpperCase()}]`,
            body: message,
          }),
        });
      } catch (e) {
        console.warn('[fb-token-health-check] admin alert dispatch failed', e);
      }
    }
  } else if (graphOk) {
    // Healthy → auto-resolve outstanding warning/urgent alerts (keep history)
    await supabase
      .from('fb_token_alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('resolved', false)
      .in('severity', ['warning', 'urgent', 'critical', 'dead']);
  }

  return json({
    ok: true,
    days_elapsed: daysElapsed,
    graph_ok: graphOk,
    graph_error: graphError,
    severity,
    alert_inserted: inserted,
    token_set_at: setAt?.toISOString() ?? null,
  });
});
