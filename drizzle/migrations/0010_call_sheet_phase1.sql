CREATE TABLE public.call_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  key text NOT NULL,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  cutoff_at timestamptz,
  timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
  target_conversations integer NOT NULL DEFAULT 30,
  target_agreed integer NOT NULL DEFAULT 12,
  target_registrations integer NOT NULL DEFAULT 5,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_campaigns TO authenticated;
GRANT ALL ON public.call_campaigns TO service_role;
ALTER TABLE public.call_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_campaigns own rows" ON public.call_campaigns FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.call_list_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  campaign_key text,
  called_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL DEFAULT 'phone' CHECK (channel IN ('phone','whatsapp_call','whatsapp_voice_note','whatsapp_text','zoom')),
  outcome text NOT NULL CHECK (outcome IN ('Answered - interested','Answered - not now','Booked call/presentation','Registered','Call back','No answer','Wrong number','Not interested')),
  notes text,
  next_action text,
  follow_up_on date,
  tier_at_call text,
  confirmed_under_vanto boolean,
  activity_id uuid,
  reminder_id uuid,
  note_appended text,
  undo_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_list_calls_user_contact_idx ON public.call_list_calls (user_id, contact_id, called_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_list_calls TO authenticated;
GRANT ALL ON public.call_list_calls TO service_role;
ALTER TABLE public.call_list_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_list_calls own rows" ON public.call_list_calls FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.call_list_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  tier_override text CHECK (tier_override IN ('hot','lukewarm','cold')),
  pinned boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  hidden_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_list_overrides TO authenticated;
GRANT ALL ON public.call_list_overrides TO service_role;
ALTER TABLE public.call_list_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_list_overrides own rows" ON public.call_list_overrides FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER call_campaigns_updated BEFORE UPDATE ON public.call_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER call_list_calls_updated BEFORE UPDATE ON public.call_list_calls FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER call_list_overrides_updated BEFORE UPDATE ON public.call_list_overrides FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Live tier computation. security_invoker: every underlying table keeps its own RLS.
CREATE VIEW public.call_list_cards WITH (security_invoker = true) AS
WITH msg AS (
  SELECT cv.contact_id, m.created_at AS ts, NOT coalesce(m.is_outbound,false) AS inbound, m.content AS body
  FROM public.messages m JOIN public.conversations cv ON cv.id = m.conversation_id
  WHERE cv.contact_id IS NOT NULL
  UNION ALL
  SELECT coalesce(mm.contact_id, c2.id), mm.received_at, coalesce(mm.direction,'') <> 'outbound', mm.body
  FROM public.maytapi_messages mm
  LEFT JOIN public.contacts c2 ON mm.contact_id IS NULL AND c2.phone_normalized = mm.phone_e164 AND c2.is_deleted = false
  WHERE coalesce(mm.conversation_key,'') NOT LIKE '%@g.us%'
),
agg AS (
  SELECT contact_id,
    count(*) AS msg_count,
    min(ts) FILTER (WHERE inbound) AS first_in,
    max(ts) FILTER (WHERE inbound) AS last_in,
    max(ts) FILTER (WHERE NOT inbound) AS last_out,
    (array_agg(body ORDER BY ts DESC) FILTER (WHERE inbound))[1] AS last_in_body,
    (array_agg(body ORDER BY ts DESC) FILTER (WHERE inbound AND ts > now() - interval '7 days'
      AND body ~* '(distributor|membership|member fee|business associate|business opportunity|opportunity to earn|sponsor me|sign me up|become (a )?(member|partner)|join aplgo|r ?375)'))[1] AS dist_body,
    max(ts) FILTER (WHERE inbound AND ts > now() - interval '7 days'
      AND body ~* '(distributor|membership|member fee|business associate|business opportunity|opportunity to earn|sponsor me|sign me up|become (a )?(member|partner)|join aplgo|r ?375)') AS dist_at
  FROM msg WHERE contact_id IS NOT NULL GROUP BY contact_id
),
lastcall AS (
  SELECT DISTINCT ON (contact_id) contact_id, called_at, outcome FROM public.call_list_calls
  WHERE user_id = auth.uid() ORDER BY contact_id, called_at DESC
),
fu AS (
  SELECT DISTINCT ON (contact_id) contact_id, follow_up_on FROM public.call_list_calls
  WHERE user_id = auth.uid() ORDER BY contact_id, called_at DESC
),
hla AS (
  SELECT contact_id, max(created_at) AS at, (array_agg(message_snippet ORDER BY created_at DESC))[1] AS snippet
  FROM public.hot_lead_alerts WHERE created_at > now() - interval '14 days' AND contact_id IS NOT NULL GROUP BY contact_id
),
mi AS (
  SELECT contact_id, max(intent_state) AS state FROM public.missed_inquiries
  WHERE status = 'active' AND intent_state IN ('JOINING_INTEREST','MEMBER_PRICE_INTEREST') GROUP BY contact_id
),
base AS (
  SELECT c.*, a.msg_count, a.first_in, a.last_in, a.last_out, a.last_in_body, a.dist_body, a.dist_at,
    lc.called_at AS last_call_at, lc.outcome AS last_call_outcome,
    CASE WHEN lc.outcome = 'Not interested' THEN NULL ELSE fu.follow_up_on END AS fu_on,
    hla.at AS hla_at, hla.snippet AS hla_snippet, mi.state AS mi_state,
    o.tier_override, coalesce(o.pinned,false) AS pinned, coalesce(o.hidden,false) AS hidden, o.hidden_reason,
    (timezone('Africa/Johannesburg', now()))::date AS today_sast,
    EXISTS (SELECT 1 FROM public.auto_reply_optouts x WHERE x.phone_normalized = c.phone_normalized) AS opted_out,
    EXISTS (SELECT 1 FROM public.lead_call_summaries s WHERE s.contact_id = c.id) AS has_summary
  FROM public.contacts c
  LEFT JOIN agg a ON a.contact_id = c.id
  LEFT JOIN lastcall lc ON lc.contact_id = c.id
  LEFT JOIN fu ON fu.contact_id = c.id
  LEFT JOIN hla ON hla.contact_id = c.id
  LEFT JOIN mi ON mi.contact_id = c.id
  LEFT JOIN public.call_list_overrides o ON o.contact_id = c.id AND o.user_id = auth.uid()
  WHERE c.is_deleted = false
),
scored AS (
  SELECT b.*,
    (b.fu_on IS NOT NULL AND b.fu_on <= b.today_sast) AS follow_up_due,
    (b.last_in IS NOT NULL AND (b.last_out IS NULL OR b.last_in > b.last_out)) AS unanswered_inbound,
    (b.primary_intent IN ('intent:health_inquiry','intent:info')
      OR (coalesce(b.prospect_verified,false) AND b.last_in > now() - interval '30 days')) AS is_luke,
    CASE
      WHEN b.primary_intent IN ('intent:distributor','intent:buyer') THEN 'AI intent: ' || replace(b.primary_intent,'intent:','') || coalesce(' - ' || left(b.intent_reason, 90), '')
      WHEN b.hla_at IS NOT NULL THEN 'Hot-lead alert ' || to_char(timezone('Africa/Johannesburg', b.hla_at),'DD Mon') || coalesce(': "' || left(b.hla_snippet, 70) || '"', '')
      WHEN b.dist_at IS NOT NULL THEN 'Asked "' || left(b.dist_body, 70) || '" ' || greatest(0, (b.today_sast - timezone('Africa/Johannesburg', b.dist_at)::date)) || ' days ago'
      WHEN b.mi_state IS NOT NULL THEN 'Open inquiry: ' || lower(replace(b.mi_state,'_',' '))
      WHEN b.fu_on IS NOT NULL AND b.fu_on <= b.today_sast THEN 'Follow-up due ' || to_char(b.fu_on,'DD Mon')
    END AS hot_reason
  FROM base b
),
tiered AS (
  SELECT s.*,
    CASE
      WHEN s.hot_reason IS NOT NULL THEN 'hot'
      WHEN s.is_luke AND s.last_out IS NOT NULL AND s.last_in > s.last_out THEN 'hot'
      WHEN s.is_luke THEN 'lukewarm'
      WHEN (coalesce(s.prospect_verified,false) OR s.last_in IS NOT NULL) THEN 'cold'
      WHEN s.temperature = 'warm' AND coalesce(s.msg_count,0) = 0 THEN 'cold'
    END AS computed_tier,
    CASE
      WHEN s.hot_reason IS NOT NULL THEN s.hot_reason
      WHEN s.is_luke AND s.last_out IS NOT NULL AND s.last_in > s.last_out THEN 'Replied after your last message ' || to_char(timezone('Africa/Johannesburg', s.last_in),'DD Mon HH24:MI')
      WHEN s.primary_intent IN ('intent:health_inquiry','intent:info') THEN 'AI intent: ' || replace(s.primary_intent,'intent:','') || coalesce(' - ' || left(s.intent_reason, 90), '')
      WHEN s.is_luke THEN 'Verified prospect, last message ' || to_char(timezone('Africa/Johannesburg', s.last_in),'DD Mon')
      WHEN s.last_in IS NOT NULL THEN 'Quiet since ' || to_char(timezone('Africa/Johannesburg', s.last_in),'DD Mon YYYY')
      WHEN coalesce(s.prospect_verified,false) THEN 'Verified prospect, no inbound message'
      WHEN s.temperature = 'warm' THEN 'Marked warm, no conversation yet'
    END AS computed_reason
  FROM scored s
),
final AS (
  SELECT t.*,
    coalesce(t.tier_override, t.computed_tier) AS tier,
    CASE WHEN t.tier_override IS NOT NULL THEN 'Set manually (' || t.tier_override || ')' || coalesce('. ' || t.computed_reason, '') ELSE t.computed_reason END AS tier_reason,
    CASE
      WHEN t.do_not_contact THEN 'Do not contact'
      WHEN t.opted_out THEN 'Opted out of messages'
      WHEN t.lead_type = 'expired' THEN 'Lead type: expired'
      WHEN coalesce(t.contact_category,'prospect') <> 'prospect' THEN 'Contact category: ' || t.contact_category
      WHEN t.hidden THEN 'Hidden from sheet' || coalesce(' (' || t.hidden_reason || ')', '')
      WHEN t.lead_type IN ('buyer','vip') THEN 'Lead type: ' || t.lead_type
    END AS exclusion_reason
  FROM tiered t
  WHERE coalesce(t.tier_override, t.computed_tier) IS NOT NULL OR t.pinned
)
SELECT
  f.id, f.name, f.first_name, f.last_name, f.phone, f.phone_normalized, f.lead_type::text AS lead_type, f.temperature::text AS temperature,
  f.interest::text AS interest, f.primary_intent, f.intent_reason, f.source_tag, f.prospect_verified, f.city, f.province, f.notes,
  coalesce(f.tier, 'cold') AS tier, f.tier_reason,
  row_number() OVER (PARTITION BY coalesce(f.tier,'cold') ORDER BY f.pinned DESC, (f.fu_on IS NOT NULL AND f.fu_on <= f.today_sast) DESC,
    f.unanswered_inbound DESC, f.last_in DESC NULLS LAST, f.first_in ASC NULLS LAST) AS tier_rank,
  coalesce(f.first_in, f.created_at) AS first_inquiry,
  f.last_in AS last_inbound_at, f.last_out AS last_outbound_at, f.last_in_body AS last_inbound_preview,
  coalesce(f.msg_count,0) AS msg_count, f.unanswered_inbound,
  f.last_call_at, f.last_call_outcome,
  (f.last_call_at IS NOT NULL AND timezone('Africa/Johannesburg', f.last_call_at)::date = f.today_sast) AS called_today,
  f.fu_on AS follow_up_on, f.follow_up_due,
  '[]'::jsonb AS signals,
  f.has_summary, f.pinned, f.hidden, f.exclusion_reason
FROM final f;

GRANT SELECT ON public.call_list_cards TO authenticated;

-- One-transaction call logging (SECURITY INVOKER: runs under the caller's RLS).
CREATE OR REPLACE FUNCTION public.log_call_sheet_call(
  _contact_id uuid, _outcome text, _channel text DEFAULT 'phone', _notes text DEFAULT NULL,
  _next_action text DEFAULT NULL, _follow_up_on date DEFAULT NULL, _campaign_key text DEFAULT NULL,
  _confirmed_under_vanto boolean DEFAULT NULL, _source text DEFAULT 'call_sheet'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c record; v_tier text; v_call_id uuid; v_act_id uuid; v_rem_id uuid; v_line text;
  v_prev_override jsonb; v_prev_lead text; v_fu date := _follow_up_on; v_campaign text := _campaign_key;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id, name, first_name, phone, notes, lead_type::text AS lead_type INTO v_c FROM contacts WHERE id = _contact_id AND is_deleted = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact_not_visible'; END IF;
  IF v_campaign IS NULL THEN SELECT key INTO v_campaign FROM call_campaigns WHERE user_id = v_uid AND is_active ORDER BY starts_at DESC LIMIT 1; END IF;
  SELECT tier INTO v_tier FROM call_list_cards WHERE id = _contact_id;
  IF _outcome = 'Not interested' THEN v_fu := NULL; END IF;

  SELECT to_jsonb(o) INTO v_prev_override FROM call_list_overrides o WHERE o.user_id = v_uid AND o.contact_id = _contact_id;
  v_prev_lead := v_c.lead_type;

  v_line := '--- ' || to_char(timezone('Africa/Johannesburg', now()), 'DD Mon YYYY HH24:MI') || ' ---' || E'\n'
    || 'Call: ' || _outcome || ' (' || replace(coalesce(_channel,'phone'),'_',' ') || ')'
    || coalesce(E'\n' || nullif(trim(_notes),''), '')
    || coalesce(E'\nNext: ' || nullif(trim(_next_action),''), '')
    || coalesce(E'\nFollow up: ' || to_char(v_fu,'DD Mon YYYY'), '');

  INSERT INTO call_list_calls (contact_id, campaign_key, channel, outcome, notes, next_action, follow_up_on, tier_at_call, confirmed_under_vanto)
  VALUES (_contact_id, v_campaign, coalesce(_channel,'phone'), _outcome, _notes, _next_action, v_fu, v_tier, _confirmed_under_vanto)
  RETURNING id INTO v_call_id;

  INSERT INTO contact_activity (contact_id, performed_by, type, metadata)
  VALUES (_contact_id, v_uid, 'call_logged', jsonb_build_object('outcome', _outcome, 'channel', _channel, 'notes', _notes,
    'next_action', _next_action, 'follow_up_on', v_fu, 'campaign_key', v_campaign, 'source', coalesce(_source,'call_sheet'), 'call_id', v_call_id))
  RETURNING id INTO v_act_id;

  UPDATE contacts SET notes = CASE WHEN coalesce(trim(notes),'') = '' THEN v_line ELSE rtrim(notes) || E'\n\n' || v_line END,
    lead_type = CASE WHEN _outcome = 'Registered' AND lead_type::text IN ('prospect','unclassified') THEN 'registered'::lead_type ELSE lead_type END,
    updated_at = now()
  WHERE id = _contact_id;

  IF _outcome = 'Registered' AND v_prev_lead IN ('prospect','unclassified') THEN
    INSERT INTO contact_activity (contact_id, performed_by, type, metadata)
    VALUES (_contact_id, v_uid, 'lead_type_changed', jsonb_build_object('from', v_prev_lead, 'to', 'registered', 'source', 'call_sheet', 'call_id', v_call_id));
  END IF;

  IF v_fu IS NOT NULL THEN
    INSERT INTO plan_reminders (user_id, title, description, reminder_time)
    VALUES (v_uid, 'Call back ' || coalesce(nullif(v_c.name,''), v_c.first_name, v_c.phone, 'contact'),
      coalesce(_next_action, _outcome) || ' [call_sheet ' || v_call_id || ']',
      (v_fu::timestamp + time '09:00') AT TIME ZONE 'Africa/Johannesburg')
    RETURNING id INTO v_rem_id;
  END IF;

  IF _outcome = 'Wrong number' THEN
    INSERT INTO call_list_overrides (contact_id, hidden, hidden_reason) VALUES (_contact_id, true, 'wrong number')
    ON CONFLICT (user_id, contact_id) DO UPDATE SET hidden = true, hidden_reason = 'wrong number';
  ELSIF _outcome = 'Not interested' THEN
    INSERT INTO call_list_overrides (contact_id, tier_override) VALUES (_contact_id, 'cold')
    ON CONFLICT (user_id, contact_id) DO UPDATE SET tier_override = 'cold';
  END IF;

  UPDATE call_list_calls SET activity_id = v_act_id, reminder_id = v_rem_id, note_appended = v_line,
    undo_state = jsonb_build_object('prev_override', v_prev_override, 'prev_lead_type', v_prev_lead)
  WHERE id = v_call_id;

  RETURN jsonb_build_object('call_id', v_call_id, 'activity_id', v_act_id, 'reminder_id', v_rem_id, 'campaign_key', v_campaign,
    'tier_at_call', v_tier, 'note_line', v_line, 'lead_type_changed', (_outcome = 'Registered' AND v_prev_lead IN ('prospect','unclassified')));
END $$;

CREATE OR REPLACE FUNCTION public.undo_call_sheet_call(_call_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v record; v_prev jsonb;
BEGIN
  SELECT * INTO v FROM call_list_calls WHERE id = _call_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'call_not_found'; END IF;
  IF v.note_appended IS NOT NULL THEN
    UPDATE contacts SET notes = nullif(rtrim(replace(replace(coalesce(notes,''), E'\n\n' || v.note_appended, ''), v.note_appended, '')), '')
    WHERE id = v.contact_id;
  END IF;
  IF v.outcome = 'Registered' AND (v.undo_state->>'prev_lead_type') IN ('prospect','unclassified') THEN
    UPDATE contacts SET lead_type = (v.undo_state->>'prev_lead_type')::lead_type WHERE id = v.contact_id AND lead_type = 'registered';
    DELETE FROM contact_activity WHERE contact_id = v.contact_id AND type = 'lead_type_changed' AND metadata->>'call_id' = _call_id::text;
  END IF;
  IF v.activity_id IS NOT NULL THEN DELETE FROM contact_activity WHERE id = v.activity_id; END IF;
  IF v.reminder_id IS NOT NULL THEN DELETE FROM plan_reminders WHERE id = v.reminder_id AND user_id = auth.uid(); END IF;
  IF v.outcome IN ('Wrong number','Not interested') THEN
    v_prev := v.undo_state->'prev_override';
    IF v_prev IS NULL OR v_prev = 'null'::jsonb THEN
      DELETE FROM call_list_overrides WHERE user_id = auth.uid() AND contact_id = v.contact_id;
    ELSE
      UPDATE call_list_overrides SET tier_override = v_prev->>'tier_override', hidden = coalesce((v_prev->>'hidden')::boolean,false),
        hidden_reason = v_prev->>'hidden_reason', pinned = coalesce((v_prev->>'pinned')::boolean,false)
      WHERE user_id = auth.uid() AND contact_id = v.contact_id;
    END IF;
  END IF;
  DELETE FROM call_list_calls WHERE id = _call_id;
  RETURN jsonb_build_object('undone', true, 'call_id', _call_id);
END $$;

-- Scorecard (Africa/Johannesburg days).
CREATE OR REPLACE FUNCTION public.call_campaign_scorecard(_campaign_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE c record; v_conv int; v_agreed int; v_reg int; v_conf int; v_share numeric; v_uncalled jsonb;
BEGIN
  SELECT * INTO c FROM call_campaigns WHERE user_id = auth.uid()
    AND (CASE WHEN _campaign_key IS NULL THEN is_active ELSE key = _campaign_key END) ORDER BY starts_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('campaign', NULL); END IF;

  WITH call_days AS (
    SELECT contact_id, timezone('Africa/Johannesburg', called_at)::date d FROM call_list_calls
    WHERE user_id = auth.uid() AND called_at BETWEEN c.starts_at AND c.ends_at
      AND (outcome LIKE 'Answered%' OR outcome LIKE 'Booked%' OR outcome = 'Registered')
  ), wa_days AS (
    SELECT cv.contact_id, timezone('Africa/Johannesburg', m.created_at)::date d
    FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
    WHERE m.created_at BETWEEN c.starts_at AND c.ends_at AND cv.contact_id IS NOT NULL
    GROUP BY 1, 2
    HAVING bool_or(NOT coalesce(m.is_outbound,false))
       AND (array_agg(m.sent_by ORDER BY m.created_at DESC) FILTER (WHERE m.is_outbound))[1] = auth.uid()
  )
  SELECT count(*) INTO v_conv FROM (SELECT contact_id, d FROM call_days UNION SELECT contact_id, d FROM wa_days) x;

  SELECT count(DISTINCT contact_id) FILTER (WHERE outcome IN ('Booked call/presentation','Registered')),
         count(DISTINCT contact_id) FILTER (WHERE outcome = 'Registered'),
         count(DISTINCT contact_id) FILTER (WHERE outcome = 'Registered' AND confirmed_under_vanto)
    INTO v_agreed, v_reg, v_conf
  FROM call_list_calls WHERE user_id = auth.uid() AND called_at BETWEEN c.starts_at AND c.ends_at;

  v_share := greatest(0, least(1, extract(epoch FROM (now() - c.starts_at)) / nullif(extract(epoch FROM (c.ends_at - c.starts_at)),0)));

  SELECT jsonb_object_agg(tier, n) INTO v_uncalled FROM (
    SELECT tier, count(*) n FROM call_list_cards WHERE exclusion_reason IS NULL AND last_call_at IS NULL GROUP BY tier) t;

  RETURN jsonb_build_object(
    'campaign', jsonb_build_object('key', c.key, 'name', c.name, 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'cutoff_at', c.cutoff_at,
      'timezone', c.timezone, 'blocks', c.blocks),
    'targets', jsonb_build_object('conversations', c.target_conversations, 'agreed', c.target_agreed, 'registrations', c.target_registrations),
    'actuals', jsonb_build_object('conversations', v_conv, 'agreed', v_agreed, 'registrations', v_reg, 'confirmed_under_vanto', v_conf),
    'elapsed_share', round(v_share, 3),
    'uncalled_by_tier', coalesce(v_uncalled, '{}'::jsonb),
    'now', now());
END $$;

GRANT EXECUTE ON FUNCTION public.log_call_sheet_call(uuid, text, text, text, text, date, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_call_sheet_call(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_campaign_scorecard(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.log_call_sheet_call(uuid, text, text, text, text, date, text, boolean, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.undo_call_sheet_call(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.call_campaign_scorecard(text) FROM anon, public;