-- ════════════════════════════════════════════════════════════════════════════
-- Haftalık sezon sıfırlaması zamanlaması: pg_cron ile her Pazartesi 00:00 UTC
-- → public.reset_season(). pg_cron Supabase'de mevcuttur ama paneldan
-- etkinleştirilmesi gerekebilir; bu yüzden BLOK GUARD'lı: eklenti yoksa (ör.
-- test ortamı) sessizce atlanır, migration kırılmaz. cron.schedule ad-bazlı
-- upsert'tir → tekrar çalıştırmak güvenli (idempotent).
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'league-weekly-reset',
    '0 0 * * 1',
    'select public.reset_season();'
  );
  raise notice 'pg_cron: league-weekly-reset Pazartesi 00:00 UTC kuruldu.';
exception when others then
  -- pg_cron yoksa/yetki yoksa: panelden açılıp aşağıdaki schedule elle koşulmalı.
  raise notice 'pg_cron kurulamadı (%) — Supabase panelinden etkinleştirin.', sqlerrm;
end $$;
