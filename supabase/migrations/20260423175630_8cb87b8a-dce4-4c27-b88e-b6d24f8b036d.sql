-- Missed Inquiry Recovery System
CREATE TABLE public.missed_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  conversation_id uuid,
  flagged_reason text NOT NULL DEFAULT 'incomplete_discussion',
  flagged_at timestamptz NOT NULL DEFAULT now(),
  last_inbound_snippet text,
  last_inbound_at timestamptz,
  current_step integer NOT NULL DEFAULT 0,
  next_send_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  channel text NOT NULL DEFAULT 'maytapi',
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id)
);

CREATE INDEX idx_missed_inquiries_status_next ON public.missed_inquiries (status, next_send_at);
CREATE INDEX idx_missed_inquiries_contact ON public.missed_inquiries (contact_id);

ALTER TABLE public.missed_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage missed inquiries"
ON public.missed_inquiries FOR ALL
USING (public.is_admin_or_super_admin())
WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Authenticated users can view missed inquiries"
ON public.missed_inquiries FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can manage missed inquiries"
ON public.missed_inquiries FOR ALL
USING (true) WITH CHECK (true);

CREATE TRIGGER trg_missed_inquiries_updated_at
BEFORE UPDATE ON public.missed_inquiries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();