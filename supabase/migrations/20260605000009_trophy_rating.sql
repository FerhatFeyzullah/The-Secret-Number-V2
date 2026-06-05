-- Online 1v1: kupa puanı (ELO/CR tarzı) — _apply_rating + bitiş noktalarına
-- bağlama + lider tablosu okuma RPC'leri.
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Tasarım:
--   * Puan YALNIZCA sunucuda değişir; istemci rating kolonuna yazamaz
--     (kolon-bazlı grant ile donanımlı).
--   * Yalnızca mode='quick' + status='finished' + winner'lı maçlar sayılır;
--     özel oda / iptal / abandon puan dışıdır.
--   * Formül: kazanç = clamp(round(30 + (rakip−ben)/25), 15, 50)
--             kayıp  = clamp(round(−20 + (rakip−ben)/25), −40, −8)
--     puan 0'ın altına inmez.
--   * İdempotanlık: matches.rating_applied guard'ı — maç satırı geçiş anında
--     zaten FOR UPDATE kilitli olduğundan guard yarışsızdır; aynı maça puan
--     iki kez uygulanamaz.

-- 1) Alanlar -----------------------------------------------------------------------

alter table public.profiles
  add column if not exists rating int not null default 1000;

alter table public.matches
  add column if not exists rating_applied boolean not null default false;

-- Geçmiş (puan sistemi öncesi) bitmiş maçları mühürle: geriye dönük puan yok.
update public.matches
   set rating_applied = true
 where status = 'finished' and not rating_applied;

-- Lider tablosu / galibiyet sayımı için indeksler.
create index if not exists profiles_rating_idx
  on public.profiles (rating desc);
create index if not exists matches_winner_finished_idx
  on public.matches (winner)
  where status = 'finished';

-- 2) _apply_rating -----------------------------------------------------------------
-- Bitiş noktalarının, maçı finished yapan UPDATE'in hemen ardından AYNI
-- transaction içinde çağırdığı iç fonksiyon. İstemciden çağrılamaz.

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
  -- Yalnızca puanlı maçlar; rating_applied çifte uygulamayı keser.
  if m.mode <> 'quick' or m.status <> 'finished' or m.winner is null or m.rating_applied then
    return;
  end if;
  loser := case when m.winner = m.player1 then m.player2 else m.player1 end;
  if loser is null then
    return;
  end if;

  -- İki profil satırını DETERMİNİSTİK sırayla kilitle (deadlock önleme).
  perform 1 from profiles where id in (m.winner, loser) order by id for update;

  select rating into r_w from profiles where id = m.winner;
  select rating into r_l from profiles where id = loser;
  if r_w is null or r_l is null then
    return; -- profil satırı yoksa (teorik) puanlama atlanır
  end if;

  -- Kazanan açısından rakip−ben = kaybeden−kazanan; kaybeden açısından tersi.
  gain := least(50, greatest(15, round(30 + (r_l - r_w) / 25.0)::int));
  loss := least(-8, greatest(-40, round(-20 + (r_w - r_l) / 25.0)::int));

  update profiles set rating = greatest(0, rating + gain) where id = m.winner;
  update profiles set rating = greatest(0, rating + loss) where id = loser;
  update matches set rating_applied = true where id = m.id;
end;
$$;

revoke execute on function public._apply_rating(public.matches)
  from public, anon, authenticated;

-- 3) Bitiş noktalarına bağlama -------------------------------------------------------
-- Son tanımlar korunarak (make_guess/forfeit_disconnect: migration 2,
-- leave_match: migration 4, claim_timeout: migration 8) yalnızca finished
-- geçişlerinin ardına `perform _apply_rating(m)` eklendi.

-- 3a) make_guess (iki bitiş dalı: kendi süresi dolmuş -> timeout, win)
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
  -- Tahmin kuralı gizli sayıyla aynı (parseGuess ile birebir).
  if not is_valid_secret(p_digits) then
    raise exception 'invalid_digits';
  end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;

  -- Satranç saati: geçen süreyi çağıranın saatinden düş (sunucu zamanı).
  elapsed_ms := floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  my_clock := (case when uid = m.player1 then m.clock1_ms else m.clock2_ms end) - elapsed_ms;

  if my_clock <= 0 then
    -- Süre dolmuş: çağıran timeout ile kaybeder.
    update matches
       set status = 'finished',
           result = 'timeout',
           winner = opp,
           clock1_ms = case when uid = player1 then 0 else clock1_ms end,
           clock2_ms = case when uid = player2 then 0 else clock2_ms end,
           current_turn = null,
           turn_started_at = null
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
    return jsonb_build_object(
      'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
      'feedback', null, 'current_turn', null,
      'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
  end if;

  -- Rakibin gizli sayısı yalnızca burada, sunucuda okunur; istemciye gitmez.
  select digits into opp_secret from secrets where match_id = m.id and player = opp;
  if not found then
    raise exception 'opponent_secret_missing';
  end if;

  fb := evaluate_guess(opp_secret, p_digits);

  insert into guesses (match_id, guesser, digits, feedback)
  values (m.id, uid, p_digits, fb);

  if fb = 'win' then
    update matches
       set status = 'finished',
           result = 'win',
           winner = uid,
           clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end,
           current_turn = null,
           turn_started_at = null
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
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

  -- Güvenli sonuç: feedback + saatler + sıra + durum. Rakibin sayısı ASLA yok.
  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'feedback', fb, 'current_turn', m.current_turn,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;

-- 3b) claim_timeout (migration 8'deki idempotent sürüm + puan)
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

  -- Idempotent: aktif değilse (zaten bitmiş/iptal) mevcut durumu döndür.
  if m.status <> 'active' then
    return jsonb_build_object(
      'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
      'current_turn', m.current_turn, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
  end if;

  -- Süresi akan taraf = current_turn. Gerçekten dolmuş mu sunucu zamanıyla kontrol.
  elapsed_ms := floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  remaining := (case when m.current_turn = m.player1 then m.clock1_ms else m.clock2_ms end)
               - elapsed_ms;
  if remaining > 0 then
    raise exception 'clock_not_expired';
  end if;

  -- Kaybeden = saati dolan (current_turn), kazanan = diğeri. Çağırandan BAĞIMSIZ.
  loser := m.current_turn;
  win := case when loser = m.player1 then m.player2 else m.player1 end;

  update matches
     set status = 'finished',
         result = 'timeout',
         winner = win,
         clock1_ms = case when loser = player1 then 0 else clock1_ms end,
         clock2_ms = case when loser = player2 then 0 else clock2_ms end,
         current_turn = null,
         turn_started_at = null
   where id = m.id
   returning * into m;
  perform _apply_rating(m);

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'current_turn', null, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;

-- 3c) forfeit_disconnect (migration 2 sürümü + puan)
create or replace function public.forfeit_disconnect(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  opp uuid;
  p public.presence;
  opp_disconnected boolean := false;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'active' then
    raise exception 'match_not_active';
  end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;

  select * into p from presence where match_id = m.id and player = opp;
  if found then
    -- 30 sn penceresi: ya istemci kopuşu bildirdi (disconnected_at), ya da
    -- heartbeat sessizce kesildi (last_seen bayatladı — sert kopuş).
    opp_disconnected :=
      (p.disconnected_at is not null and p.disconnected_at <= now() - interval '30 seconds')
      or (p.disconnected_at is null and p.last_seen <= now() - interval '30 seconds');
  end if;
  -- Presence satırı hiç yoksa karar veremeyiz: no-op.

  if not opp_disconnected then
    return jsonb_build_object('match_id', m.id, 'forfeited', false, 'status', m.status);
  end if;

  update matches
     set status = 'finished',
         result = 'forfeit',
         winner = uid,
         current_turn = null,
         turn_started_at = null
   where id = m.id
   returning * into m;
  perform _apply_rating(m);

  return jsonb_build_object(
    'match_id', m.id, 'forfeited', true,
    'status', m.status, 'result', m.result, 'winner', m.winner);
end;
$$;

-- 3d) leave_match (migration 4 sürümü + puan; yalnızca active→forfeit dalı puanlı)
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

  if m.status in ('waiting', 'setup') then
    -- Kazanan yok; istatistikler etkilenmez.
    update matches
       set status = 'cancelled',
           result = 'cancelled',
           current_turn = null,
           turn_started_at = null
     where id = m.id
     returning * into m;
  else
    -- active: çıkan hükmen kaybeder.
    opp := case when uid = m.player1 then m.player2 else m.player1 end;
    update matches
       set status = 'finished',
           result = 'forfeit',
           winner = opp,
           current_turn = null,
           turn_started_at = null
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'left', true,
    'status', m.status, 'result', m.result, 'winner', m.winner);
end;
$$;

-- 4) RLS: profilleri tüm giriş yapmış kullanıcılar okuyabilsin -----------------------
-- Hassas veri yok (id, username, rating, tarihler). Lider tablosunu ve
-- düellodaki rakip adını çözer.

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  using (auth.uid() is not null);

-- Donanımlaştırma: rating İSTEMCİDEN YAZILAMAZ. profiles_update_own politikası
-- satır bazlıdır; kolon kısıtı grant ile konur — istemci yalnızca username
-- güncelleyebilir (mevcut profil akışı yalnızca bunu yapıyor).
revoke update on table public.profiles from anon, authenticated;
grant update (username) on table public.profiles to authenticated;

-- 5) Okuma RPC'leri -------------------------------------------------------------------

-- Lider tablosu: puana göre azalan ilk 100 ("1224" sıralaması; eşit puan = eşit sıra).
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
       group by winner
    ) w on w.winner = p.id
   order by p.rating desc, p.username asc, p.id
   limit 100;
$$;

-- Çağıranın kendi sırası/puanı — top 100 dışında da çalışır.
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
   where winner = uid and mode = 'quick' and status = 'finished';
  return jsonb_build_object(
    'rank', my_rank, 'username', me.username, 'rating', me.rating, 'wins', my_wins);
end;
$$;

revoke execute on function public.get_leaderboard() from public, anon;
revoke execute on function public.get_my_rank() from public, anon;
grant execute on function public.get_leaderboard() to authenticated;
grant execute on function public.get_my_rank() to authenticated;

-- 6) Doğrulama (panelde elle denenebilir) ----------------------------------------------
--
--   -- Bir quick maçı bitir (win/timeout/forfeit fark etmez), sonra:
--   select username, rating from public.profiles order by rating desc;
--                                   -- kazanan +N, kaybeden -N (1000/1000 için +30/-20)
--   select rating_applied from public.matches where id = 'MATCH_ID';   -- true
--
--   -- Lider tablosu + kendi sıran:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"USER_A"}';
--   select * from public.get_leaderboard();
--   select public.get_my_rank();
--
--   -- İstemci rating yazamaz (kolon grant'i yok):
--   update public.profiles set rating = 9999 where id = auth.uid();
--                                   -- beklenen: permission denied
--   reset role;
