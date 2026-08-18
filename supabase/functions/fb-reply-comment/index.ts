// Posts a reply to a Facebook Page comment via the Graph API.
// Shared by the FacebookInboxModule UI panel and the reply_to_fb_comment MCP tool,
// same pattern as send-message being shared by the chat UI and reply_to_conversation.
// Requires pages_manage_engagement on the Page token — returns Meta's rejection
// verbatim until that permission is granted via App Review.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolvePageToken } from '../_shared/fb-page-token.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Fallback to _NEW: the rotated Page token is stored under META_PAGE_ACCESS_TOKEN_NEW
// (see fb-ingest / fb-poll-fallback / fb-token-health-check for the same pattern).
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') || Deno.env.get('META_PAGE_ACCESS_TOKEN_NEW') || '';
const PAGE_ID = Deno.env.get('META_PAGE_ID') || '102068582816960';
const GRAPH = 'https://graph.facebook.com/v19.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isService = token === SERVICE_ROLE;

    if (!isService) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: claims, error: cErr } = await userClient.auth.getClaims(token);
      if (cErr || !claims?.claims) return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const { fb_comment_id, reply_text } = await req.json();
    if (!fb_comment_id || !reply_text) {
      return json({ ok: false, error: 'fb_comment_id and reply_text required' }, 400);
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Multi-tenant: use the token of the Page that owns this comment. Falls back to
    // the env/admin Page token when the comment's Page has no user connection row.
    const { data: commentRow } = await admin
      .from('fb_comments').select('page_id').eq('fb_comment_id', fb_comment_id).maybeSingle();

    const resolved = await resolvePageToken(admin, commentRow?.page_id ?? PAGE_ID);
    if (!resolved.ok || !resolved.token) {
      console.error('[fb-reply-comment] page token resolution failed', resolved.error);
      return json({
        ok: false,
        stage: 'page_token_resolution',
        page_id: resolved.page_id,
        graph_error: resolved.error,
        error: 'No usable Page access token for this Page. Connect the Page in Settings → Facebook Page.',
      }, 200);
    }

    const r = await fetch(`${GRAPH}/${encodeURIComponent(fb_comment_id)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message: reply_text, access_token: resolved.token }).toString(),
    });
    const body = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error('[fb-reply-comment] graph rejected', body);
      return json({ ok: false, status: r.status, graph_error: body }, 200);
    }

    await admin.from('fb_comments').update({
      replied: true, reply_text, replied_at: new Date().toISOString(),
    }).eq('fb_comment_id', fb_comment_id);

    return json({ ok: true, reply_id: body?.id ?? null }, 200);
  } catch (e) {
    console.error('[fb-reply-comment] exception', e);
    return json({ ok: false, error: String(e) }, 200);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
