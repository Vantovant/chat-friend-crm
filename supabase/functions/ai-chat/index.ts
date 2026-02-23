/**
 * Vanto CRM — ai-chat Edge Function
 * Powers the AI Agent module with real AI responses.
 * Supports BYO API keys (OpenAI/Gemini) with Lovable AI fallback.
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

  // Try to resolve user's AI settings
  let aiUrl = AI_GATEWAY_URL;
  let aiKey = Deno.env.get('LOVABLE_API_KEY') || '';
  let model = 'google/gemini-3-flash-preview';
  let providerUsed = 'lovable';

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token) {
    try {
      const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      // Get user ID from token
      const anonClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );
      const { data: userData } = await anonClient.auth.getUser(token);

      if (userData?.user) {
        const { data: settings } = await serviceClient
          .from('user_ai_settings')
          .select('*')
          .eq('user_id', userData.user.id)
          .maybeSingle();

        if (settings && settings.is_enabled && settings.provider !== 'lovable' && settings.api_key_encrypted) {
          const decodedKey = atob(settings.api_key_encrypted);
          if (settings.provider === 'openai') {
            aiUrl = OPENAI_URL;
            aiKey = decodedKey;
            model = settings.model || 'gpt-4o-mini';
            providerUsed = 'openai';
          } else if (settings.provider === 'gemini') {
            aiUrl = GEMINI_URL;
            aiKey = decodedKey;
            model = settings.model || 'gemini-2.0-flash';
            providerUsed = 'gemini';
          }
        }
      }
    } catch (e) {
      console.error('[ai-chat] Failed to load user AI settings, using fallback:', e);
    }
  }

  if (!aiKey) {
    return jsonRes({ error: 'No AI API key configured' }, 500);
  }

  const systemContent = context
    ? `${SYSTEM_PROMPT}\n\nCurrent CRM Context:\n${context}`
    : SYSTEM_PROMPT;

  const aiMessages = [
    { role: 'system', content: systemContent },
    ...messages.map((m: any) => ({ role: m.role, content: m.content })),
  ];

  try {
    const response = await fetch(aiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: aiMessages,
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errData = await response.text();
      console.error(`[ai-chat] ${providerUsed} error:`, response.status, errData);

      if (response.status === 429) {
        return jsonRes({ error: 'Rate limit exceeded. Please try again later.' }, 429);
      }
      if (response.status === 402) {
        return jsonRes({ error: 'Payment required. Please add funds to your account.' }, 402);
      }
      if (response.status === 401) {
        return jsonRes({ error: `Invalid ${providerUsed} API key. Please check your settings.` }, 401);
      }

      return jsonRes({ error: `AI error [${response.status}] from ${providerUsed}` }, 502);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'I could not generate a response.';

    return jsonRes({ reply, provider: providerUsed });
  } catch (err: any) {
    console.error('[ai-chat] Error:', err.message);
    return jsonRes({ error: err.message }, 500);
  }
});
