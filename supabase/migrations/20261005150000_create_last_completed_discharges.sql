create table if not exists public.last_completed_discharges (
  bed_key text primary key,
  unit text not null,
  bed_number text not null,
  source_answer_id bigint not null,
  staff_name text,
  started_at timestamptz,
  completed_at timestamptz not null,
  duration_minutes integer,
  recorded_at timestamptz not null default now(),
  constraint last_completed_discharges_duration_valid
    check (duration_minutes is null or duration_minutes >= 0)
);

alter table public.last_completed_discharges enable row level security;

comment on table public.last_completed_discharges is
  'One replaceable snapshot per unit + bed. Written and read only by server-side service-role code.';

