
-- Remove OLD duplicate triggers (sync_insert_*, sync_update_*, sync_delete_* pattern)
DROP TRIGGER IF EXISTS sync_insert_automations ON public.automations;
DROP TRIGGER IF EXISTS sync_update_automations ON public.automations;
DROP TRIGGER IF EXISTS sync_delete_automations ON public.automations;

DROP TRIGGER IF EXISTS sync_insert_contacts ON public.contacts;
DROP TRIGGER IF EXISTS sync_update_contacts ON public.contacts;
DROP TRIGGER IF EXISTS sync_delete_contacts ON public.contacts;

DROP TRIGGER IF EXISTS sync_insert_conversations ON public.conversations;
DROP TRIGGER IF EXISTS sync_update_conversations ON public.conversations;
DROP TRIGGER IF EXISTS sync_delete_conversations ON public.conversations;

DROP TRIGGER IF EXISTS sync_insert_integration_settings ON public.integration_settings;
DROP TRIGGER IF EXISTS sync_update_integration_settings ON public.integration_settings;
DROP TRIGGER IF EXISTS sync_delete_integration_settings ON public.integration_settings;

DROP TRIGGER IF EXISTS sync_insert_invitations ON public.invitations;
DROP TRIGGER IF EXISTS sync_update_invitations ON public.invitations;
DROP TRIGGER IF EXISTS sync_delete_invitations ON public.invitations;

DROP TRIGGER IF EXISTS sync_insert_messages ON public.messages;
DROP TRIGGER IF EXISTS sync_update_messages ON public.messages;
DROP TRIGGER IF EXISTS sync_delete_messages ON public.messages;

DROP TRIGGER IF EXISTS sync_insert_pipeline_stages ON public.pipeline_stages;
DROP TRIGGER IF EXISTS sync_update_pipeline_stages ON public.pipeline_stages;
DROP TRIGGER IF EXISTS sync_delete_pipeline_stages ON public.pipeline_stages;

DROP TRIGGER IF EXISTS sync_insert_profiles ON public.profiles;
DROP TRIGGER IF EXISTS sync_update_profiles ON public.profiles;
DROP TRIGGER IF EXISTS sync_delete_profiles ON public.profiles;

DROP TRIGGER IF EXISTS sync_insert_sync_runs ON public.sync_runs;
DROP TRIGGER IF EXISTS sync_update_sync_runs ON public.sync_runs;
DROP TRIGGER IF EXISTS sync_delete_sync_runs ON public.sync_runs;

DROP TRIGGER IF EXISTS sync_insert_user_roles ON public.user_roles;
DROP TRIGGER IF EXISTS sync_update_user_roles ON public.user_roles;
DROP TRIGGER IF EXISTS sync_delete_user_roles ON public.user_roles;

DROP TRIGGER IF EXISTS sync_insert_webhook_events ON public.webhook_events;
DROP TRIGGER IF EXISTS sync_update_webhook_events ON public.webhook_events;
DROP TRIGGER IF EXISTS sync_delete_webhook_events ON public.webhook_events;

DROP TRIGGER IF EXISTS sync_insert_workflows ON public.workflows;
DROP TRIGGER IF EXISTS sync_update_workflows ON public.workflows;
DROP TRIGGER IF EXISTS sync_delete_workflows ON public.workflows;

-- Also remove sync triggers from sync_runs and webhook_events to prevent infinite loops
-- (audit inserts → trigger → edge function → more audit inserts → infinite)
DROP TRIGGER IF EXISTS sync_sync_runs_insert ON public.sync_runs;
DROP TRIGGER IF EXISTS sync_sync_runs_update ON public.sync_runs;
DROP TRIGGER IF EXISTS sync_sync_runs_delete ON public.sync_runs;

DROP TRIGGER IF EXISTS sync_webhook_events_insert ON public.webhook_events;
DROP TRIGGER IF EXISTS sync_webhook_events_update ON public.webhook_events;
DROP TRIGGER IF EXISTS sync_webhook_events_delete ON public.webhook_events;
