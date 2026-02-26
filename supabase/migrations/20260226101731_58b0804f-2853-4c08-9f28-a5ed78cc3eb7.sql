
-- Knowledge Vault tables

-- 1. knowledge_files: admin-uploaded documents organized by collection
CREATE TABLE public.knowledge_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection text NOT NULL CHECK (collection IN ('opportunity','compensation','products','orders','motivation')),
  title text NOT NULL,
  file_name text NOT NULL,
  storage_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','approved','rejected')),
  mode text NOT NULL DEFAULT 'strict' CHECK (mode IN ('strict','assisted')),
  tags text[] DEFAULT '{}',
  version integer DEFAULT 1,
  effective_date timestamptz,
  expiry_date timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage knowledge files" ON public.knowledge_files FOR ALL
  USING (is_admin_or_super_admin()) WITH CHECK (is_admin_or_super_admin());

CREATE POLICY "Authenticated users can view approved files" ON public.knowledge_files FOR SELECT
  USING (auth.uid() IS NOT NULL AND status = 'approved');

-- 2. knowledge_chunks: chunked text from files for search
CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES public.knowledge_files(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  chunk_text text NOT NULL,
  token_count integer DEFAULT 0,
  search_vector tsvector,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view chunks" ON public.knowledge_chunks FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can manage chunks" ON public.knowledge_chunks FOR ALL
  USING (true) WITH CHECK (true);

-- Full-text search index
CREATE INDEX knowledge_chunks_search_idx ON public.knowledge_chunks USING GIN (search_vector);
CREATE INDEX knowledge_chunks_file_id_idx ON public.knowledge_chunks (file_id);

-- Auto-generate tsvector on insert/update
CREATE OR REPLACE FUNCTION public.knowledge_chunks_search_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', NEW.chunk_text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_knowledge_chunks_search
  BEFORE INSERT OR UPDATE OF chunk_text ON public.knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_chunks_search_trigger();

-- 3. ai_citations: links AI replies to knowledge sources
CREATE TABLE public.ai_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid,
  suggestion_id uuid,
  file_id uuid REFERENCES public.knowledge_files(id),
  chunk_id uuid REFERENCES public.knowledge_chunks(id),
  snippet text NOT NULL,
  relevance_score real DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view citations" ON public.ai_citations FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can manage citations" ON public.ai_citations FOR ALL
  USING (true) WITH CHECK (true);

-- 4. ai_suggestions: copilot suggestions per conversation
CREATE TABLE public.ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  suggestion_type text NOT NULL DEFAULT 'nba' CHECK (suggestion_type IN ('nba','draft','script','insight')),
  content jsonb NOT NULL DEFAULT '{}',
  confidence real DEFAULT 0.5,
  mode text DEFAULT 'guidance' CHECK (mode IN ('factual','guidance','motivation')),
  status text DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view suggestions" ON public.ai_suggestions FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can manage suggestions" ON public.ai_suggestions FOR ALL
  USING (true) WITH CHECK (true);

-- 5. ai_feedback: thumbs up/down on suggestions
CREATE TABLE public.ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id uuid NOT NULL REFERENCES public.ai_suggestions(id) ON DELETE CASCADE,
  rating text NOT NULL CHECK (rating IN ('up','down')),
  used_as_is boolean DEFAULT false,
  edited_text text,
  outcome text CHECK (outcome IN ('closed_sale','call_booked','not_interested','follow_up','none')),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own feedback" ON public.ai_feedback FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service can manage feedback" ON public.ai_feedback FOR ALL
  USING (true) WITH CHECK (true);

-- 6. Storage bucket for knowledge files
INSERT INTO storage.buckets (id, name, public) VALUES ('knowledge-vault', 'knowledge-vault', false);

CREATE POLICY "Admins can upload knowledge files" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'knowledge-vault' AND is_admin_or_super_admin());

CREATE POLICY "Admins can manage knowledge files" ON storage.objects FOR ALL
  USING (bucket_id = 'knowledge-vault' AND is_admin_or_super_admin());

CREATE POLICY "Authenticated can read knowledge files" ON storage.objects FOR SELECT
  USING (bucket_id = 'knowledge-vault' AND auth.uid() IS NOT NULL);

-- Full-text search function for knowledge
CREATE OR REPLACE FUNCTION public.search_knowledge(
  query_text text,
  collection_filter text DEFAULT NULL,
  max_results integer DEFAULT 5
)
RETURNS TABLE (
  chunk_id uuid,
  file_id uuid,
  chunk_text text,
  chunk_index integer,
  file_title text,
  file_collection text,
  relevance real
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT
    kc.id AS chunk_id,
    kc.file_id,
    kc.chunk_text,
    kc.chunk_index,
    kf.title AS file_title,
    kf.collection AS file_collection,
    ts_rank(kc.search_vector, plainto_tsquery('english', query_text))::real AS relevance
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_files kf ON kf.id = kc.file_id
  WHERE kf.status = 'approved'
    AND (kf.expiry_date IS NULL OR kf.expiry_date > now())
    AND (collection_filter IS NULL OR kf.collection = collection_filter)
    AND kc.search_vector @@ plainto_tsquery('english', query_text)
  ORDER BY relevance DESC
  LIMIT max_results;
$$;

-- Enable realtime on ai_suggestions for copilot
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_suggestions;
