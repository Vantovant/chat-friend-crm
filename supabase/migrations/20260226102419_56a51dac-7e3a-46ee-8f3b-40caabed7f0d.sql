
-- Phase 6 remaining tables

-- 1. auto_reply_events: log every auto-reply action
CREATE TABLE public.auto_reply_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  inbound_message_id uuid,
  action_taken text NOT NULL, -- 'menu_sent', 'knowledge_reply', 'template_sent', 'human_handover', 'rate_limited', 'window_expired'
  reason text,
  template_used text,
  menu_option text,
  knowledge_query text,
  knowledge_found boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auto_reply_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view auto reply events" ON public.auto_reply_events FOR SELECT
  USING (is_admin_or_super_admin());

CREATE POLICY "Service can manage auto reply events" ON public.auto_reply_events FOR ALL
  USING (true) WITH CHECK (true);

-- 2. playbooks: sales scripts/templates organized by category
CREATE TABLE public.playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('price_question','skeptical','wants_results','medical_concern','business_plan','general')),
  title text NOT NULL,
  content text NOT NULL,
  approved boolean DEFAULT false,
  version integer DEFAULT 1,
  usage_count integer DEFAULT 0,
  conversion_count integer DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view approved playbooks" ON public.playbooks FOR SELECT
  USING (auth.uid() IS NOT NULL AND approved = true);

CREATE POLICY "Admins manage playbooks" ON public.playbooks FOR ALL
  USING (is_admin_or_super_admin()) WITH CHECK (is_admin_or_super_admin());

-- 3. learning_metrics: weekly KPIs by agent/source/leadtype
CREATE TABLE public.learning_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  agent_id uuid,
  lead_type text,
  source text,
  total_conversations integer DEFAULT 0,
  total_messages_sent integer DEFAULT 0,
  total_messages_received integer DEFAULT 0,
  avg_response_time_minutes real,
  stage_movements integer DEFAULT 0,
  suggestions_accepted integer DEFAULT 0,
  suggestions_rejected integer DEFAULT 0,
  sales_closed integer DEFAULT 0,
  calls_booked integer DEFAULT 0,
  follow_ups_completed integer DEFAULT 0,
  recommendations jsonb DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.learning_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view learning metrics" ON public.learning_metrics FOR SELECT
  USING (is_admin_or_super_admin());

CREATE POLICY "Service can manage learning metrics" ON public.learning_metrics FOR ALL
  USING (true) WITH CHECK (true);

-- Index for weekly lookups
CREATE INDEX learning_metrics_week_idx ON public.learning_metrics (week_start, agent_id);
