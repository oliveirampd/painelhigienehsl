alter table public.discharges
  add column if not exists service_order text;
