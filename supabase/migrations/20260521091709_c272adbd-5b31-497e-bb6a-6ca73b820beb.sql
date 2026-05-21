-- Backfill MLS post from webhook payload (body was lost because Graph API enrichment failed)
UPDATE public.fb_source_posts
SET raw_message = E'14. MLS – Multi-spectrum daily cleansing & wellness.\n🌍 Broad-spectrum botanicals for daily cleansing and multi-system wellness.\n✅ Plant-based • Sugar-free • GMO-free\n👉 Order yours: https://onlinecourseformlm.com/shop/mls',
    permalink_url = COALESCE(permalink_url, 'https://onlinecourseformlm.com/shop/mls'),
    posted_at = COALESCE(posted_at, to_timestamp(1779350419))
WHERE fb_post_id = '102068582816960_980268141662615'
  AND raw_message IS NULL;

-- Remove phantom rows created by like/reaction webhook events (no body, no permalink)
DELETE FROM public.fb_source_posts
WHERE raw_message IS NULL
  AND permalink_url IS NULL
  AND posted_at IS NULL
  AND fb_post_id <> '102068582816960_980268141662615';