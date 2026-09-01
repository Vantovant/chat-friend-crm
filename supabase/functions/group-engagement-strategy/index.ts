/**
 * Vanto CRM — group-engagement-strategy
 * Weekly, bigger-picture counterpart to group-engagement-digest.
 * Looks at ALL historical group activity, computes hard stats in code,
 * reuses the latest group_health_reports reconnect_shortlist, and asks the
 * AI Gateway for a weekly strategy brief.
 *
 * READ-ONLY with respect to WhatsApp: never calls maytapi-send-group,
 * maytapi-send-direct or send-message.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const GROUP_JID = '120363419298058298@g.us';
const GROUP_NAME = 'APLGO | Health and Biz';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function digits(v: string | null | undefined) {
  return (v || '').replace(/\D/g, '');
}

function maskPhone(v: string | null | undefined) {
  const d = digits(v);
  if (!d) return 'unknown';
  return `***${d.slice(-4)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // 1. All group message history
    const { data: msgs, error: mErr } = await supabase
      .from('maytapi_messages')
      .select('body, body_preview, phone_e164, received_at')
      .eq('conversation_key', GROUP_JID)
      .order('received_at', { ascending: true })
      .limit(5000);
    if (mErr) throw mErr;

    const messages = (msgs || []) as any[];

    // Member -> contact name resolution
    const { data: members, error: gErr } = await supabase
      .from('whatsapp_group_members')
      .select('phone_normalized, contact_id, classification')
      .eq('group_jid', GROUP_JID)
      .eq('last_seen_in_group_status', 'in_group')
      .limit(5000);
    if (gErr) throw gErr;

    const memberRows = members || [];
    const contactIds = Array.from(
      new Set(memberRows.map((m: any) => m.contact_id).filter(Boolean)),
    ) as string[];

    const nameByContactId = new Map<string, string>();
    for (let i = 0; i < contactIds.length; i += 500) {
      const slice = contactIds.slice(i, i + 500);
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name')
        .in('id', slice);
      (contacts || []).forEach((c: any) => nameByContactId.set(c.id, c.name));
    }

    const nameByPhone = new Map<string, string | null>();
    for (const m of memberRows as any[]) {
      const key = digits(m.phone_normalized);
      if (key) nameByPhone.set(key, m.contact_id ? nameByContactId.get(m.contact_id) ?? null : null);
    }

    // 2. Hard stats computed in code
    const byHour: Record<string, number> = {};
    const byDow: Record<string, number> = {};
    const countByPhone = new Map<string, number>();

    for (const msg of messages) {
      if (msg.received_at) {
        const d = new Date(msg.received_at);
        const h = String(d.getUTCHours()).padStart(2, '0');
        byHour[h] = (byHour[h] || 0) + 1;
        const dow = DOW[d.getUTCDay()];
        byDow[dow] = (byDow[dow] || 0) + 1;
      }
      const key = digits(msg.phone_e164);
      if (key) countByPhone.set(key, (countByPhone.get(key) || 0) + 1);
    }

    const topPosters = Array.from(countByPhone.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({
        name: nameByPhone.get(key) || maskPhone(key),
        message_count: count,
      }));

    const sortedHours = Object.entries(byHour).sort((a, b) => b[1] - a[1]);
    const sortedDays = Object.entries(byDow).sort((a, b) => b[1] - a[1]);

    // 3. Latest group health report -> reconnect shortlist
    const { data: health } = await supabase
      .from('group_health_reports')
      .select('*')
      .eq('group_jid', GROUP_JID)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let reconnectShortlist: any[] = [];
    if (health) {
      const h: any = health;
      const candidate =
        h.reconnect_shortlist ??
        h.report?.reconnect_shortlist ??
        h.report_json?.reconnect_shortlist ??
        h.raw_stats?.reconnect_shortlist ??
        h.data?.reconnect_shortlist ??
        null;
      if (Array.isArray(candidate)) reconnectShortlist = candidate;
    }

    // 4. Last 7 days of daily digests
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: digestRows } = await supabase
      .from('group_engagement_digests')
      .select('digest_date, digest_text')
      .eq('group_jid', GROUP_JID)
      .gte('digest_date', sevenDaysAgo)
      .order('digest_date', { ascending: true });

    // Representative message sample (up to 200, evenly spread across history)
    const sample: string[] = [];
    const total = messages.length;
    const step = total > 200 ? Math.ceil(total / 200) : 1;
    for (let i = 0; i < total; i += step) {
      const msg = messages[i];
      const key = digits(msg.phone_e164);
      const who = (key ? nameByPhone.get(key) : null) || maskPhone(msg.phone_e164);
      const text = (msg.body || msg.body_preview || '(media)').toString().slice(0, 400);
      sample.push(`[${msg.received_at}] ${who}: ${text}`);
      if (sample.length >= 200) break;
    }

    const rawStats = {
      group_name: GROUP_NAME,
      total_messages: total,
      first_message_at: messages[0]?.received_at ?? null,
      last_message_at: messages[total - 1]?.received_at ?? null,
      messages_by_hour_utc: byHour,
      messages_by_day_of_week: byDow,
      top_hours_utc: sortedHours.slice(0, 5),
      top_days: sortedDays.slice(0, 3),
      top_posters: topPosters,
      reconnect_shortlist_count: reconnectShortlist.length,
      recent_digest_days: (digestRows || []).length,
    };

    const weekOf = new Date().toISOString().slice(0, 10);

    let strategyText: string;

    if (total === 0) {
      strategyText = [
        `**What's working**`,
        `No message history is available for ${GROUP_NAME}, so nothing can be assessed yet.`,
        ``,
        `**What's not landing**`,
        `The group has recorded zero messages — the room is effectively silent.`,
        ``,
        `**Best times to post**`,
        `Not enough data. Start with 18:00–20:00 SAST on weekdays and measure.`,
        ``,
        `**Follow-up priority list**`,
        `None available.`,
        ``,
        `**Content plan for next week**`,
        `Post one introduction prompt, one product/testimonial story, and one question post.`,
        ``,
        `**One poll idea**`,
        `"What would you most like to see in this group?" — Product tips / Business training / Success stories`,
      ].join('\n');
    } else {
      const aiKey = Deno.env.get('LOVABLE_API_KEY') || '';
      if (!aiKey) return jsonRes({ error: 'No AI key configured' }, 500);

      const system = `You are a WhatsApp group growth strategist for Vanto CRM (MLM/APLGO).
You write a weekly strategy brief for the group owner. Plain business English, concrete, no fluff.
NEVER invent names, numbers, times or facts that are not in the supplied data.
Time stats supplied are in UTC; South Africa (SAST) is UTC+2 — state times in SAST and say so.
Output markdown with exactly these bold headings:
**What's working**, **What's not landing**, **Best times to post**, **Follow-up priority list**, **Content plan for next week**, **One poll idea**.
"Best times to post" must state concrete days and clock times taken from the supplied hour/day volume data.
"Follow-up priority list" must only use the names in the supplied reconnect shortlist — add no others.
"One poll idea" must be one question plus 2-4 answer options.
Keep the whole brief under 500 words.`;

      const userMsg = `Group: ${GROUP_NAME}
Total messages on record: ${total} (${rawStats.first_message_at} → ${rawStats.last_message_at})

Message volume by hour of day (UTC): ${JSON.stringify(byHour)}
Message volume by day of week: ${JSON.stringify(byDow)}
Busiest hours (UTC, desc): ${JSON.stringify(sortedHours.slice(0, 5))}
Busiest days (desc): ${JSON.stringify(sortedDays.slice(0, 3))}

Top 10 posters: ${JSON.stringify(topPosters)}

Reconnect shortlist (named follow-up candidates, already computed — use these only):
${reconnectShortlist.length ? JSON.stringify(reconnectShortlist).slice(0, 6000) : 'none available'}

Recent daily digests (last 7 days):
${(digestRows || []).map((d: any) => `--- ${d.digest_date} ---\n${d.digest_text}`).join('\n').slice(0, 8000) || 'none'}

Representative historical messages (chronological sample):
${sample.join('\n').slice(0, 20000)}`;

      const r = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.4,
        }),
      });

      if (!r.ok) {
        const errTxt = await r.text();
        if (r.status === 429) return jsonRes({ error: 'rate_limit' }, 429);
        if (r.status === 402) return jsonRes({ error: 'credits_exhausted' }, 402);
        return jsonRes({ error: errTxt }, 502);
      }

      const data = await r.json();
      strategyText = data.choices?.[0]?.message?.content?.trim() || '';
      if (!strategyText) return jsonRes({ error: 'empty_ai_response' }, 502);
    }

    const { data: saved, error: upErr } = await supabase
      .from('group_engagement_strategies')
      .upsert(
        {
          group_jid: GROUP_JID,
          week_of: weekOf,
          strategy_text: strategyText,
          raw_stats: rawStats,
        },
        { onConflict: 'group_jid,week_of' },
      )
      .select('id, week_of')
      .single();
    if (upErr) throw upErr;

    // PLAN nudge for the single super_admin owner
    let taskCreated = false;
    const { data: owners } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'super_admin');

    if (owners && owners.length === 1) {
      const title = `Weekly group strategy ready — ${GROUP_NAME} (${weekOf})`;
      const { data: existing } = await supabase
        .from('plan_tasks')
        .select('id')
        .eq('user_id', owners[0].user_id)
        .eq('title', title)
        .limit(1);
      if (!existing || existing.length === 0) {
        const { error: tErr } = await supabase.from('plan_tasks').insert({
          user_id: owners[0].user_id,
          title,
          priority: 'medium',
          status: 'pending',
          source: 'group-engagement-strategy',
        });
        if (!tErr) taskCreated = true;
      }
    }

    return jsonRes({ ok: true, strategy: saved, task_created: taskCreated, stats: rawStats });
  } catch (e: any) {
    console.error('group-engagement-strategy error', e);
    return jsonRes({ error: e?.message || String(e) }, 500);
  }
});
