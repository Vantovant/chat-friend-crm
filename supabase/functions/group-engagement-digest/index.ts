/**
 * Vanto CRM — group-engagement-digest
 * Once a day, summarises the last 24h of activity in the APLGO | Health and Biz
 * WhatsApp group and stores it in group_engagement_digests.
 *
 * READ-ONLY with respect to WhatsApp: this function never calls maytapi-send-group,
 * maytapi-send-direct or send-message. It only reads group data and writes to
 * group_engagement_digests + plan_tasks.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const GROUP_JID = '120363419298058298@g.us';
const GROUP_NAME = 'APLGO | Health and Biz';

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
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ data: msgs, error: mErr }, { data: members, error: gErr }] = await Promise.all([
      supabase
        .from('maytapi_messages')
        .select('body, body_preview, phone_e164, received_at')
        .eq('conversation_key', GROUP_JID)
        .gt('received_at', since)
        .order('received_at', { ascending: true })
        .limit(1000),
      supabase
        .from('whatsapp_group_members')
        .select('phone_normalized, contact_id, classification')
        .eq('group_jid', GROUP_JID)
        .limit(5000),
    ]);
    if (mErr) throw mErr;
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

    // phone digits -> { name, classification }
    const byPhone = new Map<string, { name: string | null; classification: string }>();
    const classCounts: Record<string, number> = { active: 0, warm: 0, dormant: 0, ghost: 0 };
    for (const m of memberRows as any[]) {
      const cls = (m.classification || 'ghost').toLowerCase();
      classCounts[cls] = (classCounts[cls] || 0) + 1;
      const key = digits(m.phone_normalized);
      if (key) {
        byPhone.set(key, {
          name: m.contact_id ? nameByContactId.get(m.contact_id) ?? null : null,
          classification: cls,
        });
      }
    }

    const messages = (msgs || []) as any[];
    const messageCount = messages.length;

    const posterKeys = new Set<string>();
    const lines: string[] = [];
    for (const msg of messages) {
      const key = digits(msg.phone_e164);
      if (key) posterKeys.add(key);
      const info = key ? byPhone.get(key) : null;
      const who = info?.name || maskPhone(msg.phone_e164);
      const text = (msg.body || msg.body_preview || '(media)').toString().slice(0, 500);
      lines.push(`[${msg.received_at}] ${who}: ${text}`);
    }

    const quietEngaged: string[] = [];
    for (const [key, info] of byPhone.entries()) {
      if (info.classification !== 'active' && info.classification !== 'warm') continue;
      if (posterKeys.has(key)) continue;
      quietEngaged.push(info.name || maskPhone(key));
    }

    const rawStats = {
      group_name: GROUP_NAME,
      window_start: since,
      window_end: new Date().toISOString(),
      message_count: messageCount,
      unique_posters: posterKeys.size,
      member_count: memberRows.length,
      classification_counts: classCounts,
      quiet_engaged_count: quietEngaged.length,
    };

    let digestText: string;

    if (messageCount === 0) {
      digestText = [
        `**Summary**`,
        `No activity in the last 24 hours in ${GROUP_NAME}. Nobody posted in the group during this window.`,
        ``,
        `**Group snapshot**`,
        `- Members: ${memberRows.length}`,
        `- Active: ${classCounts.active || 0}`,
        `- Warm: ${classCounts.warm || 0}`,
        `- Dormant: ${classCounts.dormant || 0}`,
        `- Ghost: ${classCounts.ghost || 0}`,
        ``,
        `**Suggested action for tomorrow**`,
        `Post a light conversation starter or a product/testimonial prompt to re-open the room.`,
      ].join('\n');
    } else {
      const aiKey = Deno.env.get('LOVABLE_API_KEY') || '';
      if (!aiKey) return jsonRes({ error: 'No AI key configured' }, 500);

      const system = `You are an engagement analyst for Vanto CRM (MLM/APLGO WhatsApp CRM).
You write short, practical daily digests of a WhatsApp group's activity for the group owner.
Use plain business English. Be concrete, never invent facts not present in the data.
Output markdown with exactly these sections as bold headings:
**Summary**, **Who posted**, **Topics that came up**, **Needs a human reply**, **Who's gone quiet**, **Suggested action for tomorrow**.
Keep the whole digest under 350 words.`;

      const quietSample = quietEngaged.slice(0, 40);
      const userMsg = `Group: ${GROUP_NAME}
Window: last 24 hours (${since} → now)
Messages: ${messageCount} from ${posterKeys.size} unique senders
Member classification counts: ${JSON.stringify(classCounts)}
Members classified active/warm who did NOT post in this window (${quietEngaged.length} total, sample): ${quietSample.join(', ') || 'none'}

Messages (chronological):
${lines.join('\n').slice(0, 20000)}`;

      const r = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.3,
        }),
      });

      if (!r.ok) {
        const errTxt = await r.text();
        if (r.status === 429) return jsonRes({ error: 'rate_limit' }, 429);
        if (r.status === 402) return jsonRes({ error: 'credits_exhausted' }, 402);
        return jsonRes({ error: errTxt }, 502);
      }

      const data = await r.json();
      digestText = data.choices?.[0]?.message?.content?.trim() || '';
      if (!digestText) return jsonRes({ error: 'empty_ai_response' }, 502);
    }

    const digestDate = new Date().toISOString().slice(0, 10);

    const { data: saved, error: upErr } = await supabase
      .from('group_engagement_digests')
      .upsert(
        {
          group_jid: GROUP_JID,
          digest_date: digestDate,
          message_count: messageCount,
          digest_text: digestText,
          raw_stats: rawStats,
        },
        { onConflict: 'group_jid,digest_date' },
      )
      .select('id, digest_date, message_count')
      .single();
    if (upErr) throw upErr;

    // Daily nudge in the PLAN module — owned by the single super_admin profile,
    // matching the mcp-bridge create_task pattern.
    let taskCreated = false;
    const { data: owners } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'super_admin');


    if (owners && owners.length === 1) {
      const title = `Group digest ready — ${GROUP_NAME} (${digestDate})`;
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
          priority: 'low',
          status: 'pending',
          source: 'group-engagement-digest',
        });
        if (!tErr) taskCreated = true;
      }
    }

    return jsonRes({ ok: true, digest: saved, task_created: taskCreated, stats: rawStats });
  } catch (e: any) {
    console.error('group-engagement-digest error', e);
    return jsonRes({ error: e?.message || String(e) }, 500);
  }
});
