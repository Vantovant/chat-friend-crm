// Two-way Google Contacts sync for the signed-in user.
// Modes:
//   { action: 'status' }   -> reports linked email + counts
//   { action: 'browse' }   -> pulls list from Google, does NOT import (returns first 200)
//   { action: 'pull' }     -> imports Google contacts into public.contacts (dedup on phone/email)
//   { action: 'push_all' } -> pushes every local contact into Google
//   { action: 'disconnect' } -> deletes the stored token row
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const CLIENT_ID = Deno.env.get('GOOGLE_CONTACTS_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GOOGLE_CONTACTS_CLIENT_SECRET')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type TokenRow = {
  user_id: string;
  google_email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

async function refreshIfNeeded(svc: any, row: TokenRow): Promise<TokenRow> {
  const expiresAt = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
  if (row.access_token && expiresAt - Date.now() > 60_000) return row;
  if (!row.refresh_token) throw new Error('missing_refresh_token — reconnect Google');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`refresh_failed: ${JSON.stringify(j)}`);

  const newAccess = j.access_token as string;
  const newExpiresAt = new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString();
  await svc.from('google_contacts_tokens').update({
    access_token: newAccess,
    token_expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('user_id', row.user_id);

  return { ...row, access_token: newAccess, token_expires_at: newExpiresAt };
}

async function listAllConnections(accessToken: string): Promise<any[]> {
  const out: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections');
    url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers,organizations');
    url.searchParams.set('pageSize', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`people_list_failed: ${await res.text()}`);
    const j = await res.json();
    if (Array.isArray(j.connections)) out.push(...j.connections);
    pageToken = j.nextPageToken;
  } while (pageToken && out.length < 5000);
  return out;
}

function shapeGoogle(p: any) {
  const name = p.names?.[0]?.displayName || null;
  const email = p.emailAddresses?.[0]?.value || null;
  const phone = p.phoneNumbers?.[0]?.canonicalForm || p.phoneNumbers?.[0]?.value || null;
  const org = p.organizations?.[0]?.name || null;
  return { name, email, phone, org, resourceName: p.resourceName };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'no_auth' }, 401);

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: userRes, error: userErr } = await supa.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: 'invalid_session' }, 401);
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status');

    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'disconnect') {
      await svc.from('google_contacts_tokens').delete().eq('user_id', userId);
      return json({ ok: true, disconnected: true });
    }

    const { data: rowData } = await svc.from('google_contacts_tokens').select('*').eq('user_id', userId).maybeSingle();
    if (!rowData) return json({ connected: false });
    let row = rowData as TokenRow;

    if (action === 'status') {
      return json({
        connected: true,
        google_email: row.google_email,
        token_expires_at: row.token_expires_at,
      });
    }

    row = await refreshIfNeeded(svc, row);

    if (action === 'browse') {
      const conns = await listAllConnections(row.access_token!);
      return json({
        ok: true, count: conns.length,
        sample: conns.slice(0, 200).map(shapeGoogle),
      });
    }

    if (action === 'pull') {
      const conns = await listAllConnections(row.access_token!);
      let imported = 0, skipped = 0;
      // Fetch existing phones/emails to dedup
      const { data: existing } = await svc.from('contacts').select('phone,email').eq('is_deleted', false).limit(20000);
      const phones = new Set((existing || []).map((c: any) => (c.phone || '').trim()).filter(Boolean));
      const emails = new Set((existing || []).map((c: any) => (c.email || '').toLowerCase().trim()).filter(Boolean));

      for (const p of conns) {
        const s = shapeGoogle(p);
        if (!s.name && !s.phone && !s.email) { skipped++; continue; }
        const phoneKey = (s.phone || '').trim();
        const emailKey = (s.email || '').toLowerCase().trim();
        if ((phoneKey && phones.has(phoneKey)) || (emailKey && emails.has(emailKey))) { skipped++; continue; }
        const { error: insErr } = await svc.from('contacts').insert({
          name: s.name || s.email || s.phone || 'Google contact',
          email: s.email,
          phone: s.phone,
          notes: `Imported from Google Contacts (${row.google_email || 'linked account'})`,
          created_by: userId,
        });
        if (insErr) { skipped++; continue; }
        imported++;
        if (phoneKey) phones.add(phoneKey);
        if (emailKey) emails.add(emailKey);
      }
      await svc.from('google_contacts_tokens').update({ last_pull_at: new Date().toISOString() }).eq('user_id', userId);
      return json({ ok: true, imported, skipped, total_google: conns.length });
    }

    if (action === 'push_all') {
      const { data: local } = await svc.from('contacts')
        .select('id,name,phone,email')
        .eq('is_deleted', false)
        .limit(5000);
      let pushed = 0, failed = 0;
      for (const c of (local || [])) {
        if (!c.name && !c.phone && !c.email) continue;
        const body = {
          names: c.name ? [{ givenName: c.name }] : undefined,
          emailAddresses: c.email ? [{ value: c.email }] : undefined,
          phoneNumbers: c.phone ? [{ value: c.phone }] : undefined,
        };
        const res = await fetch('https://people.googleapis.com/v1/people:createContact', {
          method: 'POST',
          headers: { Authorization: `Bearer ${row.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) pushed++; else failed++;
      }
      await svc.from('google_contacts_tokens').update({ last_push_at: new Date().toISOString() }).eq('user_id', userId);
      return json({ ok: true, pushed, failed, total_local: local?.length || 0 });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
