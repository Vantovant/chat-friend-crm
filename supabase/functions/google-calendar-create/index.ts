import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_calendar/calendar/v3';
const TIMEZONE = 'Africa/Johannesburg';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: 'Unauthorized' }, 401);
    const userId = claimsData.claims.sub as string;

    // Role check
    const { data: roleRows } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    const roles = (roleRows || []).map(r => r.role);
    const allowed = roles.some(r => ['admin', 'super_admin', 'agent'].includes(r));
    if (!allowed) return json({ error: 'Forbidden' }, 403);

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
    if (!LOVABLE_API_KEY || !GCAL_KEY) {
      return json({ error: 'Calendar connector not configured' }, 500);
    }

    const eventBody: Record<string, unknown> = {
      summary: title,
      description: `Vanto CRM meeting${contactName ? ` with ${contactName}` : ''}${contactId ? `\nContact ID: ${contactId}` : ''}`,
      start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
      reminders: { useDefault: true },
    };
    if (contactEmail) {
      eventBody.attendees = [{ email: contactEmail, displayName: contactName || undefined }];
    }

    const gcalRes = await fetch(
      `${GATEWAY_URL}/calendars/primary/events?sendUpdates=all`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': GCAL_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      }
    );

    const gcalText = await gcalRes.text();
    if (!gcalRes.ok) {
      console.error('Google Calendar error', gcalRes.status, gcalText);
      return json({ error: 'Google Calendar request failed', status: gcalRes.status, detail: gcalText }, 502);
    }
    const event = JSON.parse(gcalText);

    // Log activity (best effort)
    if (contactId) {
      await supabase.from('contact_activity').insert({
        contact_id: contactId,
        type: 'meeting_scheduled',
        performed_by: userId,
        metadata: {
          event_id: event.id,
          html_link: event.htmlLink,
          start: event.start,
          end: event.end,
          title,
          attendee_email: contactEmail || null,
        },
      });

      // Also create a plan_meetings row so it surfaces in PLAN
      await supabase.from('plan_meetings').insert({
        contact_id: contactId,
        title,
        meeting_at: start.toISOString(),
        duration_minutes: Number(durationMinutes),
        location: event.htmlLink || null,
        created_by: userId,
      }).then(() => {}, (e) => console.warn('plan_meetings insert skipped', e));
    }

    return json({ eventId: event.id, htmlLink: event.htmlLink, start: event.start, end: event.end });
  } catch (err) {
    console.error('google-calendar-create error', err);
    return json({ error: String(err?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
