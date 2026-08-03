-- Remove permissive public write policies (writes now go through trusted server code)
DROP POLICY IF EXISTS "public write discharges" ON public.discharges;
DROP POLICY IF EXISTS "public update discharges" ON public.discharges;
DROP POLICY IF EXISTS "public delete discharges" ON public.discharges;

DROP POLICY IF EXISTS "public write staff" ON public.staff;
DROP POLICY IF EXISTS "public update staff" ON public.staff;
DROP POLICY IF EXISTS "public delete staff" ON public.staff;

-- Revoke write privileges from the Data API roles; keep read-only access for the panel
REVOKE INSERT, UPDATE, DELETE ON public.discharges FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.staff FROM anon, authenticated;

GRANT SELECT ON public.discharges TO anon, authenticated;
GRANT SELECT ON public.staff TO anon, authenticated;
GRANT ALL ON public.discharges TO service_role;
GRANT ALL ON public.staff TO service_role;