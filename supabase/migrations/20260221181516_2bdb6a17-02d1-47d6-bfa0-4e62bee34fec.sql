
-- Create all 36 sync triggers (12 tables × 3 operations)
-- UPDATE triggers use loop prevention: only fire when last_synced_at hasn't changed

-- PROFILES
CREATE TRIGGER sync_profiles_insert AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_profiles_update AFTER UPDATE ON public.profiles
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_profiles_delete AFTER DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- PIPELINE_STAGES
CREATE TRIGGER sync_pipeline_stages_insert AFTER INSERT ON public.pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_pipeline_stages_update AFTER UPDATE ON public.pipeline_stages
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_pipeline_stages_delete AFTER DELETE ON public.pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- USER_ROLES
CREATE TRIGGER sync_user_roles_insert AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_user_roles_update AFTER UPDATE ON public.user_roles
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_user_roles_delete AFTER DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- CONTACTS
CREATE TRIGGER sync_contacts_insert AFTER INSERT ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_contacts_update AFTER UPDATE ON public.contacts
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_contacts_delete AFTER DELETE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- CONVERSATIONS
CREATE TRIGGER sync_conversations_insert AFTER INSERT ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_conversations_update AFTER UPDATE ON public.conversations
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_conversations_delete AFTER DELETE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- MESSAGES
CREATE TRIGGER sync_messages_insert AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_messages_update AFTER UPDATE ON public.messages
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_messages_delete AFTER DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- AUTOMATIONS
CREATE TRIGGER sync_automations_insert AFTER INSERT ON public.automations
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_automations_update AFTER UPDATE ON public.automations
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_automations_delete AFTER DELETE ON public.automations
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- WORKFLOWS
CREATE TRIGGER sync_workflows_insert AFTER INSERT ON public.workflows
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_workflows_update AFTER UPDATE ON public.workflows
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_workflows_delete AFTER DELETE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- INTEGRATION_SETTINGS
CREATE TRIGGER sync_integration_settings_insert AFTER INSERT ON public.integration_settings
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_integration_settings_update AFTER UPDATE ON public.integration_settings
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_integration_settings_delete AFTER DELETE ON public.integration_settings
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- INVITATIONS
CREATE TRIGGER sync_invitations_insert AFTER INSERT ON public.invitations
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_invitations_update AFTER UPDATE ON public.invitations
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_invitations_delete AFTER DELETE ON public.invitations
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- SYNC_RUNS
CREATE TRIGGER sync_sync_runs_insert AFTER INSERT ON public.sync_runs
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_sync_runs_update AFTER UPDATE ON public.sync_runs
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_sync_runs_delete AFTER DELETE ON public.sync_runs
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

-- WEBHOOK_EVENTS
CREATE TRIGGER sync_webhook_events_insert AFTER INSERT ON public.webhook_events
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_webhook_events_update AFTER UPDATE ON public.webhook_events
FOR EACH ROW WHEN (old.last_synced_at IS NOT DISTINCT FROM new.last_synced_at)
EXECUTE FUNCTION public.trigger_sync_to_master();

CREATE TRIGGER sync_webhook_events_delete AFTER DELETE ON public.webhook_events
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master();
