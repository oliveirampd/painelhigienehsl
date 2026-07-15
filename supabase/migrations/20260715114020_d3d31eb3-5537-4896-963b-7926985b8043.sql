CREATE OR REPLACE FUNCTION public.touch_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Linhas sincronizadas do Listo trazem o timestamp real da rotina;
  -- não sobrescrever.
  IF NEW.external_id IS NOT NULL AND NEW.external_id LIKE 'listo:%' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_updated_at = now();
  END IF;
  RETURN NEW;
END;
$function$;