-- ═══════════════════════════════════════════════════════════════════════════
-- Gizem Çağı — REALTIME etkinleştir (düello REPLICA IDENTITY fix'inin age karşılığı)
-- ═══════════════════════════════════════════════════════════════════════════
-- Tespit: age_matches/age_territories/age_attacks NE supabase_realtime
-- publication'ında NE de FULL replica identity'deydi → istemcinin postgres_changes
-- aboneliği HİÇ event almıyordu; state yalnız 3 sn'lik emniyet poll ile
-- güncelleniyordu (faz/süre/sahiplik geçişleri gecikmeli/janky). Bu, faz
-- sayacının/haritanın "takılı/donuk" hissini besliyor.
--
-- Çözüm (matches/guesses ile aynı desen):
--  1) FULL replica identity → RLS'li tabloda UPDATE/DELETE olayları iletilebilir
--     (policy player1/player2/player3 gibi PK-dışı kolonlara bakıyor).
--  2) supabase_realtime publication'ına ekle → postgres_changes akmaya başlar.
-- age_secrets/age_attack_guesses EKLENMEZ (şifre/tahmin gizli kalır).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.age_matches     replica identity full;
alter table public.age_territories replica identity full;
alter table public.age_attacks     replica identity full;

do $$
begin
  -- Yalnız supabase_realtime varsa (canlı Supabase); çıplak postgres harness'ta atla.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'age_matches') then
      alter publication supabase_realtime add table public.age_matches;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'age_territories') then
      alter publication supabase_realtime add table public.age_territories;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'age_attacks') then
      alter publication supabase_realtime add table public.age_attacks;
    end if;
  end if;
end $$;
