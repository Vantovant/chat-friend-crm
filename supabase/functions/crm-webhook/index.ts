import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate webhook secret
  const webhookSecret = req.headers.get('x-webhook-secret');
  const expectedSecret = Deno.env.get('WEBHOOK_SECRET');
  if (!webhookSecret || webhookSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized — invalid webhook secret' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Use service role for server-to-server operations
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { action, user_id, contacts, contact, phone, name, message_preview } = body;

  if (!action) {
    return new Response(JSON.stringify({ error: 'Missing action field' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ─── sync_contacts ────────────────────────────────────────────────────────
  if (action === 'sync_contacts') {
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return new Response(JSON.stringify({ error: 'contacts must be a non-empty array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const c of contacts) {
      const phoneNum = c.phone_number || c.phone;
      if (!phoneNum) { skipped++; continue; }

      const mapped = {
        name: c.full_name || c.name || 'Unknown',
        phone: phoneNum,
        email: c.email || null,
        notes: c.notes || c.additional_notes || null,
        temperature: mapTemperature(c.lead_temperature || c.temperature || ''),
        lead_type: mapLeadType(c.lead_type || c.type || ''),
        interest: mapInterest(c.interest_level || c.interest || ''),
        tags: c.tags || [],
        ...(user_id ? { created_by: user_id, assigned_to: user_id } : {}),
      };

      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('phone', phoneNum)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('contacts')
          .update({ ...mapped, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (!error) synced++; else { skipped++; errors.push(error.message); }
      } else {
        const { error } = await supabase.from('contacts').insert(mapped);
        if (!error) synced++; else { skipped++; errors.push(error.message); }
      }
    }

    return new Response(JSON.stringify({ synced, skipped, total: contacts.length, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ─── upsert_contact ───────────────────────────────────────────────────────
  if (action === 'upsert_contact') {
    if (!contact) {
      return new Response(JSON.stringify({ error: 'contact object is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phoneNum = contact.phone_number || contact.phone;
    if (!phoneNum) {
      return new Response(JSON.stringify({ error: 'contact.phone_number is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const mapped = {
      name: contact.full_name || contact.name || 'Unknown',
      phone: phoneNum,
      email: contact.email || null,
      notes: contact.notes || contact.additional_notes || null,
      temperature: mapTemperature(contact.lead_temperature || contact.temperature || ''),
      lead_type: mapLeadType(contact.lead_type || contact.type || ''),
      interest: mapInterest(contact.interest_level || contact.interest || ''),
      tags: contact.tags || [],
      ...(user_id ? { created_by: user_id, assigned_to: user_id } : {}),
    };

    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('phone', phoneNum)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('contacts')
        .update({ ...mapped, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      const { error } = await supabase.from('contacts').insert(mapped);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, phone: phoneNum }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ─── log_chat ─────────────────────────────────────────────────────────────
  if (action === 'log_chat') {
    if (!phone) {
      return new Response(JSON.stringify({ error: 'phone is required for log_chat' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ensure contact exists
    let contactId: string;
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (existing) {
      contactId = existing.id;
    } else {
      const { data: newContact, error: insertErr } = await supabase
        .from('contacts')
        .insert({
          name: name || 'Unknown',
          phone,
          ...(user_id ? { created_by: user_id, assigned_to: user_id } : {}),
        })
        .select('id')
        .single();
      if (insertErr || !newContact) {
        return new Response(JSON.stringify({ error: insertErr?.message || 'Failed to create contact' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      contactId = newContact.id;
    }

    // Find or create conversation
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .maybeSingle();

    let conversationId: string;
    if (conv) {
      conversationId = conv.id;
      await supabase
        .from('conversations')
        .update({ last_message: message_preview || '', last_message_at: new Date().toISOString(), unread_count: 1 })
        .eq('id', conv.id);
    } else {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({ contact_id: contactId, last_message: message_preview || '', last_message_at: new Date().toISOString() })
        .select('id')
        .single();
      if (convErr || !newConv) {
        return new Response(JSON.stringify({ error: convErr?.message || 'Failed to create conversation' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      conversationId = newConv.id;
    }

    // Log message
    if (message_preview) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        content: message_preview,
        is_outbound: false,
        message_type: 'text',
      });
    }

    return new Response(JSON.stringify({ success: true, contact_id: contactId, conversation_id: conversationId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
