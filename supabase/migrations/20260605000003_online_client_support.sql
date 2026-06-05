-- Online 1v1: istemci destek parçaları — cancel_waiting RPC + realtime yayını
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Gerekçe: istemci kuyruktan/odadan çıkarken bekleyen maçı kapatmalı; matches
-- tablosunda istemciye UPDATE politikası bilinçli olarak verilmediği için bu da
-- security definer RPC ile yapılır. Ayrıca useMatch hook'unun postgres_changes
-- aboneliği için matches/guesses/presence supabase_realtime yayınına eklenir
-- (secrets ASLA eklenmez — yayında dahi yer almamalı).

-- 1) cancel_waiting -------------------------------------------------------------
-- Henüz rakip bulunmamış (waiting) maçı kurucusu iptal eder; kuyruktan/odadan
-- çıkış budur. waiting'de tek oyuncu player1'dir; _match_for_player bunu doğrular.

create or replace function public.cancel_waiting(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'waiting' then
    raise exception 'not_waiting';
  end if;

  -- Kazanan yok; istatistikler etkilenmez.
  update matches
     set status = 'cancelled',
         result = 'cancelled'
   where id = m.id
   returning * into m;

  return jsonb_build_object('match_id', m.id, 'status', m.status, 'result', m.result);
end;
$$;

revoke execute on function public.cancel_waiting(uuid) from public, anon;
grant execute on function public.cancel_waiting(uuid) to authenticated;

-- 2) Realtime yayını -------------------------------------------------------------
-- postgres_changes aboneliği tabloların supabase_realtime yayınında olmasını
-- ister; olaylar istemciye RLS süzgecinden geçerek gider (matches/guesses/
-- presence SELECT politikaları "yalnızca maçın oyuncuları" der). secrets bu
-- yayına BİLİNÇLİ olarak eklenmiyor.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Yerel/test ortamında yayın olmayabilir; Supabase'de hep vardır.
    raise notice 'supabase_realtime yayını yok, atlanıyor';
    return;
  end if;
  foreach t in array array['matches', 'guesses', 'presence'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- 3) Doğrulama (panelde elle denenebilir) -----------------------------------------
--
--   -- Bekleyen maçı kurucusu iptal edebilmeli:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"USER_A"}';
--   select find_or_create_quick_match();          -- status=waiting
--   select cancel_waiting('MATCH_ID');            -- status=cancelled
--   select cancel_waiting('MATCH_ID');            -- HATA: not_waiting (ikinci kez)
--   reset role;
--
--   -- Yayın içeriği: secrets OLMAMALI:
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'public';
