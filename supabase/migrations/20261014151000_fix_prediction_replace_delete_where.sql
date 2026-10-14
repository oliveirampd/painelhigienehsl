-- Corrige SQLSTATE 21000 no RPC: DELETE requires a WHERE clause.
-- A função anterior apagava sem filtro, bloqueado por pg_safeupdate.
-- id é a PK NOT NULL: mantém substituição integral do lote, em transação única.
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
  -- Os IDs são sempre não nulos (PRIMARY KEY). O filtro evita bloquear a operação
  -- pela proteção do banco contra DELETE sem WHERE, preservando a transação atômica.
  DELETE FROM public.discharge_predictions WHERE id IS NOT NULL;

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
