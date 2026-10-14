-- Previsoes de alta persistentes ate novo CSV; somente leito, setor e tipo de alta.
-- A rotina e restrita ao service_role, e o lote e substituido em uma transacao.
ALTER TABLE public.discharge_predictions ALTER COLUMN expires_at DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.replace_discharge_predictions(
  p_rows jsonb,
  p_expires_at timestamptz
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  inserted_count integer;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'Lote de previsoes invalido';
  END IF;
  DELETE FROM public.discharge_predictions;

  INSERT INTO public.discharge_predictions
    (bed_number, unit, source_sector, probability_text,
     probability_value, predicted_time, expires_at)
  SELECT
    substr(trim(src.bed_number), 1, 60),
    substr(trim(src.unit), 1, 120),
    substr(trim(src.source_sector), 1, 120),
    substr(trim(src.probability_text), 1, 80),
    src.probability_value,
    nullif(substr(trim(src.predicted_time), 1, 40), ''),
    NULL::timestamptz
  FROM jsonb_to_recordset(p_rows) AS src(
    bed_number text,
    unit text,
    source_sector text,
    probability_text text,
    probability_value numeric,
    predicted_time text
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$body$;

REVOKE ALL ON FUNCTION public.replace_discharge_predictions(jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_discharge_predictions(jsonb, timestamptz)
  TO service_role;
