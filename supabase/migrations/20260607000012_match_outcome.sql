-- Faz 4 / Madde 3: maç sonu kazanım (Kupa/XP/Veri delta) sunucudan döner
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- _apply_rating maç sonunda kupa/XP/Veri uyguluyor ama DELTA'yı döndürmüyordu →
-- istemci ne kazandığını/kaybettiğini bilemiyordu. Çözüm: delta'lar maç satırına
-- (oyuncu başına) YAZILIR ve get_match_reveal bunları çağırana döndürür. İstemci
-- yeniden hesaplamaz; otoriter değer sunucudan. (Madde 8 — bitiş sebebi — zaten
-- matches.result/winner'dan istemcide türetiliyor; sunucu değişikliği gerekmez.)

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ŞEMA: oyuncu başına kazanım delta'ları (null = bu maç ilerleme saymadı)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.matches add column if not exists p1_rating_delta int;
alter table public.matches add column if not exists p2_rating_delta int;
alter table public.matches add column if not exists p1_xp_delta int;
alter table public.matches add column if not exists p2_xp_delta int;
alter table public.matches add column if not exists p1_veri_delta int;
alter table public.matches add column if not exists p2_veri_delta int;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) _apply_rating: delta'ları maç satırına da yaz (etkiyle aynı transaction)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._apply_rating(m public.matches)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  loser uuid;
  r_w int;
  r_l int;
  gain int;
  loss int;
begin
  -- Matchmade (quick + protocol) puanlıdır; private/offline değil.
  if m.mode not in ('quick', 'protocol') or m.status <> 'finished'
     or m.winner is null or m.rating_applied then
    return;
  end if;
  loser := case when m.winner = m.player1 then m.player2 else m.player1 end;
  if loser is null then
    return;
  end if;

  perform 1 from profiles where id in (m.winner, loser) order by id for update;

  select rating into r_w from profiles where id = m.winner;
  select rating into r_l from profiles where id = loser;
  if r_w is null or r_l is null then
    return;
  end if;

  gain := least(50, greatest(15, round(30 + (r_l - r_w) / 25.0)::int));
  loss := least(-8, greatest(-40, round(-20 + (r_w - r_l) / 25.0)::int));

  update profiles
     set rating = greatest(0, rating + gain),
         current_streak = current_streak + 1,
         xp = xp + 42,
         veri = veri + 70,
         level = _level_for_xp(xp + 42)
   where id = m.winner;
  update profiles
     set rating = greatest(0, rating + loss),
         current_streak = 0,
         xp = xp + 12,
         veri = veri + 15,
         level = _level_for_xp(xp + 12)
   where id = loser;

  -- Delta'ları maç satırına yaz (oyuncu başına; get_match_reveal döndürür).
  update matches
     set rating_applied = true,
         p1_rating_delta = case when m.winner = m.player1 then gain else loss end,
         p2_rating_delta = case when m.winner = m.player2 then gain else loss end,
         p1_xp_delta = case when m.winner = m.player1 then 42 else 12 end,
         p2_xp_delta = case when m.winner = m.player2 then 42 else 12 end,
         p1_veri_delta = case when m.winner = m.player1 then 70 else 15 end,
         p2_veri_delta = case when m.winner = m.player2 then 70 else 15 end
   where id = m.id;
end;
$$;
revoke execute on function public._apply_rating(public.matches) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) get_match_reveal: gizli sayılar + ÇAĞIRANIN kazanım delta'ları
-- ════════════════════════════════════════════════════════════════════════════
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
  scored boolean;
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
  if m.status <> 'finished' then
    raise exception 'match_not_finished';
  end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;
  select digits into my_digits from public.secrets
   where match_id = p_match_id and player = uid and round = m.current_round;
  select digits into opp_digits from public.secrets
   where match_id = p_match_id and player = opp and round = m.current_round;

  -- İlerleme sayan maç (matchmade) + delta uygulanmışsa kazanım gösterilir.
  scored := m.mode in ('quick', 'protocol') and m.rating_applied;

  return jsonb_build_object(
    'mine', my_digits,
    'opponent', opp_digits,
    'scored', scored,
    'rating_delta', case when uid = m.player1 then m.p1_rating_delta else m.p2_rating_delta end,
    'xp_delta', case when uid = m.player1 then m.p1_xp_delta else m.p2_xp_delta end,
    'veri_delta', case when uid = m.player1 then m.p1_veri_delta else m.p2_veri_delta end);
end;
$$;
revoke execute on function public.get_match_reveal(uuid) from public, anon;
grant execute on function public.get_match_reveal(uuid) to authenticated;

-- PostgREST şema önbelleğini tazele.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Doğrulama (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - quick/protocol bitince: kazanan rating_delta>0, xp +42, veri +70; kaybeden
--     rating_delta<0, xp +12, veri +15; scored=true.
--   - private: scored=false, delta'lar null (gösterim yok).
