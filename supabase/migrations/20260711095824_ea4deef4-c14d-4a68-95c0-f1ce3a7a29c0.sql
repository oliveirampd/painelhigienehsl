ALTER TYPE public.discharge_status ADD VALUE IF NOT EXISTS 'completed_with_issues';
-- limpa registros que não são de limpeza terminal de leitos (áreas comuns, camareira, etc.)
DELETE FROM public.discharges WHERE external_id LIKE 'listo:answer:%' AND (bed_number IS NULL OR bed_number NOT ILIKE 'leito%');