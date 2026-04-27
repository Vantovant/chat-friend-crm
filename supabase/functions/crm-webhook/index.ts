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

// ─── PII Redaction (STEP D) ───────────────────────────────────────────────────
// Goal: never store raw phone, email, message content, names, or notes in
// webhook_events.payload or in console logs. Keep enough metadata to debug.
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
async function shortHash(input: string | null | undefined): Promise<string | null> {
  if (!input) return null;
  const h = await sha256Hex(String(input));
  return h.slice(0, 12); // 12-char fingerprint, not reversible
}
function maskPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length < 4) return '***';
  return `***${d.slice(-4)}`; // last 4 only
}
function maskEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw);
  const at = s.indexOf('@');
  if (at < 1) return '***';
  const domain = s.slice(at + 1);
  return `***@${domain}`;
}
function previewLen(raw: string | null | undefined): number {
  return raw ? String(raw).length : 0;
}

async function redactContact(c: any): Promise<any> {
  if (!c || typeof c !== 'object') return c;
  const phoneRaw = c.phone_number || c.phone || '';
  const email = c.email || '';
  return {
    phone_hash: await shortHash(phoneRaw),
    phone_mask: maskPhone(phoneRaw),
    email_hash: await shortHash(email),
    email_mask: maskEmail(email),
    name_hash: await shortHash(c.full_name || c.name || ''),
    has_notes: !!(c.notes || c.additional_notes),
    notes_len: previewLen(c.notes || c.additional_notes),
    lead_temperature: c.lead_temperature || c.temperature || null,
    lead_type: c.lead_type || c.type || null,
    interest_level: c.interest_level || c.interest || null,
    tag_count: Array.isArray(c.tags) ? c.tags.length : 0,
  };
}

async function redactPayload(body: any): Promise<any> {
  if (!body || typeof body !== 'object') return { _redacted: true };
  const out: any = {
    _redacted: true,
    action: body.action ?? null,
    has_user_id: !!body.user_id,
    payload_hash: await shortHash(JSON.stringify(body)),
  };
  if (Array.isArray(body.contacts)) {
    out.contacts_count = body.contacts.length;
    // Redact at most first 3 to keep payload bounded
    out.contacts_sample = await Promise.all(
      body.contacts.slice(0, 3).map((c: any) => redactContact(c))
    );
  }
  if (body.contact) {
    out.contact = await redactContact(body.contact);
  }
  if (body.phone) {
    out.phone_hash = await shortHash(body.phone);
    out.phone_mask = maskPhone(body.phone);
  }
  if (body.name) {
    out.name_hash = await shortHash(body.name);
  }
  if (typeof body.message_preview === 'string') {
    out.message_len = body.message_preview.length;
    out.message_hash = await shortHash(body.message_preview);
  }
  return out;
}

// ─── Auth helper (STEP C — dual-secret rotation) ─────────────────────────────
// Constant-time string compare. Returns true only when both strings are
// non-empty and byte-for-byte equal. Always walks the full length of the
// longer input to avoid early-exit timing leaks.
function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  const len = Math.max(ae.length, be.length);
  let diff = ae.length ^ be.length;
  for (let i = 0; i < len; i++) {
    diff |= (ae[i] ?? 0) ^ (be[i] ?? 0);
  }
  return diff === 0;
}
// Returns 'primary' | 'next' | null. Checks BOTH secrets even on early
// match so request timing does not reveal which slot matched.
function timingSafeMatch(provided: string, primary: string, next: string): 'primary' | 'next' | null {
  const matchPrimary = primary ? timingSafeEqual(provided, primary) : false;
  const matchNext = next ? timingSafeEqual(provided, next) : false;
  if (matchPrimary) return 'primary';
  if (matchNext) return 'next';
  return null;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // ── 1. Auth: verify webhook secret (STEP C — dual-secret rotation) ────────
  // Accept either WEBHOOK_SECRET (primary) or WEBHOOK_SECRET_NEXT (rotation
  // candidate). Use timing-safe comparison. Never log raw secret values.
  const provided = req.headers.get('x-webhook-secret') ?? '';
  const primary = Deno.env.get('WEBHOOK_SECRET') ?? '';
  const next = Deno.env.get('WEBHOOK_SECRET_NEXT') ?? '';

  const matchedSecret = timingSafeMatch(provided, primary, next);
  if (!matchedSecret) {
    console.log('[crm-webhook] auth_failed', {
      reason: !provided ? 'missing_header' : (!primary ? 'no_primary_configured' : 'mismatch'),
      next_configured: next.length > 0,
    });
    return jsonRes({ error: 'Unauthorized — invalid webhook secret' }, 401);
  }
  console.log('[crm-webhook] auth_ok', {
    matched_secret: matchedSecret, // 'primary' | 'next' — never the value
    next_configured: next.length > 0,
  });

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

  // ── 3.5 Idempotency check (STEP A) ─────────────────────────────────────────
  // Applies to: upsert_contact, log_chat, update_lead_type.
  // If the same x-idempotency-key + action + identity is replayed within 24h,
  // we return the cached response and do NOT re-run any DB writes.
  const IDEMPOTENT_ACTIONS = new Set(['upsert_contact', 'log_chat', 'update_lead_type']);
  const idempotencyKey = req.headers.get('x-idempotency-key') ?? '';
  const identity = String(
    user_id ||
    contact?.email || contact?.phone || contact?.phone_number ||
    body?.email || body?.phone || ''
  ).toLowerCase().trim() || null;

  if (IDEMPOTENT_ACTIONS.has(action)) {
    if (!idempotencyKey) {
      // Backward-compat: allow but warn (no PII).
      console.log('[crm-webhook] idempotency_missing_key', {
        action,
        has_identity: !!identity,
        payload_hash: await sha256Hex(JSON.stringify(body ?? {})),
      });
    } else {
      const { data: cached } = await supabase
        .from('webhook_idempotency_keys')
        .select('id, response, status_code, created_at')
        .eq('idempotency_key', idempotencyKey)
        .eq('action', action)
        .eq('user_identity', identity ?? '')
        .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle();
      if (cached?.response) {
        console.log('[crm-webhook] idempotency_replay', {
          action,
          status_code: cached.status_code,
          first_seen_at: cached.created_at,
        });
        return jsonRes({ ...(cached.response as any), idempotent_replay: true }, cached.status_code ?? 200);
      }
      console.log('[crm-webhook] idempotency_first', { action });
    }
  }

  // Cache the response under the idempotency key (only for idempotent actions
  // with a key, only on success). Errors are intentionally NOT cached so the
  // sender can retry after fixing the cause.
  async function cacheIdempotent(response: Record<string, unknown>, statusCode = 200) {
    if (!IDEMPOTENT_ACTIONS.has(action) || !idempotencyKey) return;
    try {
      await supabase
        .from('webhook_idempotency_keys')
        .insert({
          idempotency_key: idempotencyKey,
          action,
          user_identity: identity ?? '',
          payload_hash: await sha256Hex(JSON.stringify(body ?? {})),
          response,
          status_code: statusCode,
        });
    } catch (e) {
      // Unique violation on concurrent replay is fine — first writer wins.
      console.log('[crm-webhook] idempotency_cache_skip', { action, reason: 'duplicate_or_error' });
    }
  }


  // ── 4. Log inbound event (PII-redacted — STEP D) ──────────────────────────
  const redacted = await redactPayload(body);
  // Safe console log — no raw phone/email/message/name
  console.log('[crm-webhook] inbound', {
    action: redacted.action,
    has_user_id: redacted.has_user_id,
    payload_hash: redacted.payload_hash,
    contacts_count: redacted.contacts_count,
    message_len: redacted.message_len,
  });
  const eventRow: any = { source: 'zazi', action, status: 'received', payload: redacted };
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
    const resp = { success: true, phone: phoneNorm };
    await cacheIdempotent(resp, 200);
    return jsonRes(resp);
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
    const resp = { success: true, contact_id: contactId, conversation_id: conversationId };
    await cacheIdempotent(resp, 200);
    return jsonRes(resp);
  }

  // ─── action: update_lead_type (STEP F — review-gated proposal) ──────────────
  // SAFETY: This action NEVER directly updates contacts.lead_type.
  // It writes a reviewable proposal to zazi_actions and mirrors a
  // contact_activity audit row. A human (or an explicit approved apply path)
  // must accept the proposal before contacts.lead_type changes.
  // Phase 4A remains asleep — no detectors, no auto-apply, no UI changes here.
  if (action === 'update_lead_type') {
    // Aligned with public.lead_type Postgres enum (5 values) and src/lib/vanto-data.ts.
    // UI labels: Prospect, Registered_Nopurchase, Purchase_Nostatus, Purchase_Status, Expired.
    const ALLOWED_LEAD_TYPES = ['prospect', 'registered', 'buyer', 'vip', 'expired'] as const;
    type AllowedLeadType = typeof ALLOWED_LEAD_TYPES[number];

    const requestedRaw = String(body.requested_lead_type ?? body.lead_type ?? '').toLowerCase().trim();
    const evidence = body.evidence;
    const confidenceRaw = body.confidence;
    const reqEmail = body.email || contact?.email || null;
    const reqPhone = body.phone || contact?.phone || contact?.phone_number || null;

    // Validation — fail safely with clear, non-PII errors
    if (!reqEmail && !reqPhone) {
      await markEvent('error', 'identity required: email or phone');
      return jsonRes({ error: 'email or phone is required to identify the contact' }, 400);
    }
    if (!requestedRaw) {
      await markEvent('error', 'requested_lead_type missing');
      return jsonRes({ error: 'requested_lead_type is required' }, 400);
    }
    if (!ALLOWED_LEAD_TYPES.includes(requestedRaw as AllowedLeadType)) {
      await markEvent('error', 'invalid lead_type');
      return jsonRes({
        error: `requested_lead_type must be one of: ${ALLOWED_LEAD_TYPES.join(', ')}`,
      }, 400);
    }
    if (evidence === undefined || evidence === null ||
        (typeof evidence === 'string' && evidence.trim() === '') ||
        (typeof evidence === 'object' && Object.keys(evidence).length === 0)) {
      await markEvent('error', 'evidence missing');
      return jsonRes({ error: 'evidence is required (non-empty string or object)' }, 400);
    }
    const confidence = typeof confidenceRaw === 'number' ? confidenceRaw : Number(confidenceRaw);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      await markEvent('error', 'confidence missing or invalid');
      return jsonRes({ error: 'confidence is required and must be a number between 0 and 1' }, 400);
    }

    // Locate contact (do NOT create one — proposals must reference real records)
    let contactRow: { id: string; lead_type: string | null; assigned_to: string | null; created_by: string | null } | null = null;
    const phoneNorm = reqPhone ? normalizePhone(String(reqPhone)) : '';
    if (phoneNorm) {
      const { data } = await supabase
        .from('contacts')
        .select('id, lead_type, assigned_to, created_by')
        .eq('phone_normalized', phoneNorm)
        .eq('is_deleted', false)
        .limit(1)
        .maybeSingle();
      if (data) contactRow = data as any;
    }
    if (!contactRow && reqEmail) {
      const { data } = await supabase
        .from('contacts')
        .select('id, lead_type, assigned_to, created_by')
        .eq('email', String(reqEmail).toLowerCase().trim())
        .eq('is_deleted', false)
        .limit(1)
        .maybeSingle();
      if (data) contactRow = data as any;
    }
    if (!contactRow) {
      await markEvent('error', 'contact not found');
      return jsonRes({ error: 'contact not found for provided identity' }, 404);
    }

    // Redacted evidence summary — never store raw PII inside zazi_actions
    const evidenceSummary = typeof evidence === 'string'
      ? { kind: 'text', length: evidence.length, hash: await shortHash(evidence) }
      : { kind: 'object', keys: Object.keys(evidence).slice(0, 20), hash: await shortHash(JSON.stringify(evidence)) };

    const HIGH_CONFIDENCE_THRESHOLD = 0.85;
    const isHighConfidence = confidence >= HIGH_CONFIDENCE_THRESHOLD;
    const riskLevel = isHighConfidence ? 'medium' : 'low';

    // Insert review-gated proposal — status stays 'pending', requires_review=true,
    // auto_applied=false. NO direct contacts.lead_type write.
    const { data: actionRow, error: actionErr } = await supabase
      .from('zazi_actions')
      .insert({
        action_type: 'update_lead_type',
        contact_id: contactRow.id,
        confidence,
        risk_level: riskLevel,
        requires_review: true,
        auto_applied: false,
        status: 'pending',
        proposed_diff: {
          field: 'lead_type',
          from: contactRow.lead_type,
          to: requestedRaw,
        },
        evidence: {
          source: 'crm-webhook',
          summary: evidenceSummary,
          high_confidence: isHighConfidence,
          received_at: new Date().toISOString(),
        },
        created_by_label: 'Zazi CRM Webhook',
        ...(user_id ? { created_by: user_id } : {}),
      })
      .select('id')
      .single();

    if (actionErr || !actionRow) {
      await markEvent('error', actionErr?.message || 'failed to create proposal');
      return jsonRes({ error: actionErr?.message || 'failed to create proposal' }, 500);
    }

    // Mirror to contact_activity. performed_by is NOT NULL → use user_id from
    // body, else assigned_to, else created_by. If none, skip the activity row
    // rather than fail the proposal.
    const performedBy = user_id || contactRow.assigned_to || contactRow.created_by || null;
    if (performedBy) {
      await supabase.from('contact_activity').insert({
        contact_id: contactRow.id,
        performed_by: performedBy,
        type: 'lead_type_proposal',
        metadata: {
          proposal_id: actionRow.id,
          from: contactRow.lead_type,
          to: requestedRaw,
          confidence,
          high_confidence: isHighConfidence,
          evidence_summary: evidenceSummary,
          next_action: 'review proposal',
          source: 'crm-webhook',
        },
      });
    } else {
      console.log('[crm-webhook] update_lead_type_activity_skipped', {
        reason: 'no_performed_by',
        proposal_id: actionRow.id,
      });
    }

    console.log('[crm-webhook] update_lead_type_proposed', {
      proposal_id: actionRow.id,
      from: contactRow.lead_type,
      to: requestedRaw,
      confidence,
      high_confidence: isHighConfidence,
      requires_review: true,
      auto_applied: false,
    });

    await markEvent('success');
    const resp = {
      success: true,
      proposal_id: actionRow.id,
      status: 'pending',
      requires_review: true,
      auto_applied: false,
      high_confidence: isHighConfidence,
      from: contactRow.lead_type,
      to: requestedRaw,
    };
    await cacheIdempotent(resp, 200);
    return jsonRes(resp);
  }

  await markEvent('error', `Unknown action: ${action}`);
  return jsonRes({ error: `Unknown action: ${action}` }, 400);
});
