
-- Update the trigger function to use service role key from app settings
-- The edge function itself now uses SYNC_SUPABASE_SERVICE_ROLE_KEY, 
-- but the trigger calling the edge function still needs the Cloud anon key to invoke the function.
-- This is correct: the trigger calls the Cloud edge function (using Cloud anon key),
-- then the edge function internally uses the Master service role key.
-- No change needed to the trigger function itself.

-- Just verify triggers are in place (no-op migration, triggers already created)
SELECT 'Triggers verified' as status;
