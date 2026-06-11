/**
 * Vanto CRM — crm-ai-partner Edge Function
 * "PhD Partner" mode: WhatsApp-aware retrieval (Twilio inbox + Maytapi groups)
 * + Knowledge Vault + Pipeline + Plan, SSE streaming with retrieval_meta.
 *
 * Coexists alongside the existing `ai-chat` function; never replaces it.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const CHAT_MODEL = 'google/gemini-2.5-flash';
const CONTEXT_CAP = 12000; // ~12 KB cap

// ---------- intent detection ----------
const DAILY_REVIEW_PATTERNS = [
  /\bhow\s+was\s+(?:the\s+)?(?:my\s+)?day\b/i,
  /\bhow\s+(?:did|was)\s+today\b/i,
  /\bwhat\s+(?:was|got)\s+done\s+today\b/i,
  /\btoday['']?s?\s+(?:summary|review|recap|briefing|report|wrap[\-\s]*up)\b/i,
  /\bdaily\s*review\b/i,
  /\bend\s*[\-\s]*of\s*[\-\s]*day\b/i,
  /\b(?:meetings?|tasks?|reminders?|schedule)\s+(?:for\s+)?today\b/i,
];
const INBOX_ONLY_PATTERNS = [
  /\b(?:whats?app|wa|inbox|chat|conversation)s?\b.*\b(?:today|recent|latest|summari[sz]e|summary|review)\b/i,
  /\bsummari[sz]e\s+(?:my\s+)?(?:whats?app|inbox|chats|conversations)\b/i,
  /\bwhats?app\s+(?:inbox|messages|chats|today)\b/i,
  /\bmaytapi\b/i,
  /\bgroup\s+(?:chat|messages|activity)\b/i,
];
const TRAINER_PATTERNS = [
  /\bai\s+trainer\b/i,
  /\btrainer\s+rules?\b/i,
  /\bcorrections?\b/i,
];

function detectMode(prompt: string, tags: string[], isAdmin: boolean) {
  if (tags.includes('@trainer') && isAdmin) return 'trainer' as const;
  if (tags.includes('@inbox') || tags.includes('@twilio') || tags.includes('@maytapi')) return 'inbox_only' as const;
  if (DAILY_REVIEW_PATTERNS.some((rx) => rx.test(prompt))) return 'daily_review' as const;
  if (INBOX_ONLY_PATTERNS.some((rx) => rx.test(prompt))) return 'inbox_only' as const;
  if (isAdmin && TRAINER_PATTERNS.some((rx) => rx.test(prompt))) return 'trainer' as const;
  return 'crm_strategist' as const;
}

// Which inbox sources to load. Default = BOTH. Only explicit @twilio / @maytapi tags narrow scope.
// Plain prompt keywords like "twilio" or "maytapi" do NOT narrow — both inboxes stay loaded so
// the agent can answer follow-up questions about either source.
function detectInboxScope(_prompt: string, tags: string[]): { twilio: boolean; maytapi: boolean } {
  const onlyTwilio = tags.includes('@twilio') && !tags.includes('@maytapi');
  const onlyMaytapi = tags.includes('@maytapi') && !tags.includes('@twilio');
  if (onlyTwilio) return { twilio: true, maytapi: false };
  if (onlyMaytapi) return { twilio: false, maytapi: true };
  return { twilio: true, maytapi: true };
}

// ---------- PII redaction ----------
function redact(s: string): string {
  if (!s) return '';
  return s
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[phone]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
}

// ---------- tag parsing ----------
const TAG_REGEX = /@[a-z_]+(?::[^\s]+)?/gi;
function parseTags(prompt: string): { cleaned: string; tags: string[] } {
  const tags = (prompt.match(TAG_REGEX) || []).map((t) => t.toLowerCase());
  const cleaned = prompt.replace(TAG_REGEX, '').replace(/\s+/g, ' ').trim();
  return { cleaned, tags };
}

// ---------- system prompt ----------
const SYSTEM_PROMPT = `You are the **Chief CRM Strategist for Vanto CRM** — a persistent AI co-founder for an MLM/WhatsApp-first APLGO sales operation.

Operating rules:
1. Cross-reference contacts, pipeline stages, inbox conversations (Twilio 1:1), Maytapi group messages, knowledge vault, AI trainer rules, and Master Prospector activity.
2. Never propose actions that violate the WhatsApp 24h Customer Care Window.
3. Never bypass RLS or surface another agent's private data.
4. Never invent contact names, phone numbers, or message content. If a fact is not in the retrieved context, say so.
5. Translate technical surfaces (RLS, Maytapi allowlist, Zazi schema lock) into plain operator language.
6. Strict lead types: Prospect → Registered_Nopurchase → Purchase_Nostatus → Purchase_Status → Expired.
7. Use markdown with bullets and short headings. Be concise and prescriptive.
8. When citing WhatsApp messages, quote them briefly and tag the channel: (Twilio) or (Maytapi).
9. When recommending outbound messages, draft them in operator voice ("Get Well Africa" / APLGO).
10. For group campaigns, respect the locked allowlist and 6h spacing rule.
11. If knowledge vault docs are cited in the context, reference them by title.
12. When asked for "today" / "what's happening", cross-reference inbox + maytapi + plan tasks + reminders.
13. If unsure, say "I don't know — check X" rather than guess.`;

const DAILY_REVIEW_SUPPLEMENT = `

Output STRICT structure for today's review:
**Day Summary** — 2 lines
**Wins** — bullets
**Progress** — bullets
**Improvements / Misses** — bullets
**Risks** — bullets
**Tomorrow** — 3 ranked actions`;

const INBOX_ONLY_SUPPLEMENT = `

You are in **Inbox-Only Mode**. Only the WhatsApp inbox sources explicitly loaded below are available.
STRICT SOURCE RULES:
- The "Twilio WhatsApp inbox" section ONLY contains Twilio 1:1 messages (provider=twilio). Tag those as (Twilio).
- The "Maytapi WhatsApp messages" section ONLY contains Maytapi messages. Tag those as (Maytapi).
- NEVER relabel a Maytapi message as Twilio or vice versa. The section heading IS the source of truth.
- If the user asks about Twilio and the Twilio section is empty or missing, say "No Twilio messages in the loaded window" — do NOT substitute Maytapi data.
- If only one source is loaded (per scope), do not claim data from the other source exists.`;

// ---------- retrieval ----------
async function retrieveAll(
  admin: any,
  userId: string,
  prompt: string,
  mode: string,
  isAdmin: boolean,
  scope: { twilio: boolean; maytapi: boolean },
) {
  const sources: string[] = [];
  const sections: string[] = [];
  const meta: any = {
    retrieval_type: 'portfolio_general',
    data_sources: [],
    docs_used: [],
    missing_docs: [],
    inbox_scope: scope,
  };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // INBOX-ONLY: skip everything except WhatsApp sources
  const skipMost = mode === 'inbox_only';

  const tasks: Promise<void>[] = [];

  // 1. Twilio inbox messages — STRICTLY provider='twilio'
  if (scope.twilio) {
    tasks.push(
      (async () => {
        const limit = mode === 'daily_review' ? 60 : 80;
        const { data, error } = await admin
          .from('messages')
          .select('id, content, is_outbound, status, created_at, provider, conversation_id, conversations:conversation_id(contact_id, last_message_at, contacts:contact_id(name, phone_normalized, lead_type))')
          .eq('provider', 'twilio')
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error || !data?.length) {
          if (error) console.error('[crm-ai-partner] twilio query error', error);
          return;
        }
        const lines = data
          .filter((m: any) => m.content)
          .map((m: any) => {
            const c = m.conversations?.contacts;
            const who = c?.name || c?.phone_normalized || 'unknown';
            const dir = m.is_outbound ? 'AGENT→' : '→PROSPECT';
            const ts = new Date(m.created_at).toISOString().slice(5, 16).replace('T', ' ');
            return `[${ts}] ${dir} ${redact(who)} (Twilio): ${redact(String(m.content).slice(0, 220))}`;
          });
        if (lines.length) {
          sections.push(`## Twilio WhatsApp inbox (last ${lines.length}, provider=twilio ONLY)\n${lines.join('\n')}`);
          sources.push('twilio_inbox');
        } else {
          sections.push(`## Twilio WhatsApp inbox\n(no Twilio messages found)`);
        }
      })(),
    );
  }

  // 2. Maytapi messages — from messages table (provider='maytapi') + maytapi_messages
  if (scope.maytapi) {
    tasks.push(
      (async () => {
        const limit = mode === 'daily_review' ? 60 : 80;
        // Prefer dedicated maytapi_messages table
        const { data: mt } = await admin
          .from('maytapi_messages')
          .select('id, body, direction, received_at, phone_e164, conversation_key, contact_id, contacts:contact_id(name)')
          .order('received_at', { ascending: false })
          .limit(limit);
        const lines: string[] = [];
        if (mt?.length) {
          for (const m of mt) {
            if (!m.body) continue;
            const name = m.contacts?.name || m.phone_e164 || m.conversation_key || 'unknown';
            const dir = m.direction === 'out' ? 'AGENT→' : '→PROSPECT';
            const ts = m.received_at ? new Date(m.received_at).toISOString().slice(5, 16).replace('T', ' ') : '?';
            lines.push(`[${ts}] ${dir} ${redact(name)} (Maytapi): ${redact(String(m.body).slice(0, 220))}`);
          }
        }
        if (lines.length) {
          sections.push(`## Maytapi WhatsApp messages (last ${lines.length})\n${lines.join('\n')}`);
          sources.push('maytapi');
        }
      })(),
    );
  }


  if (!skipMost) {
    // 3. Conversation overview (active + unread)
    tasks.push(
      (async () => {
        const { data } = await admin
          .from('conversations')
          .select('id, status, unread_count, last_message, last_message_at, contacts:contact_id(name, phone_normalized, lead_type, temperature)')
          .order('last_message_at', { ascending: false })
          .limit(30);
        if (!data?.length) return;
        const active = data.filter((c: any) => c.status === 'active').length;
        const unread = data.reduce((s: number, c: any) => s + (c.unread_count || 0), 0);
        const lines = data.slice(0, 15).map((c: any) => {
          const n = c.contacts?.name || c.contacts?.phone_normalized || 'unknown';
          return `- ${redact(n)} [${c.contacts?.lead_type || '?'}, ${c.contacts?.temperature || '?'}] unread=${c.unread_count || 0} • "${redact(String(c.last_message || '').slice(0, 100))}"`;
        });
        sections.push(`## Conversation overview (active=${active}, unread=${unread})\n${lines.join('\n')}`);
        sources.push('conversations');
      })(),
    );

    // 4. Pipeline snapshot
    tasks.push(
      (async () => {
        const [{ data: stages }, { data: contacts }] = await Promise.all([
          admin.from('pipeline_stages').select('id, name, stage_order').order('stage_order'),
          admin.from('contacts').select('stage_id, lead_type').eq('is_deleted', false),
        ]);
        if (!stages?.length) return;
        const counts: Record<string, number> = {};
        const byType: Record<string, number> = {};
        for (const c of contacts || []) {
          if (c.stage_id) counts[c.stage_id] = (counts[c.stage_id] || 0) + 1;
          if (c.lead_type) byType[c.lead_type] = (byType[c.lead_type] || 0) + 1;
        }
        const stageLines = stages.map((s: any) => `- ${s.name}: ${counts[s.id] || 0}`);
        const typeLines = Object.entries(byType).map(([k, v]) => `- ${k}: ${v}`);
        sections.push(`## Pipeline snapshot\n${stageLines.join('\n')}\n\n**By lead type:**\n${typeLines.join('\n')}`);
        sources.push('pipeline');
      })(),

    // 4b. Recently amended contact notes — so the agent can answer "how many notes have I updated"
    tasks.push(
      (async () => {
        const since = new Date(Date.now() - 7 * 86400e3).toISOString();
        const { data, error } = await admin
          .from('contacts')
          .select('name, phone_normalized, lead_type, notes, updated_at')
          .eq('is_deleted', false)
          .not('notes', 'is', null)
          .neq('notes', '')
          .gte('updated_at', since)
          .order('updated_at', { ascending: false })
          .limit(40);
        if (error) { console.error('[crm-ai-partner] contacts notes error', error); return; }
        if (!data?.length) return;
        const lines = data.map((c: any) => {
          const who = c.name || c.phone_normalized || 'unknown';
          const ts = c.updated_at ? new Date(c.updated_at).toISOString().slice(0, 16).replace('T', ' ') : '?';
          const note = String(c.notes || '').replace(/\s+/g, ' ').slice(0, 220);
          return `- [${ts}] ${redact(who)} [${c.lead_type || '?'}]: ${redact(note)}`;
        });
        sections.push(`## Recently amended contact notes (last 7d, ${data.length} contacts)\n${lines.join('\n')}`);
        sources.push('contact_notes');
      })(),
    );


    // 5. Pending Master Prospector drafts
    tasks.push(
      (async () => {
        const { data } = await admin
          .from('ai_suggestions')
          .select('id, suggestion_type, content, confidence, status, created_at')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(10);
        if (!data?.length) return;
        const lines = data.map((s: any) => `- [${s.suggestion_type} • conf=${s.confidence?.toFixed?.(2) ?? '?'}] ${redact(JSON.stringify(s.content || {}).slice(0, 160))}`);
        sections.push(`## Pending AI suggestions (${data.length})\n${lines.join('\n')}`);
        sources.push('ai_suggestions');
      })(),
    );

    // 6. Plan tasks (open) + reminders + meetings (today/this week)
    tasks.push(
      (async () => {
        const weekAhead = new Date(Date.now() + 7 * 86400e3).toISOString();
        const [{ data: tasksRow }, { data: reminders }, { data: meetings }] = await Promise.all([
          admin.from('plan_tasks').select('title, priority, status, due_at').eq('user_id', userId).neq('status', 'done').order('due_at', { ascending: true, nullsFirst: false }).limit(15),
          admin.from('plan_reminders').select('title, remind_at, status').eq('user_id', userId).neq('status', 'done').order('remind_at').limit(10),
          admin.from('plan_meetings').select('title, starts_at, location').eq('user_id', userId).gte('starts_at', new Date().toISOString()).lte('starts_at', weekAhead).order('starts_at').limit(10),
        ]);
        const parts: string[] = [];
        if (tasksRow?.length) parts.push(`**Open tasks:**\n${tasksRow.map((t: any) => `- [${t.priority || 'med'}] ${t.title} (due ${t.due_at ? t.due_at.slice(0, 10) : '—'})`).join('\n')}`);
        if (reminders?.length) parts.push(`**Reminders:**\n${reminders.map((r: any) => `- ${r.title} @ ${r.remind_at ? r.remind_at.slice(0, 16).replace('T', ' ') : '—'}`).join('\n')}`);
        if (meetings?.length) parts.push(`**Meetings (next 7d):**\n${meetings.map((m: any) => `- ${m.title} @ ${m.starts_at?.slice(0, 16).replace('T', ' ')}${m.location ? ' • ' + m.location : ''}`).join('\n')}`);
        if (parts.length) {
          sections.push(`## PLAN module\n${parts.join('\n\n')}`);
          sources.push('plan');
        }
      })(),
    );

    // 7. Lead call summaries (recent)
    tasks.push(
      (async () => {
        const { data } = await admin
          .from('lead_call_summaries')
          .select('contact_id, summary, last_message_at, contacts:contact_id(name)')
          .order('generated_at', { ascending: false })
          .limit(8);
        if (!data?.length) return;
        const lines = data.map((s: any) => {
          const n = s.contacts?.name || 'unknown';
          const sum = s.summary?.summary_text || s.summary?.intent || '';
          return `- ${redact(n)}: ${redact(String(sum).slice(0, 180))}`;
        });
        sections.push(`## Recent lead call summaries\n${lines.join('\n')}`);
        sources.push('lead_summaries');
      })(),
    );

    // 8. Knowledge vault RAG
    tasks.push(
      (async () => {
        try {
          const { data } = await admin.rpc('search_knowledge', {
            query_text: prompt,
            collection_filter: null,
            max_results: 4,
          });
          if (!data?.length) return;
          const lines = data.map((r: any, i: number) => `[Source ${i + 1}: ${r.file_title} (${r.file_collection})]\n${String(r.chunk_text).slice(0, 350)}`);
          sections.push(`## Knowledge Vault\n${lines.join('\n\n')}`);
          sources.push('knowledge_base');
          meta.docs_used = data.map((r: any) => ({ id: r.file_id, title: r.file_title, source_mode: 'chunks' }));
        } catch { /* ignore */ }
      })(),
    );

    // 9. Trainer rules (admin only)
    if (mode === 'trainer' || isAdmin) {
      tasks.push(
        (async () => {
          const { data } = await admin
            .from('ai_trainer_rules')
            .select('title, intent, response, enabled, priority')
            .eq('enabled', true)
            .order('priority', { ascending: false })
            .limit(15);
          if (!data?.length) return;
          const lines = data.map((r: any) => `- [${r.intent || '?'}] ${r.title}`);
          sections.push(`## Active AI Trainer rules\n${lines.join('\n')}`);
          sources.push('ai_trainer');
        })(),
      );
    }
  }

  await Promise.all(tasks);

  meta.data_sources = sources;
  if (mode === 'daily_review') meta.is_daily_review = true;
  if (mode === 'inbox_only') meta.is_inbox_only = true;
  if (mode === 'trainer') meta.is_trainer_mode = true;

  let context = sections.join('\n\n');
  if (context.length > CONTEXT_CAP) context = context.slice(0, CONTEXT_CAP) + '\n…[truncated]';
  return { context, meta };
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400); }

  const { messages, thread_id, stream = true } = body;
  if (!Array.isArray(messages) || messages.length === 0) return jsonRes({ error: 'messages required' }, 400);

  // Auth
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return jsonRes({ error: 'Unauthorized' }, 401);

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData?.user) return jsonRes({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // role check
  const { data: roleRow } = await admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle();
  const isAdmin = roleRow?.role === 'admin' || roleRow?.role === 'super_admin';

  const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
  const rawPrompt = String(lastUser?.content || '');
  const { cleaned, tags } = parseTags(rawPrompt);
  const mode = detectMode(cleaned || rawPrompt, tags, isAdmin);
  const scope = detectInboxScope(cleaned || rawPrompt, tags);

  console.log(`[crm-ai-partner] user=${userId} mode=${mode} tags=${JSON.stringify(tags)} scope=${JSON.stringify(scope)}`);

  // Retrieve
  const { context, meta } = await retrieveAll(admin, userId, cleaned || rawPrompt, mode, isAdmin, scope);

  let systemContent = SYSTEM_PROMPT;
  if (mode === 'daily_review') systemContent += DAILY_REVIEW_SUPPLEMENT;
  if (mode === 'inbox_only') systemContent += INBOX_ONLY_SUPPLEMENT;
  if (context) systemContent += `\n\n---\n# Live CRM Context (mode=${mode})\n${context}`;

  const aiMessages = [
    { role: 'system', content: systemContent },
    ...messages.slice(-20).map((m: any) => ({ role: m.role, content: String(m.content || '') })),
  ];

  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableKey) return jsonRes({ error: 'LOVABLE_API_KEY missing' }, 500);

  // ---- Streaming ----
  if (stream) {
    const upstream = await fetch(AI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CHAT_MODEL, messages: aiMessages, temperature: 0.6, stream: true, max_tokens: 1400 }),
    });

    if (!upstream.ok) {
      const t = await upstream.text();
      console.error('[crm-ai-partner] upstream error', upstream.status, t);
      if (upstream.status === 429) return jsonRes({ error: 'Rate limited. Try again shortly.' }, 429);
      if (upstream.status === 402) return jsonRes({ error: 'AI credits exhausted. Top up workspace credits.' }, 402);
      return jsonRes({ error: 'AI unavailable' }, 502);
    }

    // Transform OpenAI-style SSE -> {type:"text"} frames, then emit retrieval_meta + [DONE]
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buf = '';
    let assistantBuf = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              const l = line.trim();
              if (!l.startsWith('data:')) continue;
              const payload = l.slice(5).trim();
              if (payload === '[DONE]') continue;
              try {
                const j = JSON.parse(payload);
                const delta = j.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta.length) {
                  assistantBuf += delta;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: delta })}\n\n`));
                }
              } catch { /* ignore */ }
            }
          }
          // final retrieval_meta
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'retrieval_meta', data: meta })}\n\n`));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));

          // persist assistant message if thread_id given
          if (thread_id && assistantBuf) {
            await admin.from('crm_partner_messages').insert({
              thread_id, user_id: userId, role: 'assistant',
              content: assistantBuf, retrieval_meta: meta,
            });
            await admin.from('crm_partner_threads').update({ last_message_at: new Date().toISOString() }).eq('id', thread_id).eq('user_id', userId);
          }
        } catch (e) {
          console.error('[crm-ai-partner] stream error', e);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'stream_failed' })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  // ---- Non-streaming ----
  const r = await fetch(AI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, messages: aiMessages, temperature: 0.6, max_tokens: 1400 }),
  });
  if (!r.ok) {
    if (r.status === 429) return jsonRes({ error: 'Rate limited' }, 429);
    if (r.status === 402) return jsonRes({ error: 'Credits exhausted' }, 402);
    return jsonRes({ error: 'AI unavailable' }, 502);
  }
  const data = await r.json();
  const reply = data.choices?.[0]?.message?.content || '';
  if (thread_id && reply) {
    await admin.from('crm_partner_messages').insert({
      thread_id, user_id: userId, role: 'assistant', content: reply, retrieval_meta: meta,
    });
    await admin.from('crm_partner_threads').update({ last_message_at: new Date().toISOString() }).eq('id', thread_id).eq('user_id', userId);
  }
  return jsonRes({ mode, result: { content: reply, retrieval_meta: meta }, context_len: context.length });
});
