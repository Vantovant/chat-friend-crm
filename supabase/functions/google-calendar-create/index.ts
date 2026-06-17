import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_calendar/calendar/v3';
const TIMEZONE = 'Africa/Johannesburg';

function fmtSAST(d: Date) {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return { date, time };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const service = createClient(SUPABASE_URL, SERVICE_KEY);

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: 'Unauthorized' }, 401);
    const userId = claimsData.claims.sub as string;

    const { data: roleRows } = await supabase.from('user_roles').select('role').eq('user_id', userId);
    const roles = (roleRows || []).map((r: any) => r.role);
    if (!roles.some((r: string) => ['admin', 'super_admin', 'agent'].includes(r))) {
      return json({ error: 'Forbidden' }, 403);
    }

    const body = await req.json();
    const { contactId, contactName, contactEmail, title, startISO, durationMinutes } = body;

    if (!title || !startISO || !durationMinutes) {
      return json({ error: 'Missing required fields: title, startISO, durationMinutes' }, 400);
    }
    const start = new Date(startISO);
    if (isNaN(start.getTime())) return json({ error: 'Invalid startISO' }, 400);
    const end = new Date(start.getTime() + Number(durationMinutes) * 60 * 1000);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GCAL_KEY = Deno.env.get('GOOGLE_CALENDAR_API_KEY');
    if (!LOVABLE_API_KEY || !GCAL_KEY) return json({ error: 'Calendar connector not configured' }, 500);

    // ── Create event ──
    const eventBody: Record<string, unknown> = {
      summary: title,
      description: `Vanto CRM meeting${contactName ? ` with ${contactName}` : ''}${contactId ? `\nContact ID: ${contactId}` : ''}`,
      start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
      reminders: { useDefault: true },
      guestsCanSeeOtherGuests: false,
    };
    if (contactEmail) {
      eventBody.attendees = [{ email: contactEmail, displayName: contactName || undefined }];
    }

    const sendUpdates = contactEmail ? 'all' : 'none';
    const gcalRes = await fetch(
      `${GATEWAY_URL}/calendars/primary/events?sendUpdates=${sendUpdates}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': GCAL_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      },
    );
    const gcalText = await gcalRes.text();
    if (!gcalRes.ok) {
      console.error('Google Calendar error', gcalRes.status, gcalText);
      return json({ error: 'Google Calendar request failed', status: gcalRes.status, detail: gcalText }, 502);
    }
    const event = JSON.parse(gcalText);
    const htmlLink: string = event.htmlLink;
    const eventId: string = event.id;

    // ── Compose WhatsApp message ──
    const { date: dateStr, time: timeStr } = fmtSAST(start);
    const waMessage =
      `📅 Meeting confirmed: ${title}\n\n` +
      `📆 ${dateStr} at ${timeStr} (SAST)\n\n` +
      `Tap here to add to your calendar:\n${htmlLink}\n\n` +
      `💡 When you add it, Google will ask for your email. ` +
      `This helps us send you reminders and updates.`;

    // ── Send via existing send-message (needs a conversation_id) ──
    let waSent = false;
    let waReason: string | null = null;
    if (contactId) {
      const { data: conv } = await service
        .from('conversations')
        .select('id, last_inbound_at')
        .eq('contact_id', contactId)
        .order('last_inbound_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (!conv) {
        waReason = 'no_conversation';
      } else {
        try {
          const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-message`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-vanto-internal-key': SERVICE_KEY,
            },
            body: JSON.stringify({ conversation_id: conv.id, content: waMessage }),
          });
          const sendJson = await sendRes.json().catch(() => ({}));
          if (sendRes.ok && sendJson?.ok !== false) {
            waSent = true;
          } else {
            waReason = sendJson?.code || `http_${sendRes.status}`;
          }
        } catch (e) {
          waReason = `invoke_error:${String((e as Error)?.message || e)}`;
        }
      }
    }

    // ── Register Google push channel (best effort) ──
    let watchRegistered = false;
    try {
      const channelId = crypto.randomUUID();
      const webhookUrl = `${SUPABASE_URL}/functions/v1/calendar-webhook`;
      const watchRes = await fetch(
        `${GATEWAY_URL}/calendars/primary/events/watch`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'X-Connection-Api-Key': GCAL_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: channelId,
            type: 'web_hook',
            address: webhookUrl,
            token: eventId,
            expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }),
        },
      );
      watchRegistered = watchRes.ok;
      if (!watchRes.ok) console.warn('events.watch failed', watchRes.status, await watchRes.text());
    } catch (e) {
      console.warn('events.watch error', e);
    }

    // ── Logging ──
    if (contactId) {
      await service.from('contact_activity').insert({
        contact_id: contactId,
        type: 'meeting_scheduled',
        performed_by: userId,
        metadata: {
          event_id: eventId,
          html_link: htmlLink,
          start: event.start,
          end: event.end,
          title,
          attendee_email: contactEmail || null,
          whatsapp_sent: waSent,
          whatsapp_reason: waReason,
          watch_registered: watchRegistered,
        },
      });

      await service.from('plan_meetings').insert({
        contact_id: contactId,
        title,
        meeting_at: start.toISOString(),
        duration_minutes: Number(durationMinutes),
        location: htmlLink || null,
        created_by: userId,
        calendar_event_id: eventId,
      }).then(() => {}, (e) => console.warn('plan_meetings insert skipped', e));
    }

    return json({
      eventId, htmlLink, start: event.start, end: event.end,
      whatsappSent: waSent, whatsappReason: waReason,
      emailInviteSent: !!contactEmail,
      watchRegistered,
    });
  } catch (err: any) {
    console.error('google-calendar-create error', err);
    return json({ error: String(err?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
