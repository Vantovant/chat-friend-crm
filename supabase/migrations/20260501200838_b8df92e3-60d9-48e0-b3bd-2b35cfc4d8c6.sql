-- Identity Bridge: new columns on contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS whatsapp_display_name text,
  ADD COLUMN IF NOT EXISTS contact_source text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS contact_confidence text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS name_needs_confirmation boolean NOT NULL DEFAULT false;

-- Damage audit table (one row per conversation, refreshed each scan)
CREATE TABLE IF NOT EXISTS public.prospector_damage_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL UNIQUE,
  contact_id uuid NOT NULL,
  contact_name text,
  contact_phone text,
  contact_source text,
  damage_score text NOT NULL DEFAULT 'green',
  recoverable boolean NOT NULL DEFAULT true,
  vanto_step_in boolean NOT NULL DEFAULT false,
  outbound_total integer NOT NULL DEFAULT 0,
  inbound_total integer NOT NULL DEFAULT 0,
  duplicate_outbound integer NOT NULL DEFAULT 0,
  outbound_24h integer NOT NULL DEFAULT 0,
  had_proof_url boolean NOT NULL DEFAULT false,
  had_aplgo_header boolean NOT NULL DEFAULT false,
  had_shop_link boolean NOT NULL DEFAULT false,
  had_local_number boolean NOT NULL DEFAULT false,
  price_leak_detected boolean NOT NULL DEFAULT false,
  price_leak_text text,
  premature_money_push boolean NOT NULL DEFAULT false,
  duplicate_messages boolean NOT NULL DEFAULT false,
  weak_first_touch boolean NOT NULL DEFAULT false,
  intent text NOT NULL DEFAULT 'unknown',
  temperature text NOT NULL DEFAULT 'cold',
  interest_topic text,
  name_known boolean NOT NULL DEFAULT false,
  recommended_action text,
  recovery_draft text,
  first_outbound_snippet text,
  last_outbound_snippet text,
  last_inbound_snippet text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_damage_audit_score ON public.prospector_damage_audit(damage_score);
CREATE INDEX IF NOT EXISTS idx_damage_audit_contact ON public.prospector_damage_audit(contact_id);
CREATE INDEX IF NOT EXISTS idx_damage_audit_step_in ON public.prospector_damage_audit(vanto_step_in) WHERE vanto_step_in = true;

ALTER TABLE public.prospector_damage_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage damage audit"
  ON public.prospector_damage_audit FOR ALL
  USING (is_admin_or_super_admin())
  WITH CHECK (is_admin_or_super_admin());

CREATE POLICY "Authenticated can view damage audit"
  ON public.prospector_damage_audit FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can manage damage audit"
  ON public.prospector_damage_audit FOR ALL
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_damage_audit_updated
  BEFORE UPDATE ON public.prospector_damage_audit
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();