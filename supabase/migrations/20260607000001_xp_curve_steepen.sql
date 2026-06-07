-- Online 1v1: XP eğrisini dikleştir (Faz 1) — daha yavaş, anlamlı seviye atlama
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Değişen (20260607000000'e göre):
--   * Maç başı XP: kazanan +90 → +42, kaybeden +25 → +12. (Veri AYNEN +70/+15;
--     rating ve seri değişmez.)
--   * Seviye eşikleri (kümülatif XP): 0,100,260,500,850,1350,2050,3000,4300,6200.
--     9→10 en büyük duvar (1900). %50 galibiyette maç başı ort. (42+12)/2 = 27 XP
--     → seviye 10 ≈ 6200/27 ≈ 230 maç. İlk galibiyet (42 XP < 100) seviye atlatmaz.
--   * Idempotans (rating_applied) ve mod kapısı (yalnız quick) korunur.
--   * _level_for_xp ve get_my_rank değişmez (eşik tablosunu dinamik okurlar).

-- 1) Yeni eşik tablosu --------------------------------------------------------------
create or replace function public._xp_thresholds()
returns int[]
language sql
immutable
as $$
  select array[0, 100, 260, 500, 850, 1350, 2050, 3000, 4300, 6200];
$$;

revoke execute on function public._xp_thresholds() from public, anon, authenticated;

-- 2) _apply_rating: XP kazanımları 42/12 (gövdenin geri kalanı aynı) --------------
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
  if m.mode <> 'quick' or m.status <> 'finished' or m.winner is null or m.rating_applied then
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

  -- XP dikleştirildi: kazanan +42, kaybeden +12. Veri aynen +70/+15.
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
  update matches set rating_applied = true where id = m.id;
end;
$$;

revoke execute on function public._apply_rating(public.matches)
  from public, anon, authenticated;

-- 3) Doğrulama (panelde elle denenebilir) --------------------------------------------
--   select public._level_for_xp(0), public._level_for_xp(99), public._level_for_xp(100),
--          public._level_for_xp(42), public._level_for_xp(4300), public._level_for_xp(6200),
--          public._level_for_xp(99999);
--   -- beklenen: 1, 1, 2, 1 (ilk galibiyet seviye atlatmaz), 9, 10, 10
