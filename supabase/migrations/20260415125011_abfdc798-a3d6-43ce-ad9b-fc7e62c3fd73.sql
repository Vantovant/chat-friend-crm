
-- Allow admins to manage (insert, update, delete) knowledge chunks
CREATE POLICY "Admins manage chunks"
ON public.knowledge_chunks
FOR ALL
TO authenticated
USING (is_admin_or_super_admin())
WITH CHECK (is_admin_or_super_admin());

-- Reset stuck files back to 'rejected' so they show Force Retry
UPDATE public.knowledge_files SET status = 'rejected' WHERE status = 'processing';
