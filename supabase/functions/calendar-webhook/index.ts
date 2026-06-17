import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_calendar/calendar/v3';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const resourceState = req.headers.get('x-goog-resource-state') || '';
    const channelToken = req.headers.get('x-goog-channel-token') || ''; // we set this = event_id
    const channelId = req.headers.get('x-goog-channel-id') || '';
    console.log('[calendar-webhook] state=%s token=%s channel=%s', resourceState, channelToken, channelId);

    if (resourceState === 'sync') {
      return new Response('ok', { status: 200, headers: corsHeaders });
    }
    if (!channelToken) {
      return new Response('missing token', { status: 200, headers: corsHeaders });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const service = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Find plan_meetings row for this event
    const { data: meeting } = await service
      .from('plan_meetings')
      .select('id, contact_id, calendar_event_id')
      .eq('calendar_event_id', channelToken)
      .maybeSingle();

    if (!meeting?.contact_id) {
      console.warn('[calendar-webhook] no meeting found for', channelToken);
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    // Fetch event details from Google
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GCAL_KEY = Deno.env.get('GOOGLE_CALENDAR_API_KEY');
    if (!LOVABLE_API_KEY || !GCAL_KEY) {
      console.error('[calendar-webhook] connector keys missing');
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    const evRes = await fetch(
      `${GATEWAY_URL}/calendars/primary/events/${encodeURIComponent(channelToken)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': GCAL_KEY,
        },
      },
    );
    if (!evRes.ok) {
      console.warn('[calendar-webhook] gcal fetch failed', evRes.status, await evRes.text());
      return new Response('ok', { status: 200, headers: corsHeaders });
    }
    const ev = await evRes.json();
    const organizerEmail = ev?.organizer?.email || '';
    const attendees: any[] = Array.isArray(ev?.attendees) ? ev.attendees : [];

    // Pull current contact email
    const { data: contact } = await service
      .from('contacts')
      .select('id, email')
      .eq('id', meeting.contact_id)
      .maybeSingle();

    // Pull recent activity to dedupe
    const { data: recentAct } = await service
      .from('contact_activity')
      .select('id, type, metadata')
      .eq('contact_id', meeting.contact_id)
      .in('type', ['email_captured', 'meeting_accepted', 'meeting_declined'])
      .order('created_at', { ascending: false })
      .limit(50);

    const alreadyLogged = (type: string, email: string | null) =>
      (recentAct || []).some((a: any) =>
        a.type === type &&
        ((a.metadata as any)?.event_id === channelToken) &&
        (email ? (a.metadata as any)?.email === email : true),
      );

    for (const att of attendees) {
      const email = (att?.email || '').toLowerCase();
      if (!email || email === (organizerEmail || '').toLowerCase()) continue;

      // Capture email
      if (!alreadyLogged('email_captured', email)) {
        await service.from('contact_activity').insert({
          contact_id: meeting.contact_id,
          type: 'email_captured',
          metadata: {
            email,
            event_id: channelToken,
            source: 'google_calendar_accept',
            response_status: att?.responseStatus || null,
          },
        });
      }

      // Update contacts.email only if currently empty
      if (!contact?.email) {
        await service
          .from('contacts')
          .update({ email })
          .eq('id', meeting.contact_id)
          .is('email', null);
      }

      // Response status
      if (att?.responseStatus === 'accepted' && !alreadyLogged('meeting_accepted', email)) {
        await service.from('contact_activity').insert({
          contact_id: meeting.contact_id,
          type: 'meeting_accepted',
          metadata: { email, event_id: channelToken },
        });
      } else if (att?.responseStatus === 'declined' && !alreadyLogged('meeting_declined', email)) {
        await service.from('contact_activity').insert({
          contact_id: meeting.contact_id,
          type: 'meeting_declined',
          metadata: { email, event_id: channelToken },
        });
      }
    }

    return new Response('ok', { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error('[calendar-webhook] error', err);
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
});
