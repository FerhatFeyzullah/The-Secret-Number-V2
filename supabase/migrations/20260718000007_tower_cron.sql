-- ══════════════════════════════════════════════════════════════════════════
-- TURNUVA — "Gizemli Kule" · Faz 3: 3 GÜNLÜK dönem cron'u
--
-- Dönem 3 gün sürer. pg_cron GÜNLÜK çalışır; open_tower_period güncel dönem 3
-- günü doldurduysa yeni tower_periods satırı açar → herkes yeniden girebilir.
-- season_cron deseniyle BLOK GUARD'lı: pg_cron yoksa (ör. test) sessizce atlanır,
-- migration kırılmaz. cron.schedule ad-bazlı upsert'tir → idempotent.
-- ══════════════════════════════════════════════════════════════════════════

-- Dönem açıcı (yalnız cron çağırır; istemciye kapalı). 3 günlük guard içerir.
create or replace function public.open_tower_period()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Günlük çağrılır; yalnız güncel dönem 3 günü doldurduysa yenisini aç.
  if (select now() - max(started_at) from tower_periods) >= interval '3 days' then
    insert into tower_periods (started_at) values (now());
  end if;
end;
$$;
revoke execute on function public.open_tower_period() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  -- Eski haftalık işi (varsa) kaldır → günlük 3-gün-guard'lı işe geç.
  if exists (select 1 from cron.job where jobname = 'tower-weekly-open') then
    perform cron.unschedule('tower-weekly-open');
  end if;
  perform cron.schedule(
    'tower-period-roll',
    '0 0 * * *',
    'select public.open_tower_period();'
  );
  raise notice 'pg_cron: tower-period-roll günlük kuruldu (3 günlük dönem guard).';
exception when others then
  raise notice 'pg_cron kurulamadı (%) — Supabase panelinden etkinleştirin.', sqlerrm;
end $$;
