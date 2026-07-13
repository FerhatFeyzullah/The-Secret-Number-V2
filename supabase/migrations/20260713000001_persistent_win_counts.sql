-- Profil/liderlik istatistikleri (OYNANAN/KAZANILAN) reap edilen `matches` tablosundan
-- SAYILIYORDU (get_my_rank + get_leaderboard `count(*) ... status='finished'`). Ancak
-- reap_finished_matches() biten maçları 15 dk sonra sildiği için sayaçlar neredeyse
-- sıfıra düşüyordu (yalnız son 15 dk sayılıyordu) → istatistikler "bozuk".
--
-- Düzeltme: KALICI sayaçlar profiles.wins / profiles.played. Maç bitişinde _apply_rating
-- (tek choke-point) artırır → reap etkilemez. get_my_rank + get_leaderboard artık bu
-- kolonları okur (matches saymaz). İstemci çıktısı DEĞİŞMEZ (aynı alanlar).
--
-- NOT: reap edilmiş GEÇMİŞ maçlar geri gelmez; backfill yalnız henüz silinmemiş
-- (son ~15 dk) maçları kurtarır. Bundan sonrası kalıcı ve doğru. Sayaçlar puanlı
-- maçları sayar (quick + protocol, dostluk HARİÇ) — _apply_rating'in kapısıyla birebir.

alter table public.profiles add column if not exists wins int not null default 0;
alter table public.profiles add column if not exists played int not null default 0;

-- Backfill: henüz reap edilmemiş puanlı (quick+protocol, dostluk hariç) maçlardan.
update public.profiles p set
  wins = (
    select count(*) from public.matches m
     where m.winner = p.id
       and m.mode in ('quick', 'protocol') and m.status = 'finished' and not m.is_friendly
  ),
  played = (
    select count(*) from public.matches m
     where (m.player1 = p.id or m.player2 = p.id)
       and m.mode in ('quick', 'protocol') and m.status = 'finished' and not m.is_friendly
  );

-- ─── _apply_rating: kalıcı sayaçları da artır (canlı 20260620000002 + wins/played) ───
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
  -- Matchmade (quick + protocol) puanlıdır; private/offline/DOSTLUK değil.
  if m.mode not in ('quick', 'protocol') or m.status <> 'finished'
     or m.winner is null or m.rating_applied or m.is_friendly then
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
         wins = wins + 1,
         played = played + 1,
         xp = xp + 42,
         veri = veri + 70,
         level = _level_for_xp(xp + 42)
   where id = m.winner;
  update profiles
     set rating = greatest(0, rating + loss),
         current_streak = 0,
         played = played + 1,
         xp = xp + 12,
         veri = veri + 15,
         level = _level_for_xp(xp + 12)
   where id = loser;

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

-- ─── get_my_rank: wins/played artık profiles'tan (canlı 20260620000002 gövdesi) ───
create or replace function public.get_my_rank()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  my_rank bigint;
  thresholds int[] := public._xp_thresholds();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into me from profiles where id = uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  select 1 + count(*) into my_rank from profiles where rating > me.rating;
  return jsonb_build_object(
    'rank', my_rank,
    'username', me.username,
    'rating', me.rating,
    'wins', me.wins,
    'played', me.played,
    'streak', me.current_streak,
    'xp', me.xp,
    'level', me.level,
    'veri', me.veri,
    'level_floor', thresholds[me.level],
    'level_next', case
      when me.level >= array_length(thresholds, 1) then null
      else thresholds[me.level + 1]
    end,
    'owned_protocols', to_jsonb(me.owned_protocols),
    'owned_signals', to_jsonb(me.owned_signals),
    'signal_deck', to_jsonb(me.signal_deck),
    'season_id', (select id from seasons order by id desc limit 1));
end;
$$;

-- ─── get_leaderboard: wins artık profiles.wins (quick+protokol; join yok) ───
create or replace function public.get_leaderboard()
returns table (rank bigint, user_id uuid, username text, rating int, wins bigint)
language sql
stable
security definer
set search_path = public
as $$
  select rank() over (order by p.rating desc) as rank,
         p.id as user_id,
         p.username,
         p.rating,
         p.wins::bigint as wins
    from profiles p
   order by p.rating desc, p.username asc, p.id
   limit 100;
$$;

revoke execute on function public.get_leaderboard() from public, anon;
grant execute on function public.get_leaderboard() to authenticated;
revoke execute on function public.get_my_rank() from public, anon;
grant execute on function public.get_my_rank() to authenticated;

notify pgrst, 'reload schema';
