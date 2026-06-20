-- Dostluk maçı (is_friendly=true) HİÇBİR kalıcı etki bırakmaz: ELO/Kupa, XP,
-- seviye, Veri, lig/sezon ve galibiyet/mağlubiyet İSTATİSTİĞİ dahil hiçbir
-- kayıt değişmez (kazanan ve kaybeden için). Ayrıca dostluk odaları matchmaking
-- kuyruğuna ASLA düşmez (yalnız oda koduyla eşleşir).
--
-- ─── ÖDÜL/KAYIT YOLLARININ TAMAMI (sunucu-tarafı; client atlama YETMEZ) ──
-- TÜM maç-sonu ödül YAZIMI tek choke-point'ten geçer: _apply_rating(m). 6
-- bitiş yolu (make_guess win/timeout, claim_timeout, forfeit_disconnect,
-- leave_match, heartbeat-reap, _advance_or_finish) hepsi _apply_rating çağırır
-- → tek kapı ekleyince hepsi kapanır. İstatistikler kolon DEĞİL, maç satırından
-- SAYILIR (get_my_rank, get_leaderboard) → onlara da is_friendly filtresi konur.
--
-- Bu migration ilgili 6 canlı fonksiyonu yürürlükteki tanımından BİREBİR alır;
-- yalnız ★ işaretli is_friendly satır(lar)ı eklenir. (Hızlı/Kelime özel odası
-- zaten mode='private' ile dışlanır; protokol özel odası mode='protocol'
-- olduğundan ranked-eligible'dır → asıl koruma is_friendly'dedir. Bayrak yine
-- de TÜM yollara konur: açık niyet + savunma.)

-- ════════════════════════════════════════════════════════════════════════════
-- 1) _apply_rating (canlı: 20260607000012) — dostlukta HİÇ yazma
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
  -- Matchmade (quick + protocol) puanlıdır; private/offline/DOSTLUK değil.
  if m.mode not in ('quick', 'protocol') or m.status <> 'finished'
     or m.winner is null or m.rating_applied or m.is_friendly then   -- ★ dostluk → çık
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
-- 2) get_match_reveal (canlı: 20260607000012) — dostlukta scored=false
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

  -- İlerleme sayan maç (matchmade) + delta uygulanmış + DOSTLUK DEĞİL.
  scored := m.mode in ('quick', 'protocol') and m.rating_applied and not m.is_friendly;  -- ★

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

-- ════════════════════════════════════════════════════════════════════════════
-- 3) get_my_rank (canlı: 20260607000015) — dostluk maçları G/M'ye SAYILMAZ
-- ════════════════════════════════════════════════════════════════════════════
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
  my_wins bigint;
  my_played bigint;
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
  select count(*) into my_wins
    from matches
   where winner = uid and mode in ('quick', 'protocol') and status = 'finished'
     and not is_friendly;                                            -- ★ dostluk sayılmaz
  select count(*) into my_played
    from matches
   where mode in ('quick', 'protocol') and status = 'finished'
     and not is_friendly                                            -- ★ dostluk sayılmaz
     and (player1 = uid or player2 = uid);
  return jsonb_build_object(
    'rank', my_rank,
    'username', me.username,
    'rating', me.rating,
    'wins', my_wins,
    'played', my_played,
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

-- ════════════════════════════════════════════════════════════════════════════
-- 4) get_leaderboard (canlı: 20260605000009) — dostluk galibiyeti sayılmaz
-- ════════════════════════════════════════════════════════════════════════════
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
         coalesce(w.wins, 0) as wins
    from profiles p
    left join (
      select winner, count(*) as wins
        from matches
       where mode = 'quick' and status = 'finished' and winner is not null
         and not is_friendly                                        -- ★ dostluk sayılmaz
       group by winner
    ) w on w.winner = p.id
   order by p.rating desc, p.username asc, p.id
   limit 100;
$$;
revoke execute on function public.get_leaderboard() from public, anon;
grant execute on function public.get_leaderboard() to authenticated;
revoke execute on function public.get_my_rank() from public, anon;
grant execute on function public.get_my_rank() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) _cancel_unstarted_matchmade (canlı: 20260607000010) — dostluk odasına dokunma
-- ════════════════════════════════════════════════════════════════════════════
-- Protokol DOSTLUK odası mode='protocol' olduğundan, bu fonksiyonun mode-filtresi
-- onu da kapsardı → yeni bir matchmaking araması oyuncunun bekleyen protokol
-- dostluk odasını İPTAL ederdi. is_friendly hariç tutulur (mode='private' Hızlı/
-- Kelime odaları zaten mode-filtresiyle dışarıda; bayrak savunma katmanıdır).
create or replace function public._cancel_unstarted_matchmade(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update matches
     set status = 'cancelled', result = 'cancelled',
         current_turn = null, turn_started_at = null
   where (player1 = p_uid or player2 = p_uid)
     and mode in ('quick', 'protocol')
     and not is_friendly                                            -- ★ dostluk korunur
     and (
       status in ('waiting', 'protocol_select')
       or (status = 'setup' and current_round = 1)
     );
end;
$$;
revoke execute on function public._cancel_unstarted_matchmade(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) find_or_create_protocol_match (canlı: 20260607000016) — dostluk odasına
--    rastgele oyuncu KATILAMAZ (yalnız kodla). JOIN sorgularına is_friendly hariç.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.find_or_create_protocol_match()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  my_rating int;
  band_lo int;
  band_hi int;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  perform _cancel_unstarted_matchmade(uid);

  -- Özel oda vb. bayat artıklar (eski davranış korunur; matchmade üstte kapandı).
  update matches
     set status = 'cancelled', result = 'cancelled',
         current_turn = null, turn_started_at = null
   where (player1 = uid or player2 = uid)
     and (
       (status = 'waiting' and created_at < now() - interval '2 minutes')
       or (status in ('setup', 'protocol_select') and (
             (setup_deadline is not null and setup_deadline < now())
          or (select_deadline is not null and select_deadline < now())
          or (present_deadline is not null and present_deadline < now())
          or created_at < now() - interval '2 minutes'
       ))
     );

  select coalesce(rating, 1000) into my_rating from profiles where id = uid;
  select lo, hi into band_lo, band_hi from _league_bounds(my_rating);

  -- 1) LİG-İÇİ: aynı band, taze waiting, rakipsiz, DOSTLUK DEĞİL.
  select mt.* into m
    from matches mt
    join profiles p on p.id = mt.player1
   where mt.status = 'waiting' and mt.mode = 'protocol'
     and not mt.is_friendly                                         -- ★ dostluk odası eşleşmez
     and mt.player1 <> uid and mt.player2 is null
     and mt.created_at >= now() - interval '2 minutes'
     and p.rating between band_lo and band_hi
   order by mt.created_at
   limit 1
   for update of mt skip locked;

  -- 2) EN YAKIN: band içi yoksa Kupa farkı en küçük olan.
  if not found then
    select mt.* into m
      from matches mt
      join profiles p on p.id = mt.player1
     where mt.status = 'waiting' and mt.mode = 'protocol'
       and not mt.is_friendly                                       -- ★ dostluk odası eşleşmez
       and mt.player1 <> uid and mt.player2 is null
       and mt.created_at >= now() - interval '2 minutes'
     order by abs(p.rating - my_rating), mt.created_at
     limit 1
     for update of mt skip locked;
  end if;

  if found then
    update matches set player2 = uid, status = 'protocol_select' where id = m.id;
    perform _deal_protocol_hand(m.id, m.player1);
    perform _deal_protocol_hand(m.id, uid);
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'protocol_select');
  end if;

  insert into matches (mode, player1, win_target) values ('protocol', uid, 2)
    returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$$;
revoke execute on function public.find_or_create_protocol_match() from public, anon;
grant execute on function public.find_or_create_protocol_match() to authenticated;

notify pgrst, 'reload schema';
