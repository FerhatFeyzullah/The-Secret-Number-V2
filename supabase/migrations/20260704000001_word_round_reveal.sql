-- Tur-bazlı gizli ifşa: get_round_reveal(match_id, round)
--
-- Gerekçe: Bo3 (kelime + sayı-protokol) maçlarında HER turun sonunda, o turun
-- iki gizli kelimesi/sayısı tur-arası "break" ekranında gösterilecek. Bugün ifşa
-- yalnız maç sonunda (get_match_reveal, status='finished' + son tur) mümkün.
--
-- secrets tablosu tur bazlı kalıcıdır (PK (match_id, player, round); 20260607000003)
-- → geçmiş turların gizlileri korunur. Bu RPC, get_match_reveal deseninin tur-bazlı
-- kardeşidir; tek fark "KARARLAŞMIŞ tur" kapısıdır.
--
-- KRİTİK GÜVENLİK: yalnızca kararlaşmış bir turun gizlisi döner:
--     p_round < current_round            (maç o turu geçti)  VEYA
--     p_round = current_round AND finished (bitmiş son tur).
-- CANLI turun (setup/active) gizlisi ASLA dönmez — çünkü canlı turda iki oyuncunun
-- da satırı secrets'te zaten vardır; bu kapı rakibin canlı kelimesinin sızmasını
-- engeller. secrets üzerindeki RLS/GRANT'lere DOKUNULMAZ; erişim yalnız bu definer
-- fonksiyonla olur (get_match_reveal ile aynı model).

create or replace function public.get_round_reveal(p_match_id uuid, p_round int)
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

  -- Yalnız kararlaşmış tur ifşa edilir; canlı tur ASLA.
  if not (p_round < m.current_round
          or (p_round = m.current_round and m.status = 'finished')) then
    raise exception 'round_not_revealable';
  end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;

  select digits into my_digits from public.secrets
   where match_id = p_match_id and player = uid and round = p_round;
  select digits into opp_digits from public.secrets
   where match_id = p_match_id and player = opp and round = p_round;

  -- mine/opponent çağıranın bakış açısından; satır yoksa null (savunmacı —
  -- setup-timeout ile biten turda bir taraf kelime girmemiş olabilir).
  return jsonb_build_object('mine', my_digits, 'opponent', opp_digits);
end;
$$;

revoke execute on function public.get_round_reveal(uuid, int) from public, anon;
grant execute on function public.get_round_reveal(uuid, int) to authenticated;

notify pgrst, 'reload schema';
