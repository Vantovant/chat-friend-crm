// Admin alert sender — freeform inside 24h window, template fallback outside.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FREEFORM_WINDOW_MS = 24 * 60 * 60 * 1000;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeE164(raw: string): string {
  let cleaned = (raw || '').replace(/^whatsapp:/i, '').trim().replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  const d = cleaned.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) return '+27' + d.slice(1);
  if (d.startsWith('27') && (d.length === 11 || d.length === 12)) return '+' + d;
  return cleaned.startsWith('+') ? cleaned : '+' + d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
  const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return jsonRes({ ok: false, code: 'MISSING_TWILIO_ENV', message: 'Twilio credentials missing' }, 500);
  }

  let body: { message?: string; to?: string } = {};
  try { body = await req.json(); } catch { /* empty body allowed */ }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Load settings
  const { data: settings } = await sb
    .from('integration_settings')
    .select('key,value')
    .in('key', [
      'zazi_admin_alert_phone_live',
      'zazi_group_reply_notify_phone',
      'zazi_admin_alert_template_content_sid',
      'zazi_admin_alert_template_status',
    ]);

  const settingMap: Record<string, string> = {};
  (settings || []).forEach((s: any) => { settingMap[s.key] = s.value; });

  if (settingMap['zazi_admin_alert_phone_live'] !== 'true') {
    return jsonRes({ ok: false, code: 'NOT_LIVE', message: 'Phone alerts not marked live' }, 400);
  }

  const toE164 = normalizeE164(body.to || settingMap['zazi_group_reply_notify_phone'] || '');
  if (!toE164) return jsonRes({ ok: false, code: 'NO_RECIPIENT', message: 'No admin phone configured' }, 400);

  const alertText = (body.message || 'New event in your CRM.').slice(0, 300);

  // Determine if we are inside the 24h freeform window:
  // Look up the most recent inbound message from this admin phone.
  const digits = toE164.replace(/\D/g, '');
  const { data: contact } = await sb
    .from('contacts')
    .select('id')
    .eq('is_deleted', false)
    .or(`phone_normalized.eq.${toE164},whatsapp_id.eq.${digits}`)
    .limit(1)
    .maybeSingle();

  let lastInboundAt: Date | null = null;
  if (contact?.id) {
    const { data: conv } = await sb
      .from('conversations')
      .select('last_inbound_at')
      .eq('contact_id', contact.id)
      .order('last_inbound_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (conv?.last_inbound_at) lastInboundAt = new Date(conv.last_inbound_at);
  }

  const insideWindow = !!lastInboundAt && (Date.now() - lastInboundAt.getTime()) < FREEFORM_WINDOW_MS;
  const templateSid = settingMap['zazi_admin_alert_template_content_sid'] || '';
  const templateApproved = settingMap['zazi_admin_alert_template_status'] === 'approved' && !!templateSid;

  // Pull email fallback configuration
  const { data: emailSettings } = await sb
    .from('integration_settings')
    .select('key,value')
    .in('key', ['zazi_emergency_admin_email']);
  const emailMap: Record<string,string> = {};
  (emailSettings || []).forEach((s: any) => { emailMap[s.key] = s.value; });
  const adminEmail = emailMap['zazi_emergency_admin_email'] || '';
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

  const attempts: any[] = [];
  async function logAttempt(channel: string, ok: boolean, info: any) {
    attempts.push({ channel, ok, ...info, ts: new Date().toISOString() });
    try {
      await sb.from('webhook_events').insert({
        source: 'admin_alert',
        action: channel,
        direction: 'outbound',
        status: ok ? 'delivered' : 'failed',
        payload: { to: toE164, message: alertText, info },
        error: ok ? null : (info?.error || info?.code || 'unknown'),
      });
    } catch (_) { /* ignore */ }
  }

  // Build Twilio request
  const params = new URLSearchParams();
  params.set('To', `whatsapp:${toE164}`);
  if (TWILIO_MESSAGING_SERVICE_SID) params.set('MessagingServiceSid', TWILIO_MESSAGING_SERVICE_SID);
  else if (TWILIO_WHATSAPP_FROM) params.set('From', `whatsapp:${TWILIO_WHATSAPP_FROM}`);

  let mode: 'freeform' | 'template' | 'blocked' = 'blocked';

  if (insideWindow) {
    params.set('Body', `🔔 ${alertText}`);
    mode = 'freeform';
  } else if (templateApproved) {
    params.set('ContentSid', templateSid);
    params.set('ContentVariables', JSON.stringify({ '1': alertText }));
    mode = 'template';
  } else {
    // Skip WA send entirely; cascade to SMS then email
    await logAttempt('whatsapp', false, { code: 'OUTSIDE_WINDOW_NO_TEMPLATE' });

    // SMS fallback via Twilio
    let smsOk = false; let smsData: any = null; let smsStatus = 0;
    try {
      const smsParams = new URLSearchParams();
      smsParams.set('To', toE164);
      if (TWILIO_MESSAGING_SERVICE_SID) smsParams.set('MessagingServiceSid', TWILIO_MESSAGING_SERVICE_SID);
      smsParams.set('Body', `🔔 ${alertText}`);
      const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
      const smsRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: smsParams,
      });
      smsStatus = smsRes.status;
      smsData = await smsRes.json();
      smsOk = smsRes.ok && !smsData?.error_code;
    } catch (e: any) {
      smsData = { error: e?.message };
    }
    await logAttempt('sms', smsOk, { sid: smsData?.sid, status: smsData?.status, error_code: smsData?.error_code, http: smsStatus });

    // Email fallback via Resend (only if SMS failed and key present)
    let emailOk = false; let emailInfo: any = null;
    if (!smsOk && adminEmail && RESEND_API_KEY) {
      try {
        const er = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Vanto CRM <onboarding@resend.dev>',
            to: [adminEmail],
            subject: '🔔 Vanto CRM Emergency Alert',
            text: alertText,
          }),
        });
        emailInfo = await er.json();
        emailOk = er.ok;
      } catch (e: any) {
        emailInfo = { error: e?.message };
      }
      await logAttempt('email', emailOk, emailInfo);
    } else if (!smsOk) {
      await logAttempt('email', false, { code: 'EMAIL_NOT_CONFIGURED', has_email: !!adminEmail, has_key: !!RESEND_API_KEY });
    }

    // Persist last attempt summary
    await sb.from('integration_settings').upsert([
      { key: 'zazi_admin_alert_last_attempt_at', value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { key: 'zazi_admin_alert_last_attempt_mode', value: smsOk ? 'sms_fallback' : (emailOk ? 'email_fallback' : 'all_failed'), updated_at: new Date().toISOString() },
      { key: 'zazi_admin_alert_last_attempt_sid', value: smsData?.sid || '', updated_at: new Date().toISOString() },
      { key: 'zazi_admin_alert_last_attempt_status', value: smsData?.status || `http_${smsStatus}`, updated_at: new Date().toISOString() },
      { key: 'zazi_admin_alert_last_attempt_error', value: smsData?.error_code ? String(smsData.error_code) : '', updated_at: new Date().toISOString() },
    ], { onConflict: 'key' });

    return jsonRes({
      ok: smsOk || emailOk,
      mode: smsOk ? 'sms_fallback' : (emailOk ? 'email_fallback' : 'all_failed'),
      attempts,
      to: toE164,
      last_inbound_at: lastInboundAt?.toISOString() || null,
    }, smsOk || emailOk ? 200 : 502);
  }

  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const twRes = await fetch(twilioUrl, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const twData = await twRes.json();

  await logAttempt('whatsapp', twRes.ok && !twData?.error_code, { sid: twData?.sid, status: twData?.status, error_code: twData?.error_code });

  // Log every attempt
  await sb.from('integration_settings').upsert([
    { key: 'zazi_admin_alert_last_attempt_at', value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { key: 'zazi_admin_alert_last_attempt_mode', value: mode, updated_at: new Date().toISOString() },
    { key: 'zazi_admin_alert_last_attempt_sid', value: twData?.sid || '', updated_at: new Date().toISOString() },
    { key: 'zazi_admin_alert_last_attempt_status', value: twData?.status || `http_${twRes.status}`, updated_at: new Date().toISOString() },
    { key: 'zazi_admin_alert_last_attempt_error', value: twData?.error_code ? String(twData.error_code) : '', updated_at: new Date().toISOString() },
  ], { onConflict: 'key' });

  if (!twRes.ok) {
    return jsonRes({
      ok: false,
      code: 'TWILIO_ERROR',
      mode,
      status: twRes.status,
      error_code: twData?.error_code,
      error_message: twData?.message,
      sid: twData?.sid || null,
      attempts,
    }, 502);
  }

  return jsonRes({
    ok: true,
    mode,
    sid: twData.sid,
    status: twData.status,
    to: toE164,
    inside_window: insideWindow,
    attempts,
  });
});
