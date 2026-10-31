create table if not exists public.sync_runtime_state (
  key text primary key,
  lock_until timestamptz not null default to_timestamp(0),
  backoff_until timestamptz not null default to_timestamp(0),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_duration_ms integer,
  last_answers_count integer,
  last_relevant_count integer,
  last_pages integer,
  consecutive_failures integer not null default 0,
  last_error text,
  missing_external_ids jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.sync_runtime_state enable row level security;

revoke all on table public.sync_runtime_state from anon, authenticated;

insert into public.sync_runtime_state (key)
values ('listo360')
on conflict (key) do nothing;
