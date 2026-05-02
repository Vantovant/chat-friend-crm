-- Remove unsafe backfilled drafts that contain invented pricing (R549/R649 are NOT in approved Knowledge Vault).
-- Approved RLX pricing: Member R431.25 / Retail R862.50 incl 15% VAT.
DELETE FROM public.ai_suggestions
WHERE suggestion_type = 'draft_reply'
  AND status = 'pending'
  AND (
    content::text ILIKE '%R549%'
    OR content::text ILIKE '%R649%'
    OR (content->'prospector'->>'recovered' = 'true' AND content::text ~ 'R[0-9]')
  );