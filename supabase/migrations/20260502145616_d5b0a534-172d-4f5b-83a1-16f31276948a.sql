-- Track B: KV pricing hygiene fix
-- 1) Reject the legacy "APLGO Product Pricing Quick Reference (ZAR)" doc that contains forbidden prices
--    (R433.13, R866.25, R1,039.50, R1,386.00, R1,559.25). These are pre-15%-VAT wrong values.
UPDATE public.knowledge_files
SET status = 'rejected',
    updated_at = now()
WHERE id = 'a1000001-0001-0001-0001-000000000002';

-- 2) Sanitize the "ZAZI Final Override" VAT chunk that still contains the literal "15.5%" string,
--    which the LLM mis-parsed as a Rand price ("R15.5"). Replace with safer wording.
UPDATE public.knowledge_chunks
SET chunk_text = replace(
                   replace(chunk_text, '15.5%', 'fifteen-point-five percent (OBSOLETE — do not use)'),
                   'Never mention 15.5%',
                   'Never mention the obsolete VAT rate. VAT is fifteen percent (15 percent)'
                 )
WHERE id = '89dd87d4-1a97-4bb2-8bc4-7e2a8604a5f8';

-- 3) Add a dedicated Premium-pricing chunk (ICE + full Premium line) to the ACTIVE 15% VAT price list,
--    so retrieval surfaces R1,035 / R1,293.75 reliably.
INSERT INTO public.knowledge_chunks (file_id, chunk_index, chunk_text, token_count)
VALUES (
  'bdb1c331-d839-4686-91a2-2e0a1dfb8498',
  9999,
  'PREMIUM COLLECTION PRICING (50 PV each, 15% VAT inclusive, effective 1 May 2025).\n' ||
  'Member price: R1,035.00 incl. VAT (R900.00 excl).\n' ||
  'Retail / Customer Store price: R1,293.75 incl. VAT (R1,125.00 excl).\n\n' ||
  'Products in this Premium tier:\n' ||
  '- ALT (lung & breathing support): Member R1,035.00 / Retail R1,293.75\n' ||
  '- HPR (detox & immune defense): Member R1,035.00 / Retail R1,293.75\n' ||
  '- HRT (heart & circulation): Member R1,035.00 / Retail R1,293.75\n' ||
  '- ICE (digestion, gut comfort, gas, cramping): Member R1,035.00 / Retail R1,293.75\n' ||
  '- MLS (gentle daily cleanse): Member R1,035.00 / Retail R1,293.75\n' ||
  '- LFT (cellular wellness, anti-aging): Member R1,035.00 / Retail R1,293.75\n\n' ||
  'OBSOLETE — never quote: R1,039.50, R433.13, R866.25, R15.5, R549, R649. These are wrong.\n' ||
  'Customer Store link (retail only, sponsor 787262): https://aplshop.com/j/787262\n' ||
  'Associate Enrollment link (member pricing requires registration): https://backoffice.aplgo.com/register/?sp=787262',
  220
);