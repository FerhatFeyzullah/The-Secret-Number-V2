-- ════════════════════════════════════════════════════════════════════════════
-- Maç verisi otomatik temizliği (retention).
--
-- Amaç: bitmiş/iptal maçlar ve onlara asılı GEÇİCİ veriler sonsuza kadar
-- birikmesin → DB şişmesin. Tek `delete from matches` → tüm match-scoped alt
-- tablolar match_id FK'sı `on delete cascade` olduğundan otomatik temizlenir:
--   secrets, guesses, presence, protocol_hands, match_protocol_uses,
--   match_hidden_state.
--
-- GÜVENLİK (kalıcı varlıklara ASLA dokunulmaz): veri/rating(kupa)/xp/level/
-- current_streak/owned_protocols/owned_signals hepsi public.profiles'ta; bu
-- silme yalnızca `matches` tablosunu hedefler, profiles ayrı tablodur → yapısal
-- olarak etkilenemez. Statik kataloglar (protocols, signals, valid_words,
-- secret_words) maça bağlı değildir → etkilenmez. Maç sonu ödülleri zaten
-- maç biterken _apply_rating ile profiles'a kalıcı işlenir; maçı silmek ödülü
-- geri almaz, yalnızca maçın "ne kadar verdi" tarihçesini (matches.p*_delta) siler.
--
-- ZAMANLAMA TAMPONU: reveal (get_match_reveal), sonuç ekranı ve 30sn yeniden
-- bağlanma penceresi maç bittikten SONRA bu veriyi okur. matches_set_updated_at
-- trigger'ı bitişte updated_at=now() yazar, sonra maç değişmediği için donar; bu
-- yüzden updated_at 15 dk öncesindeyse "bitişten 15 dk geçti" demektir ve güvenle
-- silinir. Rakip bulamadan/kurulumda takılı kalan zombi maçlar (waiting/setup)
-- için 1 saat. 'active' maçlara ASLA dokunulmaz (canlı oyunlar).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.reap_finished_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.matches
  where (
      status in ('finished', 'cancelled', 'abandoned')
      and updated_at < now() - interval '15 minutes'
    )
    or (
      status in ('waiting', 'setup')
      and updated_at < now() - interval '1 hour'
    );
  get diagnostics n = row_count;
  if n > 0 then
    raise notice 'reap_finished_matches: % maç (+cascade alt verileri) silindi.', n;
  end if;
  return n;
end;
$$;

-- Bakım fonksiyonu: yalnızca cron/servis çağırsın; istemciden erişim yok.
revoke all on function public.reap_finished_matches() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- pg_cron zamanlaması: her 5 dk (15 dk pencere için yeterli sıklık).
-- season_cron (20260607000017) ile AYNI guard deseni: pg_cron eklentisi yoksa/
-- yetki yoksa (ör. test ortamı) sessizce atlanır, migration kırılmaz.
-- cron.schedule ad-bazlı upsert'tir → tekrar çalıştırmak güvenli (idempotent).
-- ────────────────────────────────────────────────────────────────────────────
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'match-retention-sweep',
    '*/5 * * * *',
    'select public.reap_finished_matches();'
  );
  raise notice 'pg_cron: match-retention-sweep her 5 dk kuruldu.';
exception when others then
  raise notice 'pg_cron kurulamadı (%) — Supabase panelinden etkinleştirip cron.schedule elle koşun.', sqlerrm;
end $$;
