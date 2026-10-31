create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

select cron.schedule(
  'listo-terminal-sync',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://painelhigienehsl.williamx2k20x.workers.dev/api/public/hooks/sync-listo360',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'terminal_sync_cron_secret'),
        'X-Scheduler', 'supabase-cron'
      ),
      body := jsonb_build_object('source', 'supabase-cron', 'requested_at', now()),
      timeout_milliseconds := 35000
    ) as request_id;
  $cron$
);
