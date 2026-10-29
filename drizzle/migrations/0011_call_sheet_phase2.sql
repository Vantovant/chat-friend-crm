CREATE TABLE public.call_list_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  contact_id uuid REFERENCES public.contacts(id),
  phone_normalized text,
  signal_type text NOT NULL CHECK (signal_type IN ('asked_membership','attended_presentation','zoom_registered','opened_email','clicked_link','referred_by_leader','manual_hot','registered_elsewhere','other')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('hub','grow','mail','manual')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id, signal_type, occurred_at)
);
CREATE INDEX call_list_signals_contact_idx ON public.call_list_signals (user_id, contact_id, signal_type);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_list_signals TO authenticated;
GRANT ALL ON public.call_list_signals TO service_role;
ALTER TABLE public.call_list_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_list_signals own rows" ON public.call_list_signals FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.call_list_signals_resolve_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NULL AND NEW.phone_normalized IS NOT NULL THEN
    SELECT id INTO NEW.contact_id FROM contacts
    WHERE phone_normalized = NEW.phone_normalized AND is_deleted = false
    ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF NEW.phone_normalized IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT phone_normalized INTO NEW.phone_normalized FROM contacts WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER call_list_signals_resolve BEFORE INSERT OR UPDATE ON public.call_list_signals FOR EACH ROW EXECUTE FUNCTION public.call_list_signals_resolve_contact();
CREATE TRIGGER call_list_signals_updated BEFORE UPDATE ON public.call_list_signals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.call_list_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  campaign_key text,
  tier text CHECK (tier IN ('hot','lukewarm','cold')),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','sent_by_vanto')),
  created_by text NOT NULL DEFAULT 'user' CHECK (created_by IN ('claude','user')),
  approved_at timestamptz,
  approved_via text CHECK (approved_via IN ('page','connector')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_list_drafts_contact_idx ON public.call_list_drafts (user_id, contact_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_list_drafts TO authenticated;
GRANT ALL ON public.call_list_drafts TO service_role;
ALTER TABLE public.call_list_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_list_drafts own rows" ON public.call_list_drafts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.call_list_drafts_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN RAISE EXCEPTION 'drafts must be created with status draft'; END IF;
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.approved_via IS NULL THEN RAISE EXCEPTION 'approval must record approved_via'; END IF;
    NEW.approved_at := now();
  ELSIF NEW.status <> 'approved' AND NEW.status <> 'sent_by_vanto' THEN
    NEW.approved_at := NULL; NEW.approved_via := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER call_list_drafts_guard_trg BEFORE INSERT OR UPDATE ON public.call_list_drafts FOR EACH ROW EXECUTE FUNCTION public.call_list_drafts_guard();
CREATE TRIGGER call_list_drafts_updated BEFORE UPDATE ON public.call_list_drafts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE VIEW public.call_list_cards WITH (security_invoker = true) AS
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
      AND body ~* '(distributor|membership|member fee|business associate|business opportunity|opportunity to earn|sponsor me|sign me up|become (a )?(member|partner)|join aplgo|r ?375)') AS dist_at,
    coalesce(bool_or(inbound AND body ~* '(\mjoin\M|\mregister|\mregistration\M|\mmembership\M|become (a )?distributor)'), false) AS membership_msg
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
sig AS (
  SELECT contact_id,
    jsonb_agg(jsonb_build_object('signal_type', signal_type, 'source', source, 'occurred_at', occurred_at, 'detail', left(detail, 140)) ORDER BY occurred_at DESC) AS signals,
    (array_agg(signal_type || coalesce(': ' || left(detail, 70), '') ORDER BY occurred_at DESC) FILTER (WHERE signal_type IN ('asked_membership','manual_hot','referred_by_leader') AND occurred_at > now() - interval '30 days'))[1] AS hot_sig,
    (array_agg(signal_type || coalesce(': ' || left(detail, 70), '') ORDER BY occurred_at DESC) FILTER (WHERE signal_type IN ('attended_presentation','zoom_registered','opened_email','clicked_link') AND occurred_at > now() - interval '14 days'))[1] AS luke_sig,
    (array_agg(signal_type ORDER BY occurred_at DESC) FILTER (WHERE signal_type IN ('attended_presentation','zoom_registered','opened_email','clicked_link','asked_membership','manual_hot','referred_by_leader')))[1] AS any_sig,
    bool_or(signal_type = 'asked_membership') AS asked_membership,
    bool_or(signal_type = 'registered_elsewhere') AS registered_elsewhere
  FROM public.call_list_signals WHERE user_id = auth.uid() AND contact_id IS NOT NULL GROUP BY contact_id
),
base AS (
  SELECT c.*, a.msg_count, a.first_in, a.last_in, a.last_out, a.last_in_body, a.dist_body, a.dist_at, coalesce(a.membership_msg,false) AS membership_msg,
    lc.called_at AS last_call_at, lc.outcome AS last_call_outcome,
    CASE WHEN lc.outcome = 'Not interested' THEN NULL ELSE fu.follow_up_on END AS fu_on,
    hla.at AS hla_at, hla.snippet AS hla_snippet, mi.state AS mi_state,
    o.tier_override, coalesce(o.pinned,false) AS pinned, coalesce(o.hidden,false) AS hidden, o.hidden_reason,
    sg.signals AS sig_json, sg.hot_sig, sg.luke_sig, sg.any_sig, coalesce(sg.asked_membership,false) AS sig_membership, coalesce(sg.registered_elsewhere,false) AS registered_elsewhere,
    (timezone('Africa/Johannesburg', now()))::date AS today_sast,
    EXISTS (SELECT 1 FROM public.auto_reply_optouts x WHERE x.phone_normalized = c.phone_normalized) AS opted_out,
    EXISTS (SELECT 1 FROM public.lead_call_summaries s WHERE s.contact_id = c.id) AS has_summary
  FROM public.contacts c
  LEFT JOIN agg a ON a.contact_id = c.id
  LEFT JOIN lastcall lc ON lc.contact_id = c.id
  LEFT JOIN fu ON fu.contact_id = c.id
  LEFT JOIN hla ON hla.contact_id = c.id
  LEFT JOIN mi ON mi.contact_id = c.id
  LEFT JOIN sig sg ON sg.contact_id = c.id
  LEFT JOIN public.call_list_overrides o ON o.contact_id = c.id AND o.user_id = auth.uid()
  WHERE c.is_deleted = false
),
scored AS (
  SELECT b.*,
    (b.fu_on IS NOT NULL AND b.fu_on <= b.today_sast) AS follow_up_due,
    (b.last_in IS NOT NULL AND (b.last_out IS NULL OR b.last_in > b.last_out)) AS unanswered_inbound,
    (b.primary_intent IN ('intent:health_inquiry','intent:info')
      OR (coalesce(b.prospect_verified,false) AND b.last_in > now() - interval '30 days')
      OR b.luke_sig IS NOT NULL) AS is_luke,
    CASE
      WHEN b.primary_intent IN ('intent:distributor','intent:buyer') THEN 'AI intent: ' || replace(b.primary_intent,'intent:','') || coalesce(' - ' || left(b.intent_reason, 90), '')
      WHEN b.hot_sig IS NOT NULL THEN 'Signal: ' || replace(b.hot_sig, '_', ' ')
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
      WHEN (coalesce(s.prospect_verified,false) OR s.last_in IS NOT NULL OR s.any_sig IS NOT NULL) THEN 'cold'
      WHEN s.temperature = 'warm' AND coalesce(s.msg_count,0) = 0 THEN 'cold'
    END AS computed_tier,
    CASE
      WHEN s.hot_reason IS NOT NULL THEN s.hot_reason
      WHEN s.is_luke AND s.last_out IS NOT NULL AND s.last_in > s.last_out THEN 'Replied after your last message ' || to_char(timezone('Africa/Johannesburg', s.last_in),'DD Mon HH24:MI')
      WHEN s.primary_intent IN ('intent:health_inquiry','intent:info') THEN 'AI intent: ' || replace(s.primary_intent,'intent:','') || coalesce(' - ' || left(s.intent_reason, 90), '')
      WHEN s.luke_sig IS NOT NULL THEN 'Signal: ' || replace(s.luke_sig, '_', ' ')
      WHEN s.is_luke THEN 'Verified prospect, last message ' || to_char(timezone('Africa/Johannesburg', s.last_in),'DD Mon')
      WHEN s.last_in IS NOT NULL THEN 'Quiet since ' || to_char(timezone('Africa/Johannesburg', s.last_in),'DD Mon YYYY')
      WHEN coalesce(s.prospect_verified,false) THEN 'Verified prospect, no inbound message'
      WHEN s.any_sig IS NOT NULL THEN 'Older signal: ' || replace(s.any_sig, '_', ' ')
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
      WHEN t.registered_elsewhere THEN 'Already registered (Get Well Grow)'
      WHEN t.lead_type IN ('buyer','vip') THEN 'Lead type: ' || t.lead_type
    END AS exclusion_reason
  FROM tiered t
  WHERE coalesce(t.tier_override, t.computed_tier) IS NOT NULL OR t.pinned OR t.registered_elsewhere
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
  coalesce(f.sig_json, '[]'::jsonb) AS signals,
  f.has_summary, f.pinned, f.hidden, f.exclusion_reason,
  (f.primary_intent = 'intent:distributor' OR f.sig_membership OR f.membership_msg) AS membership_interest
FROM final f;

GRANT SELECT ON public.call_list_cards TO authenticated;