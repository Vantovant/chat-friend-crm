-- Add 'expired' to lead_type enum
ALTER TYPE public.lead_type ADD VALUE IF NOT EXISTS 'expired';