// One-off smoke test for STEP F — update_lead_type.
// Reads WEBHOOK_SECRET from env and calls crm-webhook with various payloads.
// Safe: read-only on contacts. Writes go to zazi_actions + contact_activity only.
Deno.serve(async () => {
  const secret = Deno.env.get('WEBHOOK_SECRET') ?? '';
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/crm-webhook`;
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  const PHONE = '27636557538'; // existing contact: Nonhle
  const results: any[] = [];

  async function call(name: string, body: any, idempotencyKey?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-webhook-secret': secret,
      'Authorization': `Bearer ${anon}`,
      'apikey': anon,
    };
    if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    results.push({ test: name, status: r.status, body: json });
  }

  // 1. Valid request — creates proposal
  await call('valid_request', {
    action: 'update_lead_type',
    phone: PHONE,
    requested_lead_type: 'buyer',
    evidence: { source: 'order_seen', order_id: 'ORD-9001' },
    confidence: 0.92,
  }, 'smoke-f-1-' + Date.now());

  // 2. Missing evidence
  await call('missing_evidence', {
    action: 'update_lead_type',
    phone: PHONE,
    requested_lead_type: 'buyer',
    confidence: 0.9,
  });

  // 3. Missing confidence
  await call('missing_confidence', {
    action: 'update_lead_type',
    phone: PHONE,
    requested_lead_type: 'buyer',
    evidence: 'saw purchase',
  });

  // 4. Invalid lead_type
  await call('invalid_lead_type', {
    action: 'update_lead_type',
    phone: PHONE,
    requested_lead_type: 'super_buyer',
    evidence: 'x',
    confidence: 0.5,
  });

  // 5. Idempotency replay
  const idemKey = 'smoke-f-replay-' + Date.now();
  await call('idem_first', {
    action: 'update_lead_type',
    phone: PHONE,
    requested_lead_type: 'registered',
    evidence: 'mautic registration',
    confidence: 0.7,
  }, idemKey);
  await call('idem_replay', {
    action: 'update_lead_type',
    phone: PHONE,
    requested_lead_type: 'registered',
    evidence: 'mautic registration',
    confidence: 0.7,
  }, idemKey);

  // 6. No identity
  await call('no_identity', {
    action: 'update_lead_type',
    requested_lead_type: 'buyer',
    evidence: 'x',
    confidence: 0.5,
  });

  // 7. Contact not found
  await call('contact_not_found', {
    action: 'update_lead_type',
    phone: '27000000001',
    requested_lead_type: 'buyer',
    evidence: 'x',
    confidence: 0.5,
  });

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
