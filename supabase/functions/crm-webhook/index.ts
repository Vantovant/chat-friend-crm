import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

// ─── Mappers ─────────────────────────────────────────────────────────────────
function mapTemperature(val: string): 'hot' | 'warm' | 'cold' {
  if (!val) return 'cold';
  const v = val.toLowerCase();
  if (v === 'hot') return 'hot';
  if (v === 'warm') return 'warm';
  return 'cold';
}
function mapLeadType(val: string): 'prospect' | 'registered' | 'buyer' | 'vip' {
  if (!val) return 'prospect';
  const v = val.toLowerCase();
  if (v === 'registered') return 'registered';
  if (v === 'buyer') return 'buyer';
  if (v === 'vip') return 'vip';
  return 'prospect';
}
function mapInterest(val: string): 'high' | 'medium' | 'low' {
  if (!val) return 'medium';
  const v = val.toLowerCase();
  if (v === 'high') return 'high';
  if (v === 'low') return 'low';
  return 'medium';
}

/** Strip non-digits */
function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/** Normalize to SA E.164-ish digits */
function normalizePhone(raw: string): string {
  const d = digitsOnly(raw);
  if (!d) return '';
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) {
    return '27' + d.slice(1);
  }
  if (d.startsWith('27') && (d.length === 11 || d.length === 12)) {
    return d;
  }
  return d;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // ── 1. Auth: verify webhook secret ─────────────────────────────────────────
  const webhookSecret = req.headers.get('x-webhook-secret');
  const expectedSecret = Deno.env.get('WEBHOOK_SECRET');
  if (!webhookSecret || webhookSecret !== expectedSecret) {
    return jsonRes({ error: 'Unauthorized — invalid webhook secret' }, 401);
  }

  // ── 2. Service-role client (server-to-server only) ─────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── 3. Parse body ──────────────────────────────────────────────────────────
  let body: any;
  try { body = await req.json(); }
  catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }

  const { action, user_id, contacts, contact, phone, name, message_preview } = body;
  if (!action) return jsonRes({ error: 'Missing action field' }, 400);

  // ── 4. Log inbound event ───────────────────────────────────────────────────
  const eventRow: any = { source: 'zazi', action, status: 'received', payload: body };
  const { data: eventData } = await supabase
    .from('webhook_events')
    .insert(eventRow)
    .select('id')
    .single();
  const eventId: string | null = eventData?.id ?? null;

  const markEvent = async (status: 'success' | 'error', error?: string) => {
    if (!eventId) return;
    await supabase.from('webhook_events').update({ status, ...(error ? { error } : {}) }).eq('id', eventId);
  };

  // ── Helper: find contact by phone_normalized, scoped by created_by ─────────
  async function findContactByPhone(phoneNorm: string, createdBy?: string) {
    let query = supabase
      .from('contacts')
      .select('id')
      .eq('phone_normalized', phoneNorm)
      .eq('is_deleted', false);
    if (createdBy) query = query.eq('created_by', createdBy);
    const { data } = await query.limit(1).maybeSingle();
    return data;
  }

  // ─── action: sync_contacts ──────────────────────────────────────────────────
  if (action === 'sync_contacts') {
    if (!Array.isArray(contacts) || contacts.length === 0) {
      await markEvent('error', 'contacts must be a non-empty array');
      return jsonRes({ error: 'contacts must be a non-empty array' }, 400);
    }

    const startedAt = new Date().toISOString();
    let synced = 0, skipped = 0;
    const errors: string[] = [];

    for (const c of contacts) {
      const rawPhone = c.phone_number || c.phone || '';
      if (!rawPhone) { skipped++; continue; }
      const phoneNorm = normalizePhone(rawPhone);
      if (!phoneNorm) { skipped++; continue; }

      const mapped: any = {
        name: c.full_name || c.name || 'Unknown',
        phone: phoneNorm,
        phone_raw: String(rawPhone).trim(),
        phone_normalized: phoneNorm,
        email: c.email || null,
        notes: c.notes || c.additional_notes || null,
        temperature: mapTemperature(c.lead_temperature || c.temperature || ''),
        lead_type: mapLeadType(c.lead_type || c.type || ''),
        interest: mapInterest(c.interest_level || c.interest || ''),
        tags: Array.isArray(c.tags) ? c.tags : [],
        ...(user_id ? { created_by: user_id, assigned_to: user_id } : {}),
      };

      const existing = await findContactByPhone(phoneNorm, user_id || undefined);

      if (existing) {
        const { error } = await supabase.from('contacts')
          .update({ ...mapped, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (!error) synced++; else { skipped++; errors.push(error.message); }
      } else {
        const { error } = await supabase.from('contacts').insert(mapped);
        if (!error) synced++; else { skipped++; errors.push(error.message); }
      }
    }

    // Log sync_run
    await supabase.from('sync_runs').insert({
      source: 'zazi_webhook',
      synced, skipped, total: contacts.length, errors,
      user_id: user_id || null,
      finished_at: new Date().toISOString(),
    });

    await markEvent(errors.length === 0 ? 'success' : 'error', errors[0]);
    return jsonRes({ synced, skipped, total: contacts.length, errors });
  }

  // ─── action: upsert_contact ─────────────────────────────────────────────────
  if (action === 'upsert_contact') {
    if (!contact) {
      await markEvent('error', 'contact object is required');
      return jsonRes({ error: 'contact object is required' }, 400);
    }
    const rawPhone = contact.phone_number || contact.phone || '';
    if (!rawPhone) {
      await markEvent('error', 'contact.phone_number is required');
      return jsonRes({ error: 'contact.phone_number is required' }, 400);
    }
    const phoneNorm = normalizePhone(rawPhone);

    const mapped: any = {
      name: contact.full_name || contact.name || 'Unknown',
      phone: phoneNorm,
      phone_raw: String(rawPhone).trim(),
      phone_normalized: phoneNorm,
      email: contact.email || null,
      notes: contact.notes || contact.additional_notes || null,
      temperature: mapTemperature(contact.lead_temperature || contact.temperature || ''),
      lead_type: mapLeadType(contact.lead_type || contact.type || ''),
      interest: mapInterest(contact.interest_level || contact.interest || ''),
      tags: Array.isArray(contact.tags) ? contact.tags : [],
      ...(user_id ? { created_by: user_id, assigned_to: user_id } : {}),
    };

    const existing = await findContactByPhone(phoneNorm, user_id || undefined);

    if (existing) {
      const { error } = await supabase.from('contacts')
        .update({ ...mapped, updated_at: new Date().toISOString() }).eq('id', existing.id);
      if (error) { await markEvent('error', error.message); return jsonRes({ error: error.message }, 500); }
    } else {
      const { error } = await supabase.from('contacts').insert(mapped);
      if (error) { await markEvent('error', error.message); return jsonRes({ error: error.message }, 500); }
    }

    await markEvent('success');
    return jsonRes({ success: true, phone: phoneNorm });
  }

  // ─── action: log_chat ───────────────────────────────────────────────────────
  if (action === 'log_chat') {
    if (!phone) {
      await markEvent('error', 'phone is required for log_chat');
      return jsonRes({ error: 'phone is required for log_chat' }, 400);
    }
    const phoneNorm = normalizePhone(phone);

    let contactId: string;
    const existing = await findContactByPhone(phoneNorm, user_id || undefined);

    if (existing) {
      contactId = existing.id;
    } else {
      const { data: newContact, error: insertErr } = await supabase
        .from('contacts')
        .insert({
          name: name || 'Unknown',
          phone: phoneNorm,
          phone_raw: String(phone).trim(),
          phone_normalized: phoneNorm,
          ...(user_id ? { created_by: user_id, assigned_to: user_id } : {}),
        })
        .select('id').single();
      if (insertErr || !newContact) {
        await markEvent('error', insertErr?.message || 'Failed to create contact');
        return jsonRes({ error: insertErr?.message || 'Failed to create contact' }, 500);
      }
      contactId = newContact.id;
    }

    const { data: conv } = await supabase
      .from('conversations').select('id').eq('contact_id', contactId).maybeSingle();

    let conversationId: string;
    if (conv) {
      conversationId = conv.id;
      await supabase.from('conversations').update({
        last_message: message_preview || '', last_message_at: new Date().toISOString(), unread_count: 1,
      }).eq('id', conv.id);
    } else {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({ contact_id: contactId, last_message: message_preview || '', last_message_at: new Date().toISOString() })
        .select('id').single();
      if (convErr || !newConv) {
        await markEvent('error', convErr?.message || 'Failed to create conversation');
        return jsonRes({ error: convErr?.message || 'Failed to create conversation' }, 500);
      }
      conversationId = newConv.id;
    }

    if (message_preview) {
      await supabase.from('messages').insert({
        conversation_id: conversationId, content: message_preview, is_outbound: false, message_type: 'text',
      });
    }

    await markEvent('success');
    return jsonRes({ success: true, contact_id: contactId, conversation_id: conversationId });
  }

  await markEvent('error', `Unknown action: ${action}`);
  return jsonRes({ error: `Unknown action: ${action}` }, 400);
});
