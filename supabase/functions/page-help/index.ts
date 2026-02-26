/**
 * Vanto CRM — page-help Edge Function
 * Returns contextual help for a given page, grounded in Knowledge Vault "general" collection.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

/** Page metadata for fallback when no knowledge docs exist yet */
const PAGE_MANUALS: Record<string, { title: string; description: string; tips: string[] }> = {
  dashboard: {
    title: 'Dashboard',
    description: 'Your command center showing pipeline health, lead temperatures, conversation stats, and weekly performance at a glance.',
    tips: [
      'Check the hot leads count daily — these are your highest-priority contacts.',
      'Monitor unread messages to stay responsive within the 24h WhatsApp window.',
      'Use the temperature breakdown to plan your outreach priorities.',
    ],
  },
  inbox: {
    title: 'Inbox',
    description: 'Real-time WhatsApp conversations with contacts. Send messages, use AI Copilot suggestions, and manage the 24h messaging window.',
    tips: [
      'Click the 🧠 icon to activate Zazi Copilot for AI-powered reply suggestions.',
      'Messages sent outside the 24h window require a pre-approved template.',
      'Star important conversations to keep them at the top.',
    ],
  },
  contacts: {
    title: 'Contacts',
    description: 'Your full contact database with temperature ratings, lead types, and pipeline stage tracking.',
    tips: [
      'Use filters to focus on specific lead types or temperature ratings.',
      'Keep phone numbers in international format (e.g. +225...) for WhatsApp compatibility.',
      'Tag contacts to organize them into campaigns or segments.',
    ],
  },
  crm: {
    title: 'CRM Pipeline',
    description: 'Visual pipeline showing contacts at each sales stage. Drag contacts between stages to track progression.',
    tips: [
      'Move cold leads through stages as they warm up.',
      'Create custom pipeline stages that match your MLM sales process.',
      'Review stuck deals weekly — contacts sitting too long need attention.',
    ],
  },
  automations: {
    title: 'Automations',
    description: 'Set up trigger-based actions that run automatically when conditions are met.',
    tips: [
      'Start with a "welcome new contact" automation for instant engagement.',
      'Use automations for follow-up reminders on warm leads.',
      'Monitor run counts to see which automations are most active.',
    ],
  },
  'ai-agent': {
    title: 'AI Agent',
    description: 'Chat with Vanto AI to get help writing messages, analyzing leads, building campaigns, and generating workflows.',
    tips: [
      'Ask the AI to draft follow-up messages tailored to lead temperature.',
      'Use "Analyze my pipeline" to get AI insights on your sales health.',
      'The AI uses your real CRM data — no generic advice.',
    ],
  },
  knowledge: {
    title: 'Knowledge Vault',
    description: 'Upload and manage documents that ground the AI in real facts — product prices, compensation plans, business opportunity details.',
    tips: [
      'Upload your latest product price list so Zazi quotes accurate prices.',
      'Set expiry dates on seasonal documents to keep data current.',
      'Use the Search tab to verify what the AI will find for a given query.',
    ],
  },
  playbooks: {
    title: 'Playbooks',
    description: 'A library of proven sales scripts and response templates for common scenarios.',
    tips: [
      'Create playbooks for objection handling: price, timing, skepticism.',
      'Mark playbooks as approved so agents can use them confidently.',
      'Track conversion rates to identify your most effective scripts.',
    ],
  },
  workflows: {
    title: 'Workflows',
    description: 'Multi-step automated sequences for onboarding, nurturing, and re-engagement.',
    tips: [
      'Build a 7-day onboarding workflow for new prospects.',
      'Add delays between steps to avoid overwhelming contacts.',
      'Use workflows to re-engage expired leads with fresh offers.',
    ],
  },
  integrations: {
    title: 'Integrations',
    description: 'Connect external services — Twilio WhatsApp, Zazi CRM sync, and webhook configurations.',
    tips: [
      'Verify your Twilio connection with the health check panel.',
      'Test webhooks before enabling sync to avoid data issues.',
      'Use the sync log to monitor data flow between systems.',
    ],
  },
  settings: {
    title: 'Settings',
    description: 'Manage your account, team invitations, AI configuration, auto-reply modes, and API keys.',
    tips: [
      'Set auto-reply to SAFE mode for controlled automated responses.',
      'Invite team members and assign roles (agent, admin, super_admin).',
      'Configure your AI provider fallback in the AI Settings tab.',
    ],
  },
  'api-console': {
    title: 'API Console',
    description: 'Developer tools to test API endpoints, view webhook events, and debug integrations.',
    tips: [
      'Use the console to test webhook payloads before going live.',
      'Monitor recent webhook events for errors or failures.',
      'Check API response times to ensure integrations are healthy.',
    ],
  },
};

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

  const { page, question } = body;
  if (!page) return jsonRes({ error: 'page required' }, 400);

  const manual = PAGE_MANUALS[page] || { title: page, description: 'This page helps you manage your CRM.', tips: [] };

  // If no question, just return the manual
  if (!question) {
    return jsonRes({ manual, ai_answer: null });
  }

  // If question provided, search knowledge vault and use AI
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Search general collection first, then all
  const { data: chunks } = await serviceClient.rpc('search_knowledge', {
    query_text: `${page} ${question}`,
    collection_filter: 'general',
    max_results: 3,
  });

  const knowledgeContext = (chunks || [])
    .map((c: any) => `[${c.file_title}]: ${c.chunk_text}`)
    .join('\n\n');

  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableKey) {
    return jsonRes({ manual, ai_answer: null, note: 'AI not configured' });
  }

  try {
    const aiRes = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `You are Vanto CRM's built-in help assistant. The user is on the "${manual.title}" page.

Page description: ${manual.description}

Tips for this page:
${manual.tips.map((t, i) => `${i + 1}. ${t}`).join('\n')}

${knowledgeContext ? `Relevant knowledge base content:\n${knowledgeContext}` : ''}

Answer the user's question about how to use this page. Be concise, practical, and specific to Vanto CRM. Use bullet points when listing steps.`,
          },
          { role: 'user', content: question },
        ],
        max_tokens: 500,
        temperature: 0.5,
      }),
    });

    if (!aiRes.ok) {
      const status = aiRes.status;
      if (status === 429) return jsonRes({ manual, ai_answer: null, error: 'Rate limited, try again shortly' }, 429);
      if (status === 402) return jsonRes({ manual, ai_answer: null, error: 'AI credits exhausted' }, 402);
      return jsonRes({ manual, ai_answer: null });
    }

    const aiData = await aiRes.json();
    const answer = aiData.choices?.[0]?.message?.content || null;

    return jsonRes({ manual, ai_answer: answer });
  } catch (err: any) {
    console.error('[page-help] AI error:', err.message);
    return jsonRes({ manual, ai_answer: null });
  }
});
