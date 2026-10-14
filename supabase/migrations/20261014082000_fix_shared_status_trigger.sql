-- Corrige trigger compartilhado por staff e discharges.
-- 'completed' pertence a discharge_status, nunca a staff_status.
-- Mantem os horarios recebidos do Listo e o comportamento das atualizacoes.
CREATE OR REPLACE FUNCTION public.touch_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Apenas leitos tem status 'completed' e coluna completed_at.
  IF TG_RELID = 'public.discharges'::regclass THEN
    IF NEW.status = 'completed'::public.discharge_status
       AND OLD.status IS DISTINCT FROM 'completed'::public.discharge_status
       AND NEW.completed_at IS NULL THEN
      NEW.completed_at = now();
    END IF;
  END IF;

  -- Horarios sincronizados do Listo nao podem ser sobrescritos.
  IF NEW.external_id IS NOT NULL AND NEW.external_id LIKE 'listo:%' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;
