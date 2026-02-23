
-- Phase 3: Extend messages for Twilio provider tracking
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'twilio',
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS status_raw text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Index for fast status callback lookups
CREATE INDEX IF NOT EXISTS idx_messages_provider_message_id ON public.messages (provider_message_id) WHERE provider_message_id IS NOT NULL;

-- Phase 3: Extend conversations for WhatsApp 24h window
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;

-- Allow UPDATE on conversations for service role (status callbacks need it)
-- Add UPDATE policy for conversations so agents can mark read
CREATE POLICY "Authenticated users can update own conversations"
  ON public.conversations
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = conversations.contact_id
      AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())
    )
  );

-- Allow UPDATE on messages for status callback updates (service role handles this)
-- No user-facing UPDATE policy needed since edge functions use service role

-- Enable realtime for messages table (for status updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
