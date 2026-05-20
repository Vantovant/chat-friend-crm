-- Partial unique index: enforces "one batch per source post" for all rows created from now on.
-- Historical duplicates (pre-cutoff) remain for audit; future inserts cannot duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS fb_generated_posts_source_variant_unique
  ON public.fb_generated_posts (fb_source_post_id, variant)
  WHERE created_at > '2026-05-20 15:30:00+00';