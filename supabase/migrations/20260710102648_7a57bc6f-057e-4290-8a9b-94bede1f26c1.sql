
ALTER TABLE public.discharges ADD COLUMN IF NOT EXISTS external_id TEXT UNIQUE;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS external_id TEXT UNIQUE;
ALTER TABLE public.discharges REPLICA IDENTITY FULL;
ALTER TABLE public.staff REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.discharges; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.staff; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
