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

function mapLeadType(val: string): 'prospect' | 'registered' | 'buyer' | 'vip' {
  const v = (val || '').toLowerCase()
  if (v === 'registered') return 'registered'
  if (v === 'buyer') return 'buyer'
  if (v === 'vip') return 'vip'
  return 'prospect'
}

function mapTemperature(val: string): 'hot' | 'warm' | 'cold' {
  const v = (val || '').toLowerCase()
  if (v === 'hot') return 'hot'
  if (v === 'warm') return 'warm'
  return 'cold'
}

// Validates a YYYY-MM-DD string and returns [startOfDayISO, endOfDayISO] in UTC.
// Used by the list_* actions for single-day filtering.
function dayBounds(date: string): [string, string] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return [`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`]
}

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

  const ACTIONS = [
    'list_actions',
    'get_maytapi_status',
    'get_dispatch_policy',
    'set_maytapi_cap',
    'set_maytapi_freeze',
    'queue_group_post',
    'get_prospector_status',
    'queue_prospector_touch',
    'list_contacts',
    'get_contact',
    'update_contact',
    'add_contact_note',
    'create_task',
    'list_tasks',
    'complete_task',
    'delete_task',
    'create_reminder',
    'list_reminders',
    'complete_reminder',
    'delete_reminder',
    'create_meeting',
    'list_meetings',
    'delete_meeting',
    'create_diary_entry',
  ]

  // Resolves the single super_admin profile row. This bridge authenticates via a
  // shared service-role token, not a per-user login, so any action that writes to
  // per-user-scoped tables (plan_tasks, plan_reminders, plan_meetings,
  // voice_diary_entries) needs to know which profile owns the new row. This is a
  // single-operator system with exactly one super_admin, so we resolve it dynamically
  // instead of hardcoding a UUID. Fails loudly (rather than guessing) if that
  // assumption ever stops holding.
  async function resolveOwnerId(): Promise<{ ownerId: string } | { errorResponse: Response }> {
    const { data: owners, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'super_admin')
    if (error) throw error
    if (!owners || owners.length === 0) {
      return { errorResponse: json({ error: 'no_super_admin_found' }, 500) }
    }
    if (owners.length > 1) {
      return { errorResponse: json({ error: 'multiple_super_admins_found', count: owners.length }, 500) }
    }
    return { ownerId: owners[0].id }
  }

  try {
    switch (action) {
      case 'list_actions':
        return json({ ok: true, actions: ACTIONS, bridge_version: '2026-08-13' })

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

      case 'get_dispatch_policy': {
        await supabase.from('integration_settings').upsert([
          { key: 'maytapi_min_inter_send_sec', value: '90' },
          { key: 'maytapi_hourly_cap', value: '12' },
          { key: 'maytapi_max_per_invocation', value: '1' },
        ], { onConflict: 'key' })

        const policyKeys = [
          'maytapi_daily_cap',
          'maytapi_outbound_frozen',
          'maytapi_freeze_until_at',
          'maytapi_min_inter_send_sec',
          'maytapi_hourly_cap',
          'maytapi_max_per_invocation',
        ]
        const { data: settings, error: sErr } = await supabase
          .from('integration_settings')
          .select('key, value')
          .in('key', policyKeys)
        if (sErr) throw sErr

        const get = (key: string, fallback: string) =>
          settings?.find((s: any) => s.key === key)?.value ?? fallback

        return json({
          ok: true,
          policy: {
            cron_interval_minutes: 5,
            cron_job_name: 'maytapi-send-group-poll',
            dispatch_guardrails: {
              min_inter_send_sec: Number(get('maytapi_min_inter_send_sec', '90')),
              hourly_cap: Number(get('maytapi_hourly_cap', '12')),
              max_per_invocation: Number(get('maytapi_max_per_invocation', '1')),
            },
            daily_cap: Number(get('maytapi_daily_cap', '56')),
            outbound_frozen: get('maytapi_outbound_frozen', 'false').toLowerCase() === 'true',
            freeze_until: get('maytapi_freeze_until_at', null),
            approved_groups: ALLOWED_GROUPS,
            standing_rules: [
              'Dispatcher runs every 5 minutes (cron job: maytapi-send-group-poll).',
              'It processes at most 1 pending post per invocation.',
              'An 11-group wave therefore takes ~50-55 minutes to clear.',
              'Schedule the final wave to start 60-70 minutes before any time-sensitive event.',
              'Use event-time phrasing ("TONIGHT 7PM") rather than tight countdowns ("15 min left").',
              'Group posts MUST be inserted with status = "pending"; status = "queued" is ignored.',
            ],
            incident_history: [
              '2026-06-27: Burst-sending 11 groups in ~3 seconds triggered a WhatsApp 24-hour restriction.',
              '2026-07-23: Combined suite WhatsApp volume exceeded safe limits; suite-wide 24h freeze applied.',
              '2026-08-06: An 18:45 "15 minutes" wave landed at ~19:35 because of the 5-minute cron drift.',
            ],
            note_for_automation: 'These numbers are now stored in integration_settings and read by the dispatcher at runtime. You can query them directly via SQL or through this endpoint.',
          },
        })
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
            status: 'pending',
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

      case 'list_contacts': {
        const leadType = body.lead_type ? String(body.lead_type) : null
        const temperature = body.temperature ? String(body.temperature) : null
        const tag = body.tag ? String(body.tag) : null
        const search = body.search ? String(body.search) : null
        const limit = Number.isInteger(Number(body.limit)) && Number(body.limit) > 0
          ? Math.min(Number(body.limit), 100) : 25

        let query = supabase.from('contacts')
          .select('id, name, phone_normalized, email, lead_type, temperature, tags, notes, do_not_contact, updated_at')
          .eq('is_deleted', false)
          .order('updated_at', { ascending: false })
          .limit(limit)
        if (leadType) query = query.eq('lead_type', leadType)
        if (temperature) query = query.eq('temperature', temperature)
        if (tag) query = query.contains('tags', [tag])
        if (search) query = query.or(`name.ilike.%${search}%,phone_normalized.ilike.%${search}%`)

        const { data, error } = await query
        if (error) throw error
        return json({ ok: true, count: data?.length ?? 0, contacts: data ?? [] })
      }

      case 'get_contact': {
        const contactId = body.contact_id ? String(body.contact_id) : null
        const phone = body.phone_normalized ? String(body.phone_normalized) : null
        if (!contactId && !phone) return json({ error: 'contact_id_or_phone_normalized_required' }, 400)

        let query = supabase.from('contacts').select('*').eq('is_deleted', false).limit(1)
        query = contactId ? query.eq('id', contactId) : query.eq('phone_normalized', phone)
        const { data: contact, error } = await query.maybeSingle()
        if (error) throw error
        if (!contact) return json({ error: 'contact_not_found' }, 404)

        const { data: recentActivity } = await supabase
          .from('contact_activity')
          .select('type, metadata, created_at')
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false })
          .limit(10)

        return json({ ok: true, contact, recent_activity: recentActivity ?? [] })
      }

      case 'update_contact': {
        const contactId = String(body.contact_id ?? '')
        if (!contactId) return json({ error: 'contact_id_required' }, 400)

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (body.name !== undefined) updates.name = String(body.name).trim()
        if (body.email !== undefined) updates.email = body.email ? String(body.email).trim() : null
        if (body.lead_type !== undefined) updates.lead_type = mapLeadType(String(body.lead_type))
        if (body.temperature !== undefined) updates.temperature = mapTemperature(String(body.temperature))
        if (body.tags !== undefined) updates.tags = Array.isArray(body.tags) ? body.tags : []
        if (body.do_not_contact !== undefined) updates.do_not_contact = Boolean(body.do_not_contact)
        if (Object.keys(updates).length === 1) return json({ error: 'no_updatable_fields_provided' }, 400)

        const { data, error } = await supabase
          .from('contacts')
          .update(updates)
          .eq('id', contactId)
          .eq('is_deleted', false)
          .select('id, name, phone_normalized, email, lead_type, temperature, tags, do_not_contact, updated_at')
          .single()
        if (error) throw error
        return json({ ok: true, contact: data })
      }

      case 'add_contact_note': {
        const contactId = String(body.contact_id ?? '')
        const noteText = String(body.note ?? '').trim()
        if (!contactId) return json({ error: 'contact_id_required' }, 400)
        if (!noteText) return json({ error: 'note_required' }, 400)

        const { data: existing, error: fetchErr } = await supabase
          .from('contacts')
          .select('notes')
          .eq('id', contactId)
          .eq('is_deleted', false)
          .maybeSingle()
        if (fetchErr) throw fetchErr
        if (!existing) return json({ error: 'contact_not_found' }, 404)

        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
        const appended = existing.notes
          ? `${existing.notes}\n\n[${stamp} · via MCP] ${noteText}`
          : `[${stamp} · via MCP] ${noteText}`

        const { data: updated, error: updateErr } = await supabase
          .from('contacts')
          .update({ notes: appended, updated_at: new Date().toISOString() })
          .eq('id', contactId)
          .select('id, notes')
          .single()
        if (updateErr) throw updateErr

        await supabase.from('contact_activity').insert({
          contact_id: contactId,
          type: 'note_added',
          performed_by: '00000000-0000-0000-0000-000000000000',
          metadata: { source: 'mcp-bridge', note_preview: noteText.slice(0, 160) },
        })
        return json({ ok: true, contact_id: contactId, notes: updated.notes })
      }

      case 'create_task': {
        const title = String(body.title ?? '').trim()
        if (!title) return json({ error: 'title_required' }, 400)
        const priority = ['low', 'medium', 'high', 'urgent'].includes(String(body.priority))
          ? String(body.priority) : 'medium'
        const dueDate = body.due_date ? String(body.due_date) : null
        if (dueDate && Number.isNaN(Date.parse(dueDate))) {
          return json({ error: 'due_date_must_be_iso_timestamp' }, 400)
        }

        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const payload: Record<string, unknown> = {
          user_id: resolved.ownerId,
          title,
          priority,
          source: 'mcp',
        }
        if (dueDate) payload.due_date = new Date(dueDate).toISOString()

        const { data: inserted, error } = await supabase
          .from('plan_tasks')
          .insert(payload)
          .select('id, title, priority, due_date, created_at')
          .single()
        if (error) throw error
        return json({ ok: true, task: inserted })
      }

      // NEW: list_tasks — read-only. Filter by status and/or a single
      // calendar day (matches due_date). Scoped to the resolved super_admin.
      case 'list_tasks': {
        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const status = body.status ? String(body.status) : null
        const dateStr = body.date ? String(body.date) : null
        const limit = Number.isInteger(Number(body.limit)) && Number(body.limit) > 0
          ? Math.min(Number(body.limit), 100) : 50

        let query = supabase.from('plan_tasks')
          .select('id, title, description, status, priority, due_date, start_date, completed_at, source, created_at')
          .eq('user_id', resolved.ownerId)
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(limit)

        if (status) query = query.eq('status', status)
        if (dateStr) {
          const bounds = dayBounds(dateStr)
          if (!bounds) return json({ error: 'invalid_date_expected_yyyy_mm_dd' }, 400)
          query = query.gte('due_date', bounds[0]).lte('due_date', bounds[1])
        }

        const { data, error } = await query
        if (error) throw error
        return json({ ok: true, tasks: data ?? [], count: data?.length ?? 0 })
      }

      // NEW: complete_task — sets status = 'done' and stamps completed_at,
      // mirroring the app's own useTasks().update() behavior.
      case 'complete_task': {
        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const id = String(body.id ?? '')
        if (!id) return json({ error: 'id_required' }, 400)

        const { data: existing, error: fetchErr } = await supabase
          .from('plan_tasks').select('id').eq('id', id).eq('user_id', resolved.ownerId).maybeSingle()
        if (fetchErr) throw fetchErr
        if (!existing) return json({ error: 'task_not_found' }, 404)

        const { data: updated, error } = await supabase
          .from('plan_tasks')
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('id', id)
          .select('id, title, status, completed_at')
          .single()
        if (error) throw error
        return json({ ok: true, task: updated })
      }

      // NEW: delete_task — HARD delete. plan_tasks has no deleted_at column
      // (unlike VantoOS's tasks table), so there is no soft-delete
      // convention to follow here; matches the app's own useTasks().remove().
      case 'delete_task': {
        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const id = String(body.id ?? '')
        if (!id) return json({ error: 'id_required' }, 400)

        const { data: existing, error: fetchErr } = await supabase
          .from('plan_tasks').select('id').eq('id', id).eq('user_id', resolved.ownerId).maybeSingle()
        if (fetchErr) throw fetchErr
        if (!existing) return json({ error: 'task_not_found' }, 404)

        const { error } = await supabase.from('plan_tasks').delete().eq('id', id)
        if (error) throw error
        return json({ ok: true, deleted_id: id })
      }

      case 'create_reminder': {
        const title = String(body.title ?? '').trim()
        const reminderTime = String(body.reminder_time ?? '')
        if (!title) return json({ error: 'title_required' }, 400)
        if (!reminderTime || Number.isNaN(Date.parse(reminderTime))) {
          return json({ error: 'reminder_time_must_be_iso_timestamp' }, 400)
        }
        const description = body.description ? String(body.description) : null

        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const { data: inserted, error } = await supabase
          .from('plan_reminders')
          .insert({
            user_id: resolved.ownerId,
            title,
            reminder_time: new Date(reminderTime).toISOString(),
            description,
          })
          .select('id, title, reminder_time, created_at')
          .single()
        if (error) throw error
        return json({ ok: true, reminder: inserted })
      }

      // NEW: list_reminders — read-only. Filter by is_done and/or a single
      // calendar day (matches reminder_time). Scoped to the resolved
      // super_admin.
      case 'list_reminders': {
        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const isDone = typeof body.is_done === 'boolean' ? body.is_done : null
        const dateStr = body.date ? String(body.date) : null
        const limit = Number.isInteger(Number(body.limit)) && Number(body.limit) > 0
          ? Math.min(Number(body.limit), 100) : 50

        let query = supabase.from('plan_reminders')
          .select('id, title, description, reminder_time, is_done, created_at')
          .eq('user_id', resolved.ownerId)
          .order('reminder_time', { ascending: true })
          .limit(limit)

        if (isDone !== null) query = query.eq('is_done', isDone)
        if (dateStr) {
          const bounds = dayBounds(dateStr)
          if (!bounds) return json({ error: 'invalid_date_expected_yyyy_mm_dd' }, 400)
          query = query.gte('reminder_time', bounds[0]).lte('reminder_time', bounds[1])
        }

        const { data, error } = await query
        if (error) throw error
        return json({ ok: true, reminders: data ?? [], count: data?.length ?? 0 })
      }

      // NEW: complete_reminder — sets is_done = true, mirroring the app's
      // own useReminders().update() behavior.
      case 'complete_reminder': {
        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const id = String(body.id ?? '')
        if (!id) return json({ error: 'id_required' }, 400)

        const { data: existing, error: fetchErr } = await supabase
          .from('plan_reminders').select('id').eq('id', id).eq('user_id', resolved.ownerId).maybeSingle()
        if (fetchErr) throw fetchErr
        if (!existing) return json({ error: 'reminder_not_found' }, 404)

        const { data: updated, error } = await supabase
          .from('plan_reminders')
          .update({ is_done: true })
          .eq('id', id)
          .select('id, title, is_done')
          .single()
        if (error) throw error
        return json({ ok: true, reminder: updated })
      }

      // NEW: delete_reminder — HARD delete, matching the app's own
      // useReminders().remove().
      case 'delete_reminder': {
        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const id = String(body.id ?? '')
        if (!id) return json({ error: 'id_required' }, 400)

        const { data: existing, error: fetchErr } = await supabase
          .from('plan_reminders').select('id').eq('id', id).eq('user_id', resolved.ownerId).maybeSingle()
        if (fetchErr) throw fetchErr
        if (!existing) return json({ error: 'reminder_not_found' }, 404)

        const { error } = await supabase.from('plan_reminders').delete().eq('id', id)
        if (error) throw error
        return json({ ok: true, deleted_id: id })
      }

      case 'create_meeting': {
        const title = String(body.title ?? '').trim()
        const startTime = String(body.start_time ?? '')
        if (!title) return json({ error: 'title_required' }, 400)
        if (!startTime || Number.isNaN(Date.parse(startTime))) {
          return json({ error: 'start_time_must_be_iso_timestamp' }, 400)
        }
        const location = body.location ? String(body.location) : null
        const description = body.description ? String(body.description) : null

        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const { data: inserted, error } = await supabase
          .from('plan_meetings')
          .insert({
            user_id: resolved.ownerId,
            title,
            start_time: new Date(startTime).toISOString(),
            location,
            description,
          })
          .select('id, title, start_time, location, created_at')
          .single()
        if (error) throw error
        return json({
          ok: true,
          meeting: inserted,
          note: 'Lightweight add only — no Google Calendar event or WhatsApp/email invite was sent.',
        })
      }

      // NEW: list_meetings — read-only. Filter by a single calendar day
      // (matches start_time). Scoped to the resolved super_admin. Note: no
      // is_done filter is exposed — plan_meetings has no confirmed
      // completion field in this app.
      case 'list_meetings': {
        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const dateStr = body.date ? String(body.date) : null
        const limit = Number.isInteger(Number(body.limit)) && Number(body.limit) > 0
          ? Math.min(Number(body.limit), 100) : 50

        let query = supabase.from('plan_meetings')
          .select('id, title, description, start_time, end_time, location, notes, attendees, created_at')
          .eq('user_id', resolved.ownerId)
          .order('start_time', { ascending: true })
          .limit(limit)

        if (dateStr) {
          const bounds = dayBounds(dateStr)
          if (!bounds) return json({ error: 'invalid_date_expected_yyyy_mm_dd' }, 400)
          query = query.gte('start_time', bounds[0]).lte('start_time', bounds[1])
        }

        const { data, error } = await query
        if (error) throw error
        return json({ ok: true, meetings: data ?? [], count: data?.length ?? 0 })
      }

      // NEW: delete_meeting — HARD delete, matching the app's own
      // useMeetings().remove().
      case 'delete_meeting': {
        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const id = String(body.id ?? '')
        if (!id) return json({ error: 'id_required' }, 400)

        const { data: existing, error: fetchErr } = await supabase
          .from('plan_meetings').select('id').eq('id', id).eq('user_id', resolved.ownerId).maybeSingle()
        if (fetchErr) throw fetchErr
        if (!existing) return json({ error: 'meeting_not_found' }, 404)

        const { error } = await supabase.from('plan_meetings').delete().eq('id', id)
        if (error) throw error
        return json({ ok: true, deleted_id: id })
      }

      case 'create_diary_entry': {
        const content = String(body.content ?? '').trim()
        if (!content) return json({ error: 'content_required' }, 400)
        const title = body.title ? String(body.title).trim() : null

        const resolved = await resolveOwnerId()
        if ('errorResponse' in resolved) return resolved.errorResponse

        const { data: inserted, error } = await supabase
          .from('voice_diary_entries')
          .insert({
            user_id: resolved.ownerId,
            title,
            content,
            source_type: 'typed',
          })
          .select('id, title, created_at')
          .single()
        if (error) throw error
        return json({ ok: true, entry: inserted })
      }

      default:
        return json({ error: 'unknown_action', action, available_actions: ACTIONS }, 400)

    }
  } catch (e) {
    console.error('mcp-bridge error', action, e)
    return json({ error: 'internal_error', message: (e as Error).message }, 500)
  }
})
