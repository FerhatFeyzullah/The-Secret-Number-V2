-- Faz 3 / Adım 1+2: Loadout temizliği + Protokol Maçı (Best of 3) iskeleti
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- (1) Loadout kavramı tamamen kaldırılır (rastgele-el sistemine geçiş).
-- (2) Yeni mode='protocol' matchmade maç: Best of 3 (win_target=2). Her turun
--     KENDİ gizli sayısı/tahminleri (round bazlı). Hızlı Maç (quick, win_target=1)
--     AYNEN kalır — round mantığı win_target=1'de tek tura çöker.
-- Maç içi protokol ETKİSİ YOK (sonraki adım); burada yalnız çok-turlu yapı.
-- Kupa/XP/Veri (_apply_rating) artık quick + protocol (matchmade) için; özel oda
-- ve offline hariç. Maç bitince bir kez (rating_applied guard).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) LOADOUT TEMİZLİĞİ
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.set_loadout(text[]);
drop function if exists public._loadout_slots(int);
alter table public.profiles drop column if exists loadout;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) ŞEMA: çok-turlu maç alanları
-- ════════════════════════════════════════════════════════════════════════════
alter table public.matches
  add column if not exists win_target int not null default 1;       -- quick=1, protocol=2
alter table public.matches
  add column if not exists current_round int not null default 1;
alter table public.matches
  add column if not exists p1_round_wins int not null default 0;
alter table public.matches
  add column if not exists p2_round_wins int not null default 0;

-- mode'a 'protocol' eklensin.
alter table public.matches drop constraint if exists matches_mode_check;
alter table public.matches
  add constraint matches_mode_check check (mode in ('quick', 'private', 'protocol'));

-- secrets artık tur bazlı: (match_id, player, round).
alter table public.secrets add column if not exists round int not null default 1;
alter table public.secrets drop constraint if exists secrets_pkey;
alter table public.secrets add primary key (match_id, player, round);

-- guesses tur bazlı.
alter table public.guesses add column if not exists round int not null default 1;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) _apply_rating: mod kapısı quick + protocol
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
  update matches set rating_applied = true where id = m.id;
end;
$$;
revoke execute on function public._apply_rating(public.matches) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) _advance_or_finish: tur sonucunu uygula (turu kazanan belli)
-- ════════════════════════════════════════════════════════════════════════════
-- p_round_winner turu kazandı. win_target'a ulaştıysa MAÇ biter (winner + rating);
-- ulaşmadıysa sonraki tura geçilir (yeni belirleme fazı: 8 sn ara + 30 sn = 38 sn
-- setup_deadline; saatler/ready sıfırlanır, present korunur). Güncel maç satırını
-- (kilitli) döndürür. Çağıran m'yi FOR UPDATE ile kilitlemiş olmalıdır.
create or replace function public._advance_or_finish(
  p_match_id uuid,
  p_round_winner uuid,
  p_result text
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  w1 int;
  w2 int;
  winner_wins int;
begin
  select * into m from matches where id = p_match_id;
  w1 := m.p1_round_wins + (case when p_round_winner = m.player1 then 1 else 0 end);
  w2 := m.p2_round_wins + (case when p_round_winner = m.player2 then 1 else 0 end);
  winner_wins := case when p_round_winner = m.player1 then w1 else w2 end;

  if winner_wins >= m.win_target then
    -- MAÇ bitti.
    update matches
       set status = 'finished',
           result = p_result,
           winner = p_round_winner,
           p1_round_wins = w1,
           p2_round_wins = w2,
           current_turn = null,
           turn_started_at = null
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
  else
    -- Tur bitti, maç sürüyor: sonraki turun belirleme fazı.
    update matches
       set p1_round_wins = w1,
           p2_round_wins = w2,
           current_round = current_round + 1,
           status = 'setup',
           setup_deadline = now() + interval '38 seconds',
           current_turn = null,
           turn_started_at = null,
           player1_ready = false,
           player2_ready = false,
           clock1_ms = clock_ms,
           clock2_ms = clock_ms
     where id = m.id
     returning * into m;
  end if;
  return m;
end;
$$;
revoke execute on function public._advance_or_finish(uuid, uuid, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) set_secret: tur bazlı (round = current_round); o turun saatleri kurulur
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.set_secret(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  cnt int;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'setup' then
    raise exception 'not_in_setup';
  end if;
  if m.setup_deadline is not null and now() > m.setup_deadline then
    raise exception 'setup_expired';
  end if;
  if not is_valid_secret(p_digits) then
    raise exception 'invalid_digits';
  end if;

  insert into secrets (match_id, player, digits, round)
  values (m.id, uid, p_digits, m.current_round)
  on conflict (match_id, player, round) do update set digits = excluded.digits;

  select count(*) into cnt from secrets where match_id = m.id and round = m.current_round;

  if cnt = 2 then
    update matches
       set status = 'active',
           current_turn = case
             when m.first_turn_mode = 'creator' then m.player1
             when random() < 0.5 then m.player1
             else m.player2
           end,
           turn_started_at = now(),
           clock1_ms = m.clock_ms,
           clock2_ms = m.clock_ms,
           setup_deadline = null,
           player1_ready = true,
           player2_ready = true
     where id = m.id;
    return jsonb_build_object('match_id', m.id, 'status', 'active');
  end if;

  if uid = m.player1 then
    update matches set player1_ready = true where id = m.id;
  else
    update matches set player2_ready = true where id = m.id;
  end if;

  return jsonb_build_object('match_id', m.id, 'status', 'setup');
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) make_guess: tur bazlı; doğru tahmin/süre dolması TURU bitirir (maçı değil)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.make_guess(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  opp uuid;
  elapsed_ms int;
  my_clock int;
  opp_secret text;
  fb text;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'active' then
    raise exception 'match_not_active';
  end if;
  if m.current_turn <> uid then
    raise exception 'not_your_turn';
  end if;
  if not is_valid_secret(p_digits) then
    raise exception 'invalid_digits';
  end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;

  elapsed_ms := floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  my_clock := (case when uid = m.player1 then m.clock1_ms else m.clock2_ms end) - elapsed_ms;

  if my_clock <= 0 then
    -- Süre doldu: çağıran TURU kaybeder (round winner = rakip).
    perform 1 from matches where id = m.id for update;
    -- Çağıranın saatini 0'a sabitle (gösterim/sonraki tur reset etse de).
    update matches
       set clock1_ms = case when uid = player1 then 0 else clock1_ms end,
           clock2_ms = case when uid = player2 then 0 else clock2_ms end
     where id = m.id;
    m := _advance_or_finish(m.id, opp, 'timeout');
    return jsonb_build_object(
      'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
      'feedback', null, 'current_turn', m.current_turn,
      'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
  end if;

  -- Rakibin O TURDAKİ gizli sayısı (yalnızca sunucuda).
  select digits into opp_secret
    from secrets where match_id = m.id and player = opp and round = m.current_round;
  if not found then
    raise exception 'opponent_secret_missing';
  end if;

  fb := evaluate_guess(opp_secret, p_digits);

  insert into guesses (match_id, guesser, digits, feedback, round)
  values (m.id, uid, p_digits, fb, m.current_round);

  if fb = 'win' then
    -- Çağıran TURU kazandı; kalan süresini yaz (maç biterse anlamlı).
    perform 1 from matches where id = m.id for update;
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end
     where id = m.id;
    m := _advance_or_finish(m.id, uid, 'win');
  else
    -- Sıra rakibe geçer; çağıranın kalan süresi yazılır.
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end,
           current_turn = opp,
           turn_started_at = now()
     where id = m.id
     returning * into m;
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'feedback', fb, 'current_turn', m.current_turn,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) claim_timeout: tur bazlı; idempotent (aktif değilse mevcut durum)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.claim_timeout(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  loser uuid;
  win uuid;
  elapsed_ms int;
  remaining int;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'active' then
    return jsonb_build_object(
      'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
      'current_turn', m.current_turn, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
  end if;

  elapsed_ms := floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  remaining := (case when m.current_turn = m.player1 then m.clock1_ms else m.clock2_ms end)
               - elapsed_ms;
  if remaining > 0 then
    raise exception 'clock_not_expired';
  end if;

  loser := m.current_turn;
  win := case when loser = m.player1 then m.player2 else m.player1 end;

  perform 1 from matches where id = m.id for update;
  update matches
     set clock1_ms = case when loser = player1 then 0 else clock1_ms end,
         clock2_ms = case when loser = player2 then 0 else clock2_ms end
   where id = m.id;
  m := _advance_or_finish(m.id, win, 'timeout');

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'current_turn', m.current_turn, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) get_match_reveal: DECIDING (son) turun iki gizli sayısı
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

  return jsonb_build_object('mine', my_digits, 'opponent', opp_digits);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) find_or_create_protocol_match: ayrı kuyruk, Best of 3 (win_target=2)
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
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Çağıranın ölü maçlarını kapat (bayat waiting / süresi geçmiş setup).
  update matches
     set status = 'cancelled', result = 'cancelled',
         current_turn = null, turn_started_at = null
   where (player1 = uid or player2 = uid)
     and (
       (status = 'waiting' and created_at < now() - interval '2 minutes')
       or (
         status = 'setup' and (
           (setup_deadline is not null and setup_deadline < now())
           or (present_deadline is not null and present_deadline < now())
           or created_at < now() - interval '2 minutes'
         )
       )
     );

  -- Hâlâ taze bir protokol waiting maçın varsa onu döndür.
  select * into m
    from matches
   where status = 'waiting' and mode = 'protocol' and player1 = uid
   order by created_at
   limit 1;
  if found then
    return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', m.status);
  end if;

  -- Başkasının taze protokol waiting maçına katıl (quick havuzundan AYRI).
  select * into m
    from matches
   where status = 'waiting' and mode = 'protocol'
     and player1 <> uid and player2 is null
     and created_at >= now() - interval '2 minutes'
   order by created_at
   limit 1
   for update skip locked;

  if found then
    update matches set player2 = uid, status = 'setup' where id = m.id;
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
  end if;

  -- Bekleyen yok: yeni protokol maçı (Best of 3).
  insert into matches (mode, player1, win_target) values ('protocol', uid, 2)
    returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$$;
revoke execute on function public.find_or_create_protocol_match() from public, anon;
grant execute on function public.find_or_create_protocol_match() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9b) leave_match: maç ortasında çıkış HÜKMEN KAYIP (tur değil, tüm maç)
-- ════════════════════════════════════════════════════════════════════════════
-- waiting / setup(round 1) → iptal (maç henüz başlamadı, kazanan yok).
-- active / setup(round>1)  → forfeit: çıkan kaybeder, rakip kazanır (mid-match).
create or replace function public.leave_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  opp uuid;
begin
  m := _match_for_player(p_match_id);

  if m.status in ('finished', 'cancelled', 'abandoned') then
    return jsonb_build_object(
      'match_id', m.id, 'left', false,
      'status', m.status, 'result', m.result, 'winner', m.winner);
  end if;

  if m.status = 'waiting' or (m.status = 'setup' and m.current_round = 1) then
    -- Maç gerçekten başlamadı: iptal (kazanan yok, istatistik etkilenmez).
    update matches
       set status = 'cancelled', result = 'cancelled',
           current_turn = null, turn_started_at = null
     where id = m.id
     returning * into m;
  else
    -- active ya da turlar arası (setup, round>1): mid-match → hükmen kaybeder.
    opp := case when uid = m.player1 then m.player2 else m.player1 end;
    update matches
       set status = 'finished', result = 'forfeit', winner = opp,
           current_turn = null, turn_started_at = null
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'left', true,
    'status', m.status, 'result', m.result, 'winner', m.winner);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10) get_my_rank: loadout alanları kaldırıldı; wins/played quick + protocol
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
   where winner = uid and mode in ('quick', 'protocol') and status = 'finished';
  select count(*) into my_played
    from matches
   where mode in ('quick', 'protocol') and status = 'finished'
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
    'owned_protocols', to_jsonb(me.owned_protocols));
end;
$$;

-- get_match_reveal / set_secret / make_guess / claim_timeout / get_my_rank
-- grant'leri önceki migration'larda verildi; create or replace korur.

-- ════════════════════════════════════════════════════════════════════════════
-- 11) Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - quick (win_target=1): tek tur — ilk tur kazananı maçı alır (eski davranış).
--   - protocol (win_target=2): 1-0 → tur 2 setup; 1-1 → tur 3; 2-1 → finished.
--   - forfeit (leave_match active): tüm maç biter, rakip kazanır.
--   - _apply_rating yalnız maç bitince bir kez (rating_applied).
