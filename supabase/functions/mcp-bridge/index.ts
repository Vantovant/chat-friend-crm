import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const ALLOWED_GROUPS = [
  'APLGO',
  'APLGO | Health and Biz',
  'APLGO | Health and Biz KZN',
  'APLGO | Health and Biz Global Distributors',
  'APLGO | Health and Biz E&W Cape',
  'APLGO| Health and Biz North West',
  'APLGO 4 SHO',
  'Ascension Bloemfontein',
  '90 day Challenge and FB Campaign',
  'Botswana APLGO Presentations',
  'New Day New Life',
]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const expected = Deno.env.get('MCP_BRIDGE_TOKEN')
  const provided = req.headers.get('x-mcp-token')
  if (!expected || !provided || provided !== expected) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = String(body.action ?? '')

  try {
    switch (action) {
      case 'get_maytapi_status': {
        const keys = ['maytapi_daily_cap', 'maytapi_outbound_frozen', 'reactivation_campaign_enabled']
        const { data: settings, error: sErr } = await supabase
          .from('integration_settings')
          .select('key, value')
          .in('key', keys)
        if (sErr) throw sErr

        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { data: posts, error: pErr } = await supabase
          .from('scheduled_group_posts')
          .select('status')
          .gte('scheduled_at', since)
        if (pErr) throw pErr

        const counts: Record<string, number> = {}
        for (const row of posts ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1

        const settingsMap: Record<string, string | null> = {}
        for (const k of keys) settingsMap[k] = settings?.find((s) => s.key === k)?.value ?? null

        return json({ ok: true, settings: settingsMap, group_posts_last_7_days: counts })
      }

      case 'set_maytapi_cap': {
        const cap = Number(body.cap)
        if (!Number.isInteger(cap) || cap <= 0) return json({ error: 'cap_must_be_positive_integer' }, 400)
        const { error } = await supabase
          .from('integration_settings')
          .upsert({ key: 'maytapi_daily_cap', value: String(cap) }, { onConflict: 'key' })
        if (error) throw error
        return json({ ok: true, maytapi_daily_cap: cap })
      }

      case 'set_maytapi_freeze': {
        if (typeof body.frozen !== 'boolean') return json({ error: 'frozen_must_be_boolean' }, 400)
        const { error } = await supabase
          .from('integration_settings')
          .upsert({ key: 'maytapi_outbound_frozen', value: String(body.frozen) }, { onConflict: 'key' })
        if (error) throw error
        return json({ ok: true, maytapi_outbound_frozen: body.frozen })
      }

      case 'queue_group_post': {
        const groupName = String(body.group_name ?? '')
        const messageContent = String(body.message_content ?? '')
        const scheduledAt = String(body.scheduled_at ?? '')
        const imageUrl = body.image_url ? String(body.image_url) : null

        if (!ALLOWED_GROUPS.includes(groupName)) {
          return json({ error: 'group_not_allowed', message: `"${groupName}" is not one of the 11 approved groups`, allowed: ALLOWED_GROUPS }, 400)
        }
        if (!messageContent.trim()) return json({ error: 'message_content_required' }, 400)
        if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
          return json({ error: 'scheduled_at_must_be_iso_timestamp' }, 400)
        }

        const { data: group, error: gErr } = await supabase
          .from('whatsapp_groups')
          .select('group_jid, user_id')
          .eq('group_name', groupName)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle()
        if (gErr) throw gErr
        if (!group) return json({ error: 'group_not_found_in_whatsapp_groups', group_name: groupName }, 404)

        const { data: inserted, error: iErr } = await supabase
          .from('scheduled_group_posts')
          .insert({
            user_id: group.user_id,
            target_group_name: groupName,
            target_group_jid: group.group_jid,
            message_content: messageContent,
            image_url: imageUrl,
            scheduled_at: new Date(scheduledAt).toISOString(),
            status: 'queued',
            source: 'mcp-bridge',
          })
          .select('id, target_group_name, scheduled_at, status')
          .single()
        if (iErr) throw iErr

        return json({ ok: true, post: inserted })
      }

      case 'get_prospector_status': {
        const { data: states, error: cErr } = await supabase
          .from('prospect_cadence_state')
          .select('status')
        if (cErr) throw cErr
        const counts: Record<string, number> = {}
        for (const row of states ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1

        const { data: upcoming, error: uErr } = await supabase
          .from('prospect_cadence_state')
          .select('id, contact_id, sequence_key, current_step, next_send_at, last_sent_at')
          .eq('status', 'active')
          .not('next_send_at', 'is', null)
          .order('next_send_at', { ascending: true })
          .limit(20)
        if (uErr) throw uErr

        return json({ ok: true, counts_by_status: counts, upcoming_sends: upcoming ?? [] })
      }

      case 'queue_prospector_touch': {
        const contactId = String(body.contact_id ?? '')
        const phone = String(body.phone_normalized ?? '')
        const touchNumber = Number(body.touch_number)
        const messageBody = String(body.message_body ?? '')

        if (!contactId) return json({ error: 'contact_id_required' }, 400)
        if (!phone) return json({ error: 'phone_normalized_required' }, 400)
        if (!Number.isInteger(touchNumber) || touchNumber < 1 || touchNumber > 5) {
          return json({ error: 'touch_number_must_be_1_to_5' }, 400)
        }
        if (!messageBody.trim()) return json({ error: 'message_body_required' }, 400)

        const { data: inserted, error } = await supabase
          .from('prospect_invite_touches')
          .insert({
            contact_id: contactId,
            phone_normalized: phone,
            touch_number: touchNumber,
            stage_days: Number.isInteger(Number(body.stage_days)) ? Number(body.stage_days) : 0,
            message_body: messageBody,
            status: 'queued',
          })
          .select('id, contact_id, touch_number, status, created_at')
          .single()
        if (error) throw error

        return json({ ok: true, touch: inserted })
      }

      default:
        return json({ error: 'unknown_action', action }, 400)
    }
  } catch (e) {
    console.error('mcp-bridge error', action, e)
    return json({ error: 'internal_error', message: (e as Error).message }, 500)
  }
})
