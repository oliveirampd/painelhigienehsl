-- Previsoes operacionais de alta: somente leito/setor/probabilidade, sem dados pessoais.
-- Um novo lote substitui integralmente o anterior dentro de uma unica transacao.
CREATE TABLE IF NOT EXISTS public.discharge_predictions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bed_number text NOT NULL,
  unit text NOT NULL,
  source_sector text NOT NULL,
  probability_text text NOT NULL,
  probability_value numeric(5,2),
  predicted_time text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT discharge_predictions_probability_range
    CHECK (probability_value IS NULL OR (probability_value >= 0 AND probability_value <= 100)),
  CONSTRAINT discharge_predictions_one_bed UNIQUE (unit, bed_number)
);

CREATE INDEX IF NOT EXISTS discharge_predictions_expires_idx
  ON public.discharge_predictions (expires_at);

ALTER TABLE public.discharge_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read discharge predictions" ON public.discharge_predictions;
CREATE POLICY "public read discharge predictions" ON public.discharge_predictions
  FOR SELECT TO anon, authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.discharge_predictions FROM anon, authenticated;
GRANT SELECT ON public.discharge_predictions TO anon, authenticated;
GRANT ALL ON public.discharge_predictions TO service_role;

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
  IF p_expires_at IS NULL OR p_expires_at <= now()
     OR p_expires_at > now() + interval '12 hours' THEN
    RAISE EXCEPTION 'Validade do plantao invalida';
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
    p_expires_at
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
