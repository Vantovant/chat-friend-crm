-- Update sister-site URLs to brand domain (onlinecourseformlm.com)
UPDATE public.integration_settings
SET value = 'https://onlinecourseformlm.com/shop/rlx', updated_at = now()
WHERE key = 'sister_site_rlx_url';

UPDATE public.integration_settings
SET value = 'https://onlinecourseformlm.com/shop', updated_at = now()
WHERE key = 'sister_site_shop_url';

UPDATE public.integration_settings
SET value = 'https://onlinecourseformlm.com/blog', updated_at = now()
WHERE key = 'sister_site_blog_url';

-- Replace any project-pal-glue references inside AI Trainer rule instructions/notes
UPDATE public.ai_trainer_rules
SET instruction = REPLACE(instruction, 'project-pal-glue.lovable.app', 'onlinecourseformlm.com'),
    notes = REPLACE(COALESCE(notes,''), 'project-pal-glue.lovable.app', 'onlinecourseformlm.com'),
    updated_at = now()
WHERE instruction ILIKE '%project-pal-glue%' OR notes ILIKE '%project-pal-glue%';