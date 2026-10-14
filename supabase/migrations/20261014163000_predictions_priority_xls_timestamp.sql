-- O XLS de prioridades traz uma data/hora prevista completa.
-- Mantemos predicted_time por compatibilidade com a RPC atual e espelhamos
-- seu valor ISO 8601 em um timestamp tipado para consultas da TV.
ALTER TABLE public.discharge_predictions
  ADD COLUMN IF NOT EXISTS predicted_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_discharge_prediction_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $func$
BEGIN
  IF NEW.predicted_time IS NOT NULL
     AND NEW.predicted_time ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
     AND (NEW.predicted_time LIKE '%Z' OR NEW.predicted_time ~ '[+-]\d{2}:\d{2}$')
  THEN
    NEW.predicted_at := NEW.predicted_time::timestamptz;
  ELSE
    NEW.predicted_at := NULL;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS set_discharge_prediction_timestamp
  ON public.discharge_predictions;
CREATE TRIGGER set_discharge_prediction_timestamp
BEFORE INSERT OR UPDATE OF predicted_time
ON public.discharge_predictions
FOR EACH ROW
EXECUTE FUNCTION public.set_discharge_prediction_timestamp();

COMMENT ON COLUMN public.discharge_predictions.predicted_at
  IS 'Horário da previsão de alta trazido pelo XLS de prioridades, com timezone. Nunca é horário confirmado de saída.';
