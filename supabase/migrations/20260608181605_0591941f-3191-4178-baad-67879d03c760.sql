
ALTER TABLE public.knowledge_files
  DROP CONSTRAINT IF EXISTS knowledge_files_collection_check;

ALTER TABLE public.knowledge_files
  ADD CONSTRAINT knowledge_files_collection_check
  CHECK (collection = ANY (ARRAY[
    'general','opportunity','compensation','products','orders','motivation','vanto_internal'
  ]));

DO $mig$
DECLARE
  v_file_id uuid;
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing
  FROM public.knowledge_files
  WHERE collection = 'vanto_internal'
    AND title = 'Vanto CRM — Module Cheat-Sheet'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.knowledge_files (collection, title, file_name, status, mode, tags, version)
  VALUES ('vanto_internal', 'Vanto CRM — Module Cheat-Sheet', 'module_cheatsheet.md', 'approved', 'strict', ARRAY['internal','modules','reference'], 1)
  RETURNING id INTO v_file_id;

  INSERT INTO public.knowledge_chunks (file_id, chunk_index, chunk_text) VALUES
  (v_file_id, 0, 'Contacts module — Canonical key is phone_normalized (+E164, ZA default +27, min 11 digits). Partial unique indexes on phone_normalized and whatsapp_id WHERE is_deleted=false. Always find-before-upsert. Soft-delete only (set is_deleted=true). Contact merge supports Smart Merge and bulk merge. Action icons follow precedence: phone_normalized > whatsapp_id > phone_raw.'),
  (v_file_id, 1, 'Lead Types (strict) — Prospect, Registered_Nopurchase, Purchase_Nostatus, Purchase_Status, Expired. Never invent new types. Transitions are linear; Expired is terminal. Stored on contacts.lead_type. Used by Reports, Lead Call queue ordering (distributors first, longest-waiting next), and Workflows.'),
  (v_file_id, 2, 'CRM Pipeline — Kanban stages live in pipeline_stages (stage_order, color). Contacts.stage_id links into it. Every stage change writes a row to contact_activity with activity_type=stage_changed and metadata {from, to}. Permissive RLS uses OR logic: a row is visible if user is created_by, assigned_to, or is Admin/Super Admin.'),
  (v_file_id, 3, 'Inbox & WhatsApp delivery — Outbound 1:1 messages use Twilio API (NEVER headless browser mirroring). Twilio enforces the 24-hour Customer Care Window: free-form messages only allowed within 24h of inbound; outside that window, only approved templates. Maytapi is used for WhatsApp groups only.'),
  (v_file_id, 4, 'Lead Call Report — Distributors (Purchase_Status) appear first, then longest-waiting. AI summaries are generated via summarize-lead-conversation; operator notes are separate and connect to contact_activity. Voice dictation supported. Suggest tasks reads notes and creates plan_tasks rows with source_ref={kind:lead_call, contact_id, summary_id}.'),
  (v_file_id, 5, 'PLAN module (Command Centre) — Tables: plan_tasks, plan_reminders, plan_meetings, plan_notes. All scoped to auth.uid(). plan_tasks.source_ref jsonb links tasks back to contacts/lead_call_summaries. Edge functions: plan-ai-extract-actions (voice/text to structured tasks, POPIA-redacted), plan-suggest-from-notes (scheduled scan of lead_call_summaries + contact_activity). Never auto-write; always confirm.'),
  (v_file_id, 6, 'Group Campaigns — Maytapi-only. scheduled_group_posts enforces fb_auto_target_groups allowlist via DB trigger (enforce_scheduled_group_safety). Facebook-instant source requires future schedule and ≥6 hours spacing between posts to the same group. Expired sale content (APLGO WITH LOVE) is blocked post-26-May-2026.'),
  (v_file_id, 7, 'Knowledge Vault — RAG with knowledge_files + knowledge_chunks (English tsvector). Files have collection, status (approved/draft), expiry_date, version. search_knowledge RPC returns top-k by ts_rank only for approved + unexpired files. Chunking is client-side to bypass worker limits. Collections include general, opportunity, compensation, products, orders, motivation, and vanto_internal (module specs for the AI agent).'),
  (v_file_id, 8, 'Zazi Sync — One-way push from Vanto (nqyyvqcmcyggvlcswkio) to master Zazi project (nvifliqfgtxqmnkfkhhi). Triggered by trigger_sync_to_master on contacts and related tables; sends payload to zazi-sync-all edge function. Schema is locked on the master side — pre-push validation rules apply. Never pull bidirectionally.'),
  (v_file_id, 9, 'Workflows vs Automations — These are SEPARATE modules. Never collapse. Workflows are multi-step sequences (cadences, follow-ups, drip). Automations are single-trigger reactive rules (on contact created, on stage change, on inbound message). Both respect role-based RLS (Agent, Admin, Super Admin) via user_roles + has_role.'),
  (v_file_id, 10, 'AI Agent / PhD Partner — Powered by ai-chat edge function. Default model: google/gemini-3-flash-preview via Lovable AI Gateway. Hybrid routing: Lovable AI first, then user BYO key (OpenAI/Gemini) from user_ai_settings (api_key_encrypted, base64). Streaming via SSE. Citations sourced from search_knowledge RPC. plan_partner mode = chief-of-staff voice for the PLAN page.');
END
$mig$;
