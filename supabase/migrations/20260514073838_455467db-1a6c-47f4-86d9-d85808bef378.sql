
ALTER TABLE public.maytapi_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maytapi_inbound_unmatched ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view maytapi messages"
ON public.maytapi_messages FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can manage maytapi messages"
ON public.maytapi_messages FOR ALL
USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can view unmatched"
ON public.maytapi_inbound_unmatched FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update unmatched"
ON public.maytapi_inbound_unmatched FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Service can manage unmatched"
ON public.maytapi_inbound_unmatched FOR ALL
USING (true) WITH CHECK (true);
