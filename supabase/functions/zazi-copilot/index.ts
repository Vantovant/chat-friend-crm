/**
 * Vanto CRM — zazi-copilot Edge Function
 * Generates Next Best Action + Draft Reply for a conversation.
 * Uses knowledge search for factual grounding + Lovable AI for generation.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const aiKey = Deno.env.get('LOVABLE_API_KEY') || '';
  if (!aiKey) return jsonRes({ error: 'No AI key configured' }, 500);

  let body: any;
  try { body = await req.json(); } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const { conversation_id, action = 'nba' } = body;
  if (!conversation_id) return jsonRes({ error: 'conversation_id required' }, 400);

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Load conversation + contact + recent messages
  const { data: conv } = await serviceClient
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversation_id)
    .single();

  if (!conv) return jsonRes({ error: 'Conversation not found' }, 404);

  const { data: msgs } = await serviceClient
    .from('messages')
    .select('content, is_outbound, created_at')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: false })
    .limit(10);

  const contact = conv.contact as any;
  const recentMsgs = (msgs || []).reverse();
  const lastInbound = recentMsgs.filter((m: any) => !m.is_outbound).pop();

  // Check 24h window
  const lastInboundAt = conv.last_inbound_at ? new Date(conv.last_inbound_at) : null;
  const windowOpen = lastInboundAt ? (Date.now() - lastInboundAt.getTime()) < 24 * 60 * 60 * 1000 : false;

  // Search knowledge if last inbound mentions factual topics
  let knowledgeContext = '';
  let citations: any[] = [];
  
  if (lastInbound?.content) {
    const query = lastInbound.content;
    const { data: searchResults } = await serviceClient.rpc('search_knowledge', {
      query_text: query,
      collection_filter: null,
      max_results: 3,
    });

    if (searchResults && searchResults.length > 0) {
      knowledgeContext = '\n\nRelevant Knowledge Base Sources:\n' +
        searchResults.map((r: any, i: number) => 
          `[Source ${i+1}: ${r.file_title} (${r.file_collection})]\n${r.chunk_text.slice(0, 300)}`
        ).join('\n\n');
      
      citations = searchResults.map((r: any) => ({
        file_id: r.file_id,
        chunk_id: r.chunk_id,
        snippet: r.chunk_text.slice(0, 200),
        relevance_score: r.relevance,
        file_title: r.file_title,
        collection: r.file_collection,
      }));
    }
  }

  const chatHistory = recentMsgs.map((m: any) => 
    `${m.is_outbound ? 'Agent' : contact?.name || 'Contact'}: ${m.content}`
  ).join('\n');

  const systemPrompt = `You are Zazi Copilot, the AI sales assistant for Vanto CRM (MLM / WhatsApp CRM).

Contact: ${contact?.name || 'Unknown'} | Temperature: ${contact?.temperature || 'cold'} | Type: ${contact?.lead_type || 'prospect'} | Interest: ${contact?.interest || 'medium'}
WhatsApp 24h Window: ${windowOpen ? 'OPEN (can send freeform)' : 'CLOSED (template only)'}

Recent conversation:
${chatHistory || '(no messages yet)'}
${knowledgeContext}

You must respond with a JSON object (no markdown fences). The schema depends on action type.`;

  let userPrompt = '';

  if (action === 'nba') {
    userPrompt = `Generate a Next Best Action card. Return JSON:
{
  "lead_type_detected": "buyer|prospect|support|follow_up|cold",
  "interest_detected": "high|medium|low",
  "qualifying_question": "one question to ask",
  "response_type": "menu|short_reply|template|human",
  "cta": "one specific CTA",
  "reasoning": "1-2 sentences why",
  "draft_reply": "the actual WhatsApp message to send",
  "reply_mode": "factual|guidance|motivation",
  "window_status": "${windowOpen ? 'open' : 'closed'}"
}
${!windowOpen ? 'IMPORTANT: Window is closed. response_type MUST be "template" or "human". draft_reply should be an approved template suggestion.' : ''}`;
  } else if (action === 'draft') {
    userPrompt = `Draft a WhatsApp reply to the contact's last message. Return JSON:
{
  "draft_reply": "the WhatsApp message",
  "reply_mode": "factual|guidance|motivation",
  "confidence": 0.0-1.0,
  "reasoning": "why this reply"
}
If knowledge sources were provided and the reply contains factual claims, set reply_mode to "factual".
If no knowledge source covers the claim, set confidence below 0.3 and add a note saying "Not found in knowledge base".`;
  }

  try {
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 800,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[zazi-copilot] AI error:', response.status, errText);
      if (response.status === 429) return jsonRes({ error: 'Rate limit exceeded' }, 429);
      if (response.status === 402) return jsonRes({ error: 'Payment required' }, 402);
      return jsonRes({ error: `AI error [${response.status}]` }, 502);
    }

    const data = await response.json();
    let aiContent = data.choices?.[0]?.message?.content || '{}';
    
    // Strip markdown fences if present
    aiContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed: any;
    try {
      parsed = JSON.parse(aiContent);
    } catch {
      parsed = { draft_reply: aiContent, reply_mode: 'guidance', confidence: 0.5 };
    }

    // Store suggestion
    const { data: suggestion } = await serviceClient
      .from('ai_suggestions')
      .insert({
        conversation_id,
        suggestion_type: action === 'nba' ? 'nba' : 'draft',
        content: parsed,
        confidence: parsed.confidence || 0.5,
        mode: parsed.reply_mode || 'guidance',
        status: 'pending',
      })
      .select('id')
      .single();

    // Store citations if any
    if (suggestion && citations.length > 0) {
      await serviceClient.from('ai_citations').insert(
        citations.map(c => ({
          suggestion_id: suggestion.id,
          file_id: c.file_id,
          chunk_id: c.chunk_id,
          snippet: c.snippet,
          relevance_score: c.relevance_score,
        }))
      );
    }

    // Log to contact_activity
    if (contact?.id) {
      await serviceClient.from('contact_activity').insert({
        contact_id: contact.id,
        type: `zazi_${action}`,
        performed_by: contact.assigned_to || contact.created_by || '00000000-0000-0000-0000-000000000000',
        metadata: {
          suggestion_id: suggestion?.id,
          action,
          lead_type_detected: parsed.lead_type_detected,
          reply_mode: parsed.reply_mode,
          has_citations: citations.length > 0,
        },
      });
    }

    return jsonRes({
      suggestion: parsed,
      suggestion_id: suggestion?.id,
      citations: citations.map(c => ({
        file_title: c.file_title,
        collection: c.collection,
        snippet: c.snippet,
        relevance: c.relevance_score,
      })),
      window_open: windowOpen,
    });
  } catch (err: any) {
    console.error('[zazi-copilot] Error:', err.message);
    return jsonRes({ error: err.message }, 500);
  }
});
