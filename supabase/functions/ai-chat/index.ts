/**
 * Vanto CRM — ai-chat Edge Function
 * Hybrid AI routing: Lovable AI primary → OpenAI fallback (from user settings).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const SYSTEM_PROMPT = `You are Vanto AI, the intelligent CRM assistant for Vanto CRM — a WhatsApp-focused CRM for MLM and direct sales teams.

You help users:
- Write perfect follow-up messages for leads at different temperatures (hot, warm, cold)
- Analyze pipeline health and suggest next actions
- Draft WhatsApp campaigns for outreach
- Suggest optimal contact timing based on engagement patterns
- Score leads based on conversation history
- Generate workflow ideas for automating repetitive tasks

Key context:
- Leads have temperature ratings: hot, warm, cold
- Lead types: prospect, registered, buyer, VIP
- Communication is primarily via WhatsApp
- The team uses a shared inbox model
- The CRM integrates with Twilio for WhatsApp Business API

Be concise, actionable, and friendly. Use emojis sparingly. When writing messages for leads, make them feel personal and warm — never robotic. Always provide a clear next step or CTA.`;

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

async function callAI(provider: AIProvider, aiMessages: any[]): Promise<{ ok: true; reply: string } | { ok: false; error: string; status: number }> {
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
      return { ok: false, error: errData, status: response.status };
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'I could not generate a response.';
    return { ok: true, reply };
  } catch (err: any) {
    console.error(`[ai-chat] ${provider.name} exception:`, err.message);
    return { ok: false, error: err.message, status: 500 };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const { messages, context } = body;
  if (!messages || !Array.isArray(messages)) {
    return jsonRes({ error: 'messages array required' }, 400);
  }

  // Build providers list: Lovable AI primary, then user's BYO key as fallback
  const providers: AIProvider[] = [];

  // 1) Always try Lovable AI first
  const lovableKey = Deno.env.get('LOVABLE_API_KEY') || '';
  if (lovableKey) {
    providers.push({
      url: AI_GATEWAY_URL,
      key: lovableKey,
      model: 'google/gemini-3-flash-preview',
      name: 'lovable',
    });
  }

  // 2) Try to load user's BYO key as fallback
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
            providers.push({
              url: OPENAI_URL,
              key: decodedKey,
              model: settings.model || 'gpt-4o-mini',
              name: 'openai',
            });
          } else if (settings.provider === 'gemini') {
            providers.push({
              url: GEMINI_URL,
              key: decodedKey,
              model: settings.model || 'gemini-2.0-flash',
              name: 'gemini',
            });
          }
        }
      }
    } catch (e) {
      console.error('[ai-chat] Failed to load user AI settings:', e);
    }
  }

  if (providers.length === 0) {
    return jsonRes({ error: 'No AI API key configured. Please add your OpenAI or Gemini key in Settings.' }, 500);
  }

  // Build messages
  const systemContent = context
    ? `${SYSTEM_PROMPT}\n\nCurrent CRM Context:\n${context}`
    : SYSTEM_PROMPT;

  const aiMessages = [
    { role: 'system', content: systemContent },
    ...messages.map((m: any) => ({ role: m.role, content: m.content })),
  ];

  // Try each provider in order (Lovable first, then BYO fallback)
  let lastError = '';
  let lastStatus = 500;

  for (const provider of providers) {
    console.log(`[ai-chat] Trying provider: ${provider.name}`);
    const result = await callAI(provider, aiMessages);

    if (result.ok) {
      console.log(`[ai-chat] Success via ${provider.name}`);
      return jsonRes({ reply: result.reply, provider: provider.name });
    }

    lastError = result.error;
    lastStatus = result.status;
    console.warn(`[ai-chat] ${provider.name} failed (${result.status}), trying next...`);
  }

  // All providers failed
  if (lastStatus === 429) {
    return jsonRes({ error: 'Rate limit exceeded on all providers. Please try again later.' }, 429);
  }
  if (lastStatus === 402) {
    return jsonRes({ error: 'Payment required. Please add funds or configure a fallback API key in Settings.' }, 402);
  }

  return jsonRes({ error: `All AI providers failed. Last error: ${lastError}` }, 502);
});
