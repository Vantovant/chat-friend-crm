Deno.serve(async () => {
  const secret = Deno.env.get('WEBHOOK_SECRET') ?? '';
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/crm-webhook`;
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const results: any[] = [];
  async function call(name: string, body: any) {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
        'Authorization': `Bearer ${anon}`,
        'apikey': anon,
        'x-idempotency-key': `f2-${name}-${Date.now()}`,
      },
      body: JSON.stringify(body),
    });
    results.push({ test: name, status: r.status, body: await r.json().catch(() => ({})) });
  }

  // T1: expired now allowed (was rejected before)
  await call('expired_allowed', {
    action: 'update_lead_type',
    phone: '27636557538',
    requested_lead_type: 'expired',
    evidence: 'no engagement 90d',
    confidence: 0.6,
  });

  // T2: orphan contact (no assigned_to, no created_by, no user_id) → 409
  await call('orphan_409', {
    action: 'update_lead_type',
    phone: '27999111222',
    requested_lead_type: 'buyer',
    evidence: 'test',
    confidence: 0.7,
  });

  // T3: orphan + user_id provided → success (audit row uses user_id)
  await call('orphan_with_user_id', {
    action: 'update_lead_type',
    phone: '27999111222',
    user_id: '7c4dbcd7-1342-4a70-9518-3fda85778b88',
    requested_lead_type: 'buyer',
    evidence: 'test',
    confidence: 0.7,
  });

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
