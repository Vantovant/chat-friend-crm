/**
 * Vanto CRM — ai-chat Edge Function
 * Powers the AI Agent module with real AI responses using Lovable AI Gateway.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { messages, context } = body;
  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'messages array required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Build conversation with system prompt + optional CRM context
  const systemContent = context
    ? `${SYSTEM_PROMPT}\n\nCurrent CRM Context:\n${context}`
    : SYSTEM_PROMPT;

  const aiMessages = [
    { role: 'system', content: systemContent },
    ...messages.map((m: any) => ({ role: m.role, content: m.content })),
  ];

  try {
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: aiMessages,
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errData = await response.text();
      console.error('[ai-chat] Gateway error:', response.status, errData);
      return new Response(JSON.stringify({ error: `AI gateway error [${response.status}]` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'I could not generate a response.';

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[ai-chat] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
