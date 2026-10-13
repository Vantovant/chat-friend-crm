ALTER TYPE public.lead_type ADD VALUE IF NOT EXISTS 'unclassified';

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS prospect_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_tag text,
  ADD COLUMN IF NOT EXISTS primary_intent text,
  ADD COLUMN IF NOT EXISTS intent_reason text,
  ADD COLUMN IF NOT EXISTS intent_confidence numeric,
  ADD COLUMN IF NOT EXISTS careful_handling boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intent_tagged_at timestamptz;

CREATE TABLE public.contact_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tag text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('source','intent','protected','system')),
  origin text NOT NULL CHECK (origin IN ('ai','manual','system')),
  confidence numeric,
  reason text,
  based_on_message_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, tag)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_tags TO authenticated;
GRANT ALL ON public.contact_tags TO service_role;
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
CREATE INDEX contact_tags_contact_idx ON public.contact_tags(contact_id);

-- Visibility follows the parent contact's own RLS (subquery runs as the caller).
CREATE POLICY "contact_tags visible with contact" ON public.contact_tags FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_id));
CREATE POLICY "contact_tags manual insert" ON public.contact_tags FOR INSERT TO authenticated
  WITH CHECK (origin = 'manual' AND kind = 'protected' AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_id));
CREATE POLICY "contact_tags manual delete" ON public.contact_tags FOR DELETE TO authenticated
  USING (origin = 'manual' AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_id));

-- Manual rows always win: nothing non-manual may overwrite or remove them.
CREATE OR REPLACE FUNCTION public.contact_tags_protect_manual()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.origin = 'manual' AND NEW.origin <> 'manual' THEN
      RAISE EXCEPTION 'contact_tags: manual tag cannot be overwritten by %', NEW.origin;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_contact_tags_protect BEFORE UPDATE ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.contact_tags_protect_manual();

CREATE TABLE public.contact_tag_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  proposed_source text,
  proposed_intent text,
  confidence numeric,
  reason text,
  based_on_message_id uuid,
  would_verify boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.contact_tag_proposals TO authenticated;
GRANT ALL ON public.contact_tag_proposals TO service_role;
ALTER TABLE public.contact_tag_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proposals admin read" ON public.contact_tag_proposals FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());
CREATE POLICY "proposals admin review" ON public.contact_tag_proposals FOR UPDATE TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());

INSERT INTO public.integration_settings (key, value) VALUES
  ('intent_tagger_enabled','true'), ('intent_tagger_min_confidence','0.75')
ON CONFLICT (key) DO NOTHING;