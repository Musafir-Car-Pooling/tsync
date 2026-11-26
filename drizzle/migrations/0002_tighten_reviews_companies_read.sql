DROP POLICY IF EXISTS "read" ON public.reviews;
CREATE POLICY "read" ON public.reviews FOR SELECT TO authenticated
USING (reviewer_id = auth.uid() OR target_id = (auth.uid())::text OR public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "public read" ON public.companies;
CREATE POLICY "admin read" ON public.companies FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));