
-- Outbox for outbound contact syncs to hub
CREATE TABLE public.hub_outbox (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  hub_contact_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
GRANT ALL ON public.hub_outbox TO service_role;
ALTER TABLE public.hub_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hub_outbox_service_only" ON public.hub_outbox FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX hub_outbox_pending_idx ON public.hub_outbox (created_at) WHERE status = 'pending';

-- Pull cursor
CREATE TABLE public.hub_sync_state (
  id TEXT NOT NULL PRIMARY KEY,
  last_pulled_at TIMESTAMPTZ,
  last_since TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.hub_sync_state TO service_role;
ALTER TABLE public.hub_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hub_sync_state_service_only" ON public.hub_sync_state FOR ALL TO service_role USING (true) WITH CHECK (true);
INSERT INTO public.hub_sync_state (id) VALUES ('contacts') ON CONFLICT DO NOTHING;

-- Track hub id + version on contacts for reconciliation
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS hub_contact_id UUID,
  ADD COLUMN IF NOT EXISTS hub_version INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hub_last_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS contacts_hub_contact_id_idx ON public.contacts (hub_contact_id);

-- Trigger fn: enqueue outbox on contact change
CREATE OR REPLACE FUNCTION public.enqueue_hub_contact_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op TEXT;
  v_contact_type TEXT;
  v_payload JSONB;
  v_target RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_op := 'delete';
    v_target := OLD;
  ELSE
    v_target := NEW;
    IF NEW.is_deleted IS TRUE AND (TG_OP = 'INSERT' OR OLD.is_deleted IS DISTINCT FROM TRUE) THEN
      v_op := 'delete';
    ELSE
      v_op := 'upsert';
    END IF;
  END IF;

  -- Skip if triggered by an inbound pull (marker column)
  IF TG_OP <> 'DELETE' AND NEW.hub_last_synced_at IS NOT NULL
     AND OLD IS NOT NULL
     AND NEW.hub_version IS DISTINCT FROM OLD.hub_version
     AND NEW.updated_at = NEW.hub_last_synced_at THEN
    RETURN NEW;
  END IF;

  v_contact_type := CASE
    WHEN v_target.email IS NOT NULL AND length(trim(v_target.email)) > 0 THEN 'mixed'
    ELSE 'mlm'
  END;

  IF v_op = 'delete' THEN
    v_payload := jsonb_build_object(
      'remote_id', v_target.id,
      'reason', 'contact_deleted'
    );
  ELSE
    v_payload := jsonb_build_object(
      'remote_id', v_target.id,
      'full_name', v_target.name,
      'phone_e164', v_target.phone,
      'email', v_target.email,
      'contact_type', v_contact_type,
      'version', COALESCE(v_target.hub_version, 0) + 1,
      'metadata', jsonb_build_object(
        'lead_type', v_target.lead_type,
        'temperature', v_target.temperature
      )
    );
  END IF;

  INSERT INTO public.hub_outbox (contact_id, op, payload, hub_contact_id)
  VALUES (v_target.id, v_op, v_payload, v_target.hub_contact_id);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_hub_sync ON public.contacts;
CREATE TRIGGER trg_contacts_hub_sync
AFTER INSERT OR UPDATE OR DELETE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.enqueue_hub_contact_sync();
