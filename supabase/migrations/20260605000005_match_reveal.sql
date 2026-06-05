-- Online 1v1: maç sonu gizli sayı ifşası — get_match_reveal RPC
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Gerekçe: kazan/kaybet ekranında iki gizli sayı gösterilecek. secrets tablosu
-- istemciye TAMAMEN kapalı (migration 1: RLS açık + politika yok + revoke).
-- Bu RPC, gizli sayılara YALNIZCA maç bittiğinde (finished) ve çağıran o maçın
-- oyuncusuysa, security definer ile sunucuda erişip döndürür.
--
-- KRİTİK: Maç bitmeden (waiting/setup/active) ya da çağıran oyuncu değilse
-- HİÇBİR sayı dönmez. Rakibin sayısı oyun sürerken asla sızmaz.

create or replace function public.get_match_reveal(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  opp uuid;
  my_digits text;
  opp_digits text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into m from public.matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if uid not in (m.player1, m.player2) then
    raise exception 'not_a_player';
  end if;
  -- Yalnızca bitmiş maçta ifşa; oyun sürerken rakip sayısı ASLA dönmez.
  if m.status <> 'finished' then
    raise exception 'match_not_finished';
  end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;

  select digits into my_digits from public.secrets
   where match_id = p_match_id and player = uid;
  select digits into opp_digits from public.secrets
   where match_id = p_match_id and player = opp;

  -- mine/opponent çağıranın bakış açısından; satır yoksa null (savunmacı).
  return jsonb_build_object('mine', my_digits, 'opponent', opp_digits);
end;
$$;

revoke execute on function public.get_match_reveal(uuid) from public, anon;
grant execute on function public.get_match_reveal(uuid) to authenticated;

-- Doğrulama (panelde elle denenebilir) ------------------------------------------
--
--   -- Oyun sürerken (active) ifşa REDDEDİLİR:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"USER_A"}';
--   select get_match_reveal('ACTIVE_MATCH_ID');  -- beklenen: match_not_finished
--
--   -- Maç bitince yalnızca oyuncular alır, ikisi de döner:
--   select get_match_reveal('FINISHED_MATCH_ID'); -- {"mine":"472","opponent":"315"}
--
--   -- Oyuncu olmayan biri:
--   set local request.jwt.claims = '{"sub":"USER_C"}';
--   select get_match_reveal('FINISHED_MATCH_ID'); -- beklenen: not_a_player
--   reset role;
