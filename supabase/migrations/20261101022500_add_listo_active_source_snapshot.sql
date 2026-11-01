alter table public.sync_runtime_state
  add column if not exists last_active_source jsonb not null default '[]'::jsonb;
