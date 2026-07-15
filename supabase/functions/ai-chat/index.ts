/**
 * Vanto CRM — ai-chat Edge Function (v2)
 * Hybrid AI routing with Knowledge Vault RAG + SSE streaming.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const SYSTEM_PROMPT = `You are **Vanto AI — PhD Partner**, a senior specialist on every module of Vanto CRM, the WhatsApp-first CRM for MLM / APLGO direct-sales teams.

Domains you are expert in (cite specifics when helpful):
- **Contacts**: canonical phone_normalized (+E164, ZA default), partial unique indexes, find-before-upsert, soft-delete only.
- **Lead Types (strict)**: Prospect → Registered_Nopurchase → Purchase_Nostatus → Purchase_Status → Expired. Never invent types.
- **CRM Pipeline**: kanban stages from pipeline_stages; stage_changed events go to contact_activity.
- **Inbox & Conversations**: Twilio outbound (24h Customer Care Window), Maytapi for groups. NEVER recommend headless browser mirroring.
- **Reports**: Lead Call Report (distributors first, longest-waiting next); summaries are generated, notes are operator-written.
- **Workflows & Automations**: kept as SEPARATE modules — never collapse.
- **Group Campaigns**: Maytapi scheduled posts only inside the locked fb_auto_target_groups allowlist, ≥6h spacing.
- **Knowledge Vault**: RAG with knowledge_files + knowledge_chunks (English tsvector), search_knowledge RPC.
- **Zazi Sync**: one-way push to master project nvifliqfgtxqmnkfkhhi.
- **Auth / RLS**: role-based (Agent, Admin, Super Admin) via user_roles + has_role.
- **PLAN module**: plan_tasks, plan_reminders, plan_meetings, plan_notes — scoped per auth.uid().

When operating in **plan_partner mode** (chat from the PLAN page):
- You ALSO act as a personal chief-of-staff / secretary.
- Be concise, prescriptive, and outcome-focused. Bullet > prose.
- When asked for "today's commands", reply with 3 ranked next actions + a one-line reason each.
- Any "do this for me" request must be answered with a confirmation card the user explicitly accepts — never claim you wrote to the database yourself.

General style:
- Use markdown. Bullet lists. No empty fluff.
- Cite Knowledge Vault sources by name when provided.
- Surface real constraints (RLS, 24h WA window, Zazi schema lock) — never hand-wave.
- If unsure, say "I don't know — check X" rather than guess.`;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface AIProvider {
  url: string;
  key: string;
  model: string;
  name: string;
}

async function searchKnowledge(serviceClient: any, query: string) {
  try {
    const { data, error } = await serviceClient.rpc('search_knowledge', {
      query_text: query,
      collection_filter: null,
      max_results: 3,
    });
    if (error || !data?.length) return { context: '', citations: [] };

    const context = '\n\nRelevant Knowledge Base Sources:\n' +
      data.map((r: any, i: number) =>
        `[Source ${i + 1}: ${r.file_title} (${r.file_collection})]\n${r.chunk_text.slice(0, 400)}`
      ).join('\n\n');

    const citations = data.map((r: any) => ({
      file_id: r.file_id,
      chunk_id: r.chunk_id,
      file_title: r.file_title,
      collection: r.file_collection,
      snippet: r.chunk_text.slice(0, 200),
      relevance: r.relevance,
    }));

    return { context, citations };
  } catch (e) {
    console.error('[ai-chat] Knowledge search failed:', e);
    return { context: '', citations: [] };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const { messages, context, stream = false } = body;
  if (!messages || !Array.isArray(messages)) {
    return jsonRes({ error: 'messages array required' }, 400);
  }

  // Build providers list — BYO key takes precedence when configured
  const providers: AIProvider[] = [];
  const byoProviders: AIProvider[] = [];

  const lovableKey = Deno.env.get('LOVABLE_API_KEY') || '';

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token) {
    try {
      const anonClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );
      const { data: userData } = await anonClient.auth.getUser(token);

      if (userData?.user) {
        const serviceClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        const { data: settings } = await serviceClient
          .from('user_ai_settings')
          .select('*')
          .eq('user_id', userData.user.id)
          .maybeSingle();

        if (settings?.is_enabled && settings.api_key_encrypted) {
          const decodedKey = atob(settings.api_key_encrypted);
          if (settings.provider === 'openai') {
            byoProviders.push({ url: OPENAI_URL, key: decodedKey, model: settings.model || 'gpt-4o-mini', name: 'openai' });
          } else if (settings.provider === 'gemini') {
            byoProviders.push({ url: GEMINI_URL, key: decodedKey, model: settings.model || 'gemini-2.0-flash', name: 'gemini' });
          }
        }
      }
    } catch (e) {
      console.error('[ai-chat] Failed to load user AI settings:', e);
    }
  }

  // BYO first (so user's own key is used), Lovable only as fallback
  providers.push(...byoProviders);
  if (lovableKey) {
    providers.push({
      url: AI_GATEWAY_URL,
      key: lovableKey,
      model: 'google/gemini-3-flash-preview',
      name: 'lovable',
    });
  }

  if (providers.length === 0) {
    return jsonRes({ error: 'No AI API key configured. Please add your OpenAI or Gemini key in Settings.' }, 500);
  }

  // Knowledge Vault RAG search on the last user message
  let knowledgeContext = '';
  let citations: any[] = [];

  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
  if (lastUserMsg?.content) {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const result = await searchKnowledge(serviceClient, lastUserMsg.content);
    knowledgeContext = result.context;
    citations = result.citations;
  }

  // Build messages
  let systemContent = context
    ? `${SYSTEM_PROMPT}\n\nCurrent CRM Context:\n${context}`
    : SYSTEM_PROMPT;

  if (knowledgeContext) {
    systemContent += knowledgeContext;
  }

  const aiMessages = [
    { role: 'system', content: systemContent },
    ...messages.map((m: any) => ({ role: m.role, content: m.content })),
  ];

  // --- Streaming path ---
  if (stream) {
    for (const provider of providers) {
      console.log(`[ai-chat] Trying provider (stream): ${provider.name}`);
      try {
        const response = await fetch(provider.url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: provider.model,
            messages: aiMessages,
            max_tokens: 1000,
            temperature: 0.7,
            stream: true,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.warn(`[ai-chat] ${provider.name} stream error:`, response.status, errText);
          if (response.status === 429) return jsonRes({ error: 'Rate limit exceeded. Please try again later.' }, 429);
          if (response.status === 402) return jsonRes({ error: 'Payment required. Please add funds.' }, 402);
          continue;
        }

        // Proxy the SSE stream
        return new Response(response.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Provider': provider.name,
            'X-Citations': JSON.stringify(citations),
          },
        });
      } catch (err: any) {
        console.error(`[ai-chat] ${provider.name} stream exception:`, err.message);
        continue;
      }
    }
    return jsonRes({ error: 'All AI providers failed for streaming.' }, 502);
  }

  // --- Non-streaming path ---
  let lastError = '';
  let lastStatus = 500;

  for (const provider of providers) {
    console.log(`[ai-chat] Trying provider: ${provider.name}`);
    try {
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${provider.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          messages: aiMessages,
          max_tokens: 1000,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errData = await response.text();
        console.error(`[ai-chat] ${provider.name} error:`, response.status, errData);
        lastError = errData;
        lastStatus = response.status;
        continue;
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || 'I could not generate a response.';
      return jsonRes({ reply, provider: provider.name, citations });
    } catch (err: any) {
      console.error(`[ai-chat] ${provider.name} exception:`, err.message);
      lastError = err.message;
      lastStatus = 500;
    }
  }

  if (lastStatus === 429) return jsonRes({ error: 'Rate limit exceeded on all providers. Please try again later.' }, 429);
  if (lastStatus === 402) return jsonRes({ error: 'Payment required. Please add funds or configure a fallback API key in Settings.' }, 402);
  return jsonRes({ error: `All AI providers failed. Last error: ${lastError}` }, 502);
});
