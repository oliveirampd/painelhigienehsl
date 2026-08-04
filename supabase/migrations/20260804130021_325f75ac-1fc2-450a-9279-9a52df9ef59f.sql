ALTER TABLE public.discharges ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.touch_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Marca o momento real da conclusão, se ainda não estiver preenchido.
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at = now();
  END IF;
  -- Linhas sincronizadas do Listo trazem o timestamp real da rotina;
  -- não sobrescrever status_updated_at.
  IF NEW.external_id IS NOT NULL AND NEW.external_id LIKE 'listo:%' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_updated_at = now();
  END IF;
  RETURN NEW;
END;
$function$;