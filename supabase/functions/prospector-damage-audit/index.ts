// Master Prospector — Damage Control Level 1 (audit-only, no sending)
// Scans every conversation, scores damage, prepares recovery drafts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROOF_URL = 'https://vanto-zazi-bloom.lovable.app';
const SHOP_URL = 'https://onlinecourseformlm.com/shop';
const LOCAL_NUMBER = '+27 79 083 1530';

interface Msg {
  id: string;
  is_outbound: boolean;
  content: string;
  created_at: string;
  provider: string | null;
}

function normalizeForDup(text: string): string {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim().slice(0, 80);
}

function scoreConversation(conv: { id: string; contact: any }, msgs: Msg[]) {
  const outbound = msgs.filter(m => m.is_outbound);
  const inbound = msgs.filter(m => !m.is_outbound);
  const now = Date.now();
  const outbound24h = outbound.filter(m => now - new Date(m.created_at).getTime() < 24 * 3600 * 1000).length;

  // Duplicates
  const seen = new Map<string, number>();
  for (const m of outbound) {
    const k = normalizeForDup(m.content);
    if (!k) continue;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  let duplicateOutbound = 0;
  for (const c of seen.values()) if (c > 1) duplicateOutbound += (c - 1);

  // First-touch quality (first outbound message)
  const firstOutbound = outbound[outbound.length - 1] || outbound[0]; // msgs ordered desc
  const firstAsc = [...outbound].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))[0];
  const ft = firstAsc?.content || '';
  const had_proof_url = ft.includes('vanto-zazi-bloom') || ft.includes(PROOF_URL);
  const had_aplgo_header = /APLGO|Get Well Africa/i.test(ft);
  const had_shop_link = ft.includes('onlinecourseformlm.com/shop') || ft.includes(SHOP_URL);
  const had_local_number = ft.includes('+27 79 083 1530') || ft.includes('+27 79');

  // Price leak detection: any outbound mentioning R<100 for a product
  let price_leak_detected = false;
  let price_leak_text: string | null = null;
  const priceRe = /\bR\s?(\d+(?:[.,]\d+)?)\b/gi;
  for (const m of outbound) {
    let mm: RegExpExecArray | null;
    priceRe.lastIndex = 0;
    while ((mm = priceRe.exec(m.content)) !== null) {
      const val = parseFloat(mm[1].replace(',', '.'));
      if (!isNaN(val) && val > 0 && val < 100) {
        price_leak_detected = true;
        price_leak_text = m.content.slice(0, 200);
        break;
      }
    }
    if (price_leak_detected) break;
  }

  // Premature money push: first outbound contains "buy"/"member price"/"register"/"join" without product context
  const premature_money_push = !!firstAsc && /\b(buy|member price|retail price|register|join|enrol)\b/i.test(ft) && !had_proof_url;

  const weak_first_touch = !had_proof_url || !had_aplgo_header || !had_shop_link;

  // Intent
  const inboundText = inbound.map(m => m.content).join(' ').toLowerCase();
  let intent: string = 'unknown';
  if (/\b(price|cost|how much|kanjani|magkilo)\b/.test(inboundText)) intent = 'buy';
  else if (/\b(buy|purchase|order|i want|order it)\b/.test(inboundText)) intent = 'buy';
  else if (/\b(join|register|enrol|sign up|business|opportunity)\b/.test(inboundText)) intent = 'join';
  else if (/\b(info|tell me|what is|product|help)\b/.test(inboundText)) intent = 'info';
  else if (inbound.length === 0) intent = 'silent';

  // Temperature
  let temperature = 'cold';
  if (intent === 'buy' || intent === 'join') temperature = 'hot';
  else if (inbound.length > 0) temperature = 'warm';

  // Topic guess
  let interest_topic: string | null = null;
  const topicMap: Record<string, RegExp> = {
    sleep: /\bsleep|insomnia\b/i,
    energy: /\benergy|fatigue|tired\b/i,
    cravings: /\bcravings|sugar|appetite|weight\b/i,
    joints: /\bjoint|pain|arthritis\b/i,
    stomach: /\bstomach|digest|ice|gut\b/i,
    hormones: /\bhormone|cycle|menopause\b/i,
    immune: /\bimmune|flu|cold\b/i,
    diabetes: /\bdiabet|sugar balance|nrm\b/i,
    business: /\bbusiness|join|opportunity|earn\b/i,
  };
  for (const [k, re] of Object.entries(topicMap)) {
    if (re.test(inboundText)) { interest_topic = k; break; }
  }

  // Damage scoring
  let damage_score = 'green';
  if (price_leak_detected) damage_score = 'red';
  else if (duplicateOutbound >= 2 || (premature_money_push && weak_first_touch)) damage_score = 'orange';
  else if (duplicateOutbound === 1 || weak_first_touch || premature_money_push) damage_score = 'yellow';

  const vanto_step_in = damage_score === 'red' || (temperature === 'hot' && damage_score !== 'green');
  const recoverable = damage_score !== 'red' || (inbound.length > 0);

  // Name knowledge
  const name = (conv.contact?.name || '').trim();
  const isPhoneName = !name || /^\+?\d[\d\s-]+$/.test(name);
  const name_known = !!name && !isPhoneName;

  // Recommended action
  let recommended_action: string;
  if (damage_score === 'red') recommended_action = 'VANTO STEP IN NOW — wrong price or critical trust break';
  else if (damage_score === 'orange') recommended_action = 'Send soft apology + reset (one-by-one)';
  else if (damage_score === 'yellow') recommended_action = 'Send gentle re-introduction with proper trust header';
  else if (temperature === 'hot') recommended_action = 'VANTO STEP IN NOW — hot lead, close personally';
  else recommended_action = 'Continue normal trust-first protocol';

  // Recovery draft
  const greeting = name_known ? `Hi ${name.split(' ')[0]}` : 'Hi there';
  const namePrompt = name_known ? '' : '\n\nBefore I continue, may I confirm your name so I address you properly?';
  let recovery_draft: string;
  if (damage_score === 'red' || damage_score === 'orange') {
    recovery_draft =
      `${greeting}, this is Vanto from Get Well Africa.\n\n` +
      `I want to reset properly — you may have received a system-style message earlier, and I don't want that to feel cold or confusing.${namePrompt}\n\n` +
      `Official shop: ${SHOP_URL}\n` +
      `Distributor proof: ${PROOF_URL}\n\n` +
      `What would you like support with most — sleep, energy, cravings, joints, stomach, hormones, immune support, or business information?\n\n` +
      `— Vanto\nLocal support: ${LOCAL_NUMBER}`;
  } else if (damage_score === 'yellow') {
    recovery_draft =
      `${greeting}, this is Vanto from Get Well Africa (APLGO distributor).${namePrompt}\n\n` +
      `Official shop: ${SHOP_URL}\n` +
      `Distributor proof: ${PROOF_URL}\n\n` +
      `What can I help you with first?\n\n— Vanto\n${LOCAL_NUMBER}`;
  } else {
    recovery_draft = `No recovery needed — continue normal flow.${name_known ? '' : namePrompt}`;
  }

  return {
    contact_name: name || null,
    contact_phone: conv.contact?.phone || null,
    contact_source: conv.contact?.contact_source || null,
    damage_score,
    recoverable,
    vanto_step_in,
    outbound_total: outbound.length,
    inbound_total: inbound.length,
    duplicate_outbound: duplicateOutbound,
    outbound_24h: outbound24h,
    had_proof_url,
    had_aplgo_header,
    had_shop_link,
    had_local_number,
    price_leak_detected,
    price_leak_text,
    premature_money_push,
    duplicate_messages: duplicateOutbound > 0,
    weak_first_touch,
    intent,
    temperature,
    interest_topic,
    name_known,
    recommended_action,
    recovery_draft,
    first_outbound_snippet: firstAsc?.content?.slice(0, 200) || null,
    last_outbound_snippet: outbound[0]?.content?.slice(0, 200) || null,
    last_inbound_snippet: inbound[0]?.content?.slice(0, 200) || null,
    last_inbound_at: inbound[0]?.created_at || null,
    last_outbound_at: outbound[0]?.created_at || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { data: convs, error: cerr } = await supabase
      .from('conversations')
      .select('id, contact_id, contacts:contact_id (name, phone, contact_source)')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (cerr) throw cerr;

    let scanned = 0, green = 0, yellow = 0, orange = 0, red = 0, stepIn = 0, nameNeeded = 0;

    for (const conv of (convs || [])) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id, is_outbound, content, created_at, provider')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(200);

      const result = scoreConversation(
        { id: conv.id, contact: conv.contacts },
        (msgs || []) as Msg[]
      );

      await supabase.from('prospector_damage_audit').upsert({
        conversation_id: conv.id,
        contact_id: conv.contact_id,
        ...result,
        scanned_at: new Date().toISOString(),
      }, { onConflict: 'conversation_id' });

      scanned++;
      if (result.damage_score === 'green') green++;
      else if (result.damage_score === 'yellow') yellow++;
      else if (result.damage_score === 'orange') orange++;
      else if (result.damage_score === 'red') red++;
      if (result.vanto_step_in) stepIn++;
      if (!result.name_known) nameNeeded++;
    }

    return new Response(JSON.stringify({
      ok: true, scanned, green, yellow, orange, red,
      vanto_step_in: stepIn, name_confirmation_needed: nameNeeded,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('damage-audit error', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
