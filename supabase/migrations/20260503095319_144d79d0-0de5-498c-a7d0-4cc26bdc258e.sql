-- 1) Soft-dedup columns on whatsapp_groups
ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid,
  ADD COLUMN IF NOT EXISTS dedup_note text,
  ADD COLUMN IF NOT EXISTS dedup_at timestamptz;

-- 2) whatsapp_group_members
CREATE TABLE IF NOT EXISTS public.whatsapp_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid text NOT NULL,
  phone_normalized text NOT NULL,
  role text,
  contact_id uuid,
  classification text,
  crm_last_activity_at timestamptz,
  last_seen_in_group_status text NOT NULL DEFAULT 'insufficient_data',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_scanned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_group_members_jid_phone_unique UNIQUE (group_jid, phone_normalized)
);
CREATE INDEX IF NOT EXISTS idx_wgm_group_jid ON public.whatsapp_group_members(group_jid);
ALTER TABLE public.whatsapp_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage group members"
  ON public.whatsapp_group_members FOR ALL
  USING (is_admin_or_super_admin())
  WITH CHECK (is_admin_or_super_admin());

CREATE POLICY "Service can manage group members"
  ON public.whatsapp_group_members FOR ALL
  USING (true) WITH CHECK (true);

-- 3) group_admin_actions audit log
CREATE TABLE IF NOT EXISTS public.group_admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  group_jid text,
  group_name text,
  performed_by uuid,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_activity_attempted boolean NOT NULL DEFAULT false,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_gaa_started_at ON public.group_admin_actions(started_at DESC);
ALTER TABLE public.group_admin_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage group admin actions"
  ON public.group_admin_actions FOR ALL
  USING (is_admin_or_super_admin())
  WITH CHECK (is_admin_or_super_admin());

CREATE POLICY "Service can manage group admin actions"
  ON public.group_admin_actions FOR ALL
  USING (true) WITH CHECK (true);

-- 4) Reconcile duplicate APLGO row (soft-deactivate)
UPDATE public.whatsapp_groups
SET is_active = false,
    duplicate_of = '47f21058-395b-426b-a821-f4bf148b8aa3',
    dedup_note = 'Soft-deactivated 2026-05-03: duplicate JID 120363032143899916@g.us. Canonical row is APLGO (id 47f21058...). Historical group_health_reports preserved.',
    dedup_at = now()
WHERE id = 'f9101d9a-ae2d-4786-ad76-990fc8fc2bfb';

-- 5) Seed selector key (idempotent)
INSERT INTO public.integration_settings (key, value)
SELECT 'zazi_group_admin_selected_jids', '[]'
WHERE NOT EXISTS (
  SELECT 1 FROM public.integration_settings WHERE key = 'zazi_group_admin_selected_jids'
);