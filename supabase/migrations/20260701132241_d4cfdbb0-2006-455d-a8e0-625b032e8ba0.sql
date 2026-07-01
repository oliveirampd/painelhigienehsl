
CREATE TYPE public.discharge_status AS ENUM ('waiting_cleaning','en_route','in_progress','paused','maintenance','completed');
CREATE TYPE public.staff_status AS ENUM ('available','assigned','coffee_break','lunch_break','dinner_break','off_duty');

CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status public.staff_status NOT NULL DEFAULT 'available',
  status_updated_at timestamptz NOT NULL DEFAULT now(),
  current_discharge_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO anon, authenticated;
GRANT ALL ON public.staff TO service_role;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read staff" ON public.staff FOR SELECT USING (true);
CREATE POLICY "public write staff" ON public.staff FOR INSERT WITH CHECK (true);
CREATE POLICY "public update staff" ON public.staff FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete staff" ON public.staff FOR DELETE USING (true);

CREATE TABLE public.discharges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bed_number text NOT NULL,
  unit text NOT NULL,
  status public.discharge_status NOT NULL DEFAULT 'waiting_cleaning',
  priority boolean NOT NULL DEFAULT false,
  pause_reason text,
  assigned_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  status_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discharges TO anon, authenticated;
GRANT ALL ON public.discharges TO service_role;
ALTER TABLE public.discharges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read discharges" ON public.discharges FOR SELECT USING (true);
CREATE POLICY "public write discharges" ON public.discharges FOR INSERT WITH CHECK (true);
CREATE POLICY "public update discharges" ON public.discharges FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete discharges" ON public.discharges FOR DELETE USING (true);

ALTER TABLE public.staff ADD CONSTRAINT staff_current_discharge_fk FOREIGN KEY (current_discharge_id) REFERENCES public.discharges(id) ON DELETE SET NULL;

-- Auto-update status_updated_at
CREATE OR REPLACE FUNCTION public.touch_status_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER discharges_touch_status BEFORE UPDATE ON public.discharges
  FOR EACH ROW EXECUTE FUNCTION public.touch_status_updated_at();
CREATE TRIGGER staff_touch_status BEFORE UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.touch_status_updated_at();

-- Realtime
ALTER TABLE public.discharges REPLICA IDENTITY FULL;
ALTER TABLE public.staff REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.discharges;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff;
