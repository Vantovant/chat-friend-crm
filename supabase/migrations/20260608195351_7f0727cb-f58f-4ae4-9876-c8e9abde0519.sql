CREATE TABLE public.voice_diary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  content text NOT NULL,
  source_type text NOT NULL DEFAULT 'typed' CHECK (source_type IN ('voice','typed')),
  mood text,
  is_pinned boolean NOT NULL DEFAULT false,
  linked_project_ids uuid[] DEFAULT '{}',
  extracted_intents jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_diary_entries TO authenticated;
GRANT ALL ON public.voice_diary_entries TO service_role;

ALTER TABLE public.voice_diary_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own diary entries"
  ON public.voice_diary_entries
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_voice_diary_user_created ON public.voice_diary_entries (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_voice_diary_pinned ON public.voice_diary_entries (user_id, is_pinned) WHERE deleted_at IS NULL AND is_pinned = true;

CREATE TRIGGER voice_diary_updated_at
  BEFORE UPDATE ON public.voice_diary_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();