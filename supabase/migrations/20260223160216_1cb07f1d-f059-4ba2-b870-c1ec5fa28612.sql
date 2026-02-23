
-- User AI Settings for BYO API keys
CREATE TABLE IF NOT EXISTS public.user_ai_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'lovable' CHECK (provider IN ('lovable', 'openai', 'gemini')),
  model text DEFAULT 'google/gemini-3-flash-preview',
  api_key_encrypted text,
  key_last4 text,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ai_settings ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own settings
CREATE POLICY "Users manage own AI settings"
  ON public.user_ai_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
