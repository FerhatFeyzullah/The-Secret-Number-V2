-- Online 1v1: sunucu otoritesi RPC fonksiyonları (security definer)
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Tüm oyun mantığı ve zaman kararları sunucuda (now()); istemci verisine
-- güvenilmez. secrets tablosuna yalnızca buradaki fonksiyonlar erişir ve
-- gizli sayı HİÇBİR dönüş değerinde yer almaz.
--
-- TS ile birebirlik notu: evaluate_guess() aşağıda, src/game/evaluate.ts'teki
-- evaluateGuess() ile aynı sonucu verir:
--   valueMatch = tahmindeki, gizli sayıda da bulunan rakam adedi
--   valueMatch < 3                      -> 'partial:N' (N = valueMatch)
--   valueMatch = 3 ve tahmin = sır      -> 'win'
--     (3 farklı rakam olduğundan "tüm pozisyonlar doğru" <=> dizgi eşitliği;
--      TS'teki digits.every((d,i) => d === secret[i]) ile aynı.)
--   valueMatch = 3 ama pozisyon değil   -> 'digits_correct_wrong_order'
-- Pozisyon eşleşme SAYISI hiçbir dalda hesaplanmaz/saklanmaz/döndürülmez.
-- Tahmin doğrulaması da parseGuess ile aynı: tam 3 hane, 1-9, sıfırsız, tekrarsız.

-- 1) Saf yardımcılar -----------------------------------------------------------

-- Gizli sayı / tahmin kuralı: 1-9, 3 farklı rakam, sıfır yok.
create or replace function public.is_valid_secret(d text)
returns boolean
language sql
immutable
as $$
  select d ~ '^[1-9]{3}$'
    and substring(d, 1, 1) <> substring(d, 2, 1)
    and substring(d, 1, 1) <> substring(d, 3, 1)
    and substring(d, 2, 1) <> substring(d, 3, 1)
$$;

-- Değerlendirme (girdilerin is_valid_secret'tan geçtiği varsayılır).
create or replace function public.evaluate_guess(p_secret text, p_guess text)
returns text
language plpgsql
immutable
as $$
declare
  value_match int := 0;
  i int;
begin
  for i in 1..3 loop
    if position(substring(p_guess, i, 1) in p_secret) > 0 then
      value_match := value_match + 1;
    end if;
  end loop;

  if value_match < 3 then
    return 'partial:' || value_match;
  end if;
  if p_guess = p_secret then
    return 'win';
  end if;
  return 'digits_correct_wrong_order';
end;
$$;

-- 2) Ortak yetki + kilit yardımcısı --------------------------------------------
-- Maç satırını FOR UPDATE ile kilitler (RPC'ler arası yarışları serileştirir)
-- ve çağıranın o maçın oyuncusu olduğunu doğrular. Yalnızca aşağıdaki security
-- definer RPC'lerin içinden çağrılır; istemci rollerine execute verilmez.

create or replace function public._match_for_player(m_id uuid)
returns public.matches
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
  select * into m from matches where id = m_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if uid <> m.player1 and (m.player2 is null or uid <> m.player2) then
    raise exception 'not_a_player';
  end if;
  return m;
end;
$$;

-- 3) Eşleşme: hızlı maç --------------------------------------------------------

create or replace function public.find_or_create_quick_match()
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

  -- Zaten kuyruktaysa aynı maçı döndür (mükerrer waiting kaydı açılmaz).
  select * into m
    from matches
   where status = 'waiting' and mode = 'quick' and player1 = uid
   order by created_at
   limit 1;
  if found then
    return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', m.status);
  end if;

  -- Başkasının bekleyen maçına katıl. FOR UPDATE SKIP LOCKED: iki kullanıcı
  -- aynı anda eşleşmeye çalışırsa aynı satırı kapamazlar (yarış güvenli).
  select * into m
    from matches
   where status = 'waiting' and mode = 'quick'
     and player1 <> uid and player2 is null
   order by created_at
   limit 1
   for update skip locked;

  if found then
    update matches
       set player2 = uid,
           status = 'setup',
           setup_deadline = now() + interval '15 seconds'
     where id = m.id;
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
  end if;

  -- Bekleyen yok: kuyruğa yeni maç aç.
  insert into matches (mode, player1) values ('quick', uid) returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$$;

-- 4) Eşleşme: özel oda ---------------------------------------------------------

create or replace function public.create_private_room()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  -- Karıştırılabilir karakterler yok (0/O, 1/I) — 32 karakter.
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  m public.matches;
  attempt int;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  for attempt in 1..20 loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '')
      into code
      from generate_series(1, 6);
    begin
      insert into matches (mode, player1, room_code)
      values ('private', uid, code)
      returning * into m;
      return jsonb_build_object(
        'match_id', m.id, 'room_code', m.room_code,
        'role', 'player1', 'status', m.status);
    exception when unique_violation then
      -- Kod aktif bir maçla çakıştı (partial unique index) — yeniden üret.
      null;
    end;
  end loop;
  raise exception 'room_code_generation_failed';
end;
$$;

create or replace function public.join_private_room(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  norm_code text := upper(trim(p_code));
  m public.matches;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Devam eden (bitmemiş) maçlar arasında kodu ara; satırı kilitle ki iki
  -- kişi aynı anda katılamasın.
  select * into m
    from matches
   where room_code = norm_code
     and status in ('waiting', 'setup', 'active')
   order by created_at desc
   limit 1
   for update;

  if not found then
    raise exception 'room_not_found';
  end if;
  if m.player1 = uid then
    raise exception 'own_room';
  end if;
  if m.status <> 'waiting' or m.player2 is not null then
    raise exception 'room_full';
  end if;

  update matches
     set player2 = uid,
         status = 'setup',
         setup_deadline = now() + interval '15 seconds'
   where id = m.id;
  return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
end;
$$;

-- 5) Sayı belirleme ------------------------------------------------------------

create or replace function public.set_secret(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
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

  insert into secrets (match_id, player, digits)
  values (m.id, uid, p_digits)
  on conflict (match_id, player) do update set digits = excluded.digits;

  -- İki oyuncu da yazdıysa oyunu başlat. Maç satırı kilitli olduğundan
  -- eşzamanlı iki set_secret çağrısı serileşir; geçiş tam bir kez olur.
  if (select count(*) from secrets where match_id = m.id) = 2 then
    update matches
       set status = 'active',
           current_turn = case when random() < 0.5 then player1 else player2 end,
           turn_started_at = now(),
           clock1_ms = 60000,
           clock2_ms = 60000,
           setup_deadline = null
     where id = m.id;
    return jsonb_build_object('match_id', m.id, 'status', 'active');
  end if;

  return jsonb_build_object('match_id', m.id, 'status', 'setup');
end;
$$;

-- 6) Tahmin (oyunun kalbi — tek atomik transaction) -----------------------------

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

-- 7) Zaman aşımı iddiası --------------------------------------------------------
-- İstemci yerel sayaç gösterir ama karar her zaman sunucunundur.

create or replace function public.claim_timeout(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  elapsed_ms int;
  remaining int;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'active' then
    raise exception 'match_not_active';
  end if;
  if m.current_turn = uid then
    -- Kendi süren için iddia olmaz; kendi timeout'un make_guess'te işlenir.
    raise exception 'cannot_claim_own_timeout';
  end if;

  elapsed_ms := floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  remaining := (case when m.current_turn = m.player1 then m.clock1_ms else m.clock2_ms end)
               - elapsed_ms;

  if remaining > 0 then
    raise exception 'clock_not_expired';
  end if;

  update matches
     set status = 'finished',
         result = 'timeout',
         winner = uid,
         clock1_ms = case when current_turn = player1 then 0 else clock1_ms end,
         clock2_ms = case when current_turn = player2 then 0 else clock2_ms end,
         current_turn = null,
         turn_started_at = null
   where id = m.id
   returning * into m;

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;

-- 8) Kopma sonrası hükmen galibiyet ---------------------------------------------

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

  return jsonb_build_object(
    'match_id', m.id, 'forfeited', true,
    'status', m.status, 'result', m.result, 'winner', m.winner);
end;
$$;

-- 9) Setup zaman aşımı → iptal ---------------------------------------------------

create or replace function public.cancel_setup_timeout(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'setup' then
    raise exception 'not_in_setup';
  end if;
  if m.setup_deadline is null or now() <= m.setup_deadline then
    raise exception 'setup_not_expired';
  end if;
  -- İki sayı da yazılmış olsaydı set_secret maçı çoktan active yapardı;
  -- yine de kilit altında emniyet kontrolü:
  if (select count(*) from secrets where match_id = m.id) = 2 then
    raise exception 'match_already_ready';
  end if;

  -- Kazanan yok; istatistikler etkilenmez.
  update matches
     set status = 'cancelled',
         result = 'cancelled',
         current_turn = null,
         turn_started_at = null
   where id = m.id
   returning * into m;

  return jsonb_build_object('match_id', m.id, 'status', m.status, 'result', m.result);
end;
$$;

-- 10) Heartbeat ------------------------------------------------------------------
-- Sık çağrılır; maç satırını kilitlemez (yarış riski yok: yalnızca kendi
-- presence satırına dokunur). Üyelik kontrolü is_match_player ile.

create or replace function public.heartbeat(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if not is_match_player(p_match_id) then
    raise exception 'not_a_player';
  end if;

  insert into presence (match_id, player, last_seen, disconnected_at)
  values (p_match_id, uid, now(), null)
  on conflict (match_id, player)
    do update set last_seen = now(), disconnected_at = null;

  return jsonb_build_object('ok', true);
end;
$$;

-- 11) Grant'ler -------------------------------------------------------------------
-- Varsayılan olarak fonksiyonlara PUBLIC execute verilir; önce kapat,
-- sonra yalnızca authenticated'a aç. Yardımcılar istemciden çağrılamaz
-- (security definer RPC'ler owner olarak çalıştığı için onlar erişebilir).

revoke execute on function public.is_valid_secret(text) from public, anon, authenticated;
revoke execute on function public.evaluate_guess(text, text) from public, anon, authenticated;
revoke execute on function public._match_for_player(uuid) from public, anon, authenticated;

revoke execute on function public.find_or_create_quick_match() from public, anon;
revoke execute on function public.create_private_room() from public, anon;
revoke execute on function public.join_private_room(text) from public, anon;
revoke execute on function public.set_secret(uuid, text) from public, anon;
revoke execute on function public.make_guess(uuid, text) from public, anon;
revoke execute on function public.claim_timeout(uuid) from public, anon;
revoke execute on function public.forfeit_disconnect(uuid) from public, anon;
revoke execute on function public.cancel_setup_timeout(uuid) from public, anon;
revoke execute on function public.heartbeat(uuid) from public, anon;

grant execute on function public.find_or_create_quick_match() to authenticated;
grant execute on function public.create_private_room() to authenticated;
grant execute on function public.join_private_room(text) to authenticated;
grant execute on function public.set_secret(uuid, text) to authenticated;
grant execute on function public.make_guess(uuid, text) to authenticated;
grant execute on function public.claim_timeout(uuid) to authenticated;
grant execute on function public.forfeit_disconnect(uuid) to authenticated;
grant execute on function public.cancel_setup_timeout(uuid) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;

-- 12) Doğrulama senaryosu (panelde elle denenebilir) -------------------------------
--
-- Önce iki gerçek kullanıcı id'si al:
--   select id, email from auth.users limit 2;
-- Aşağıda USER_A ve USER_B yerine bu uuid'leri koy. Her bloğu begin/rollback
-- içinde çalıştır ki deneme verisi kalmasın.
--
-- begin;
--
-- -- A kuyruğa girer:
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"USER_A"}';
-- select find_or_create_quick_match();          -- role=player1, status=waiting
--
-- -- B katılır, setup'a geçer:
-- set local request.jwt.claims = '{"sub":"USER_B"}';
-- select find_or_create_quick_match();          -- role=player2, status=setup
--
-- -- B sayısını yazar; TEK kişi yazdı diye maç active OLMAMALI:
-- select set_secret('MATCH_ID', '123');         -- status=setup
-- select status from public.matches where id = 'MATCH_ID';  -- setup (B görür)
--
-- -- Geçersiz sayılar reddedilmeli:
-- select set_secret('MATCH_ID', '120');         -- HATA: invalid_digits (sıfır)
-- select set_secret('MATCH_ID', '112');         -- HATA: invalid_digits (tekrar)
--
-- -- A da yazar; maç active olur, ilk sıra rastgele atanır:
-- set local request.jwt.claims = '{"sub":"USER_A"}';
-- select set_secret('MATCH_ID', '456');         -- status=active
--
-- -- Sıra dışı tahmin reddedilmeli (sırası olmayan kullanıcıyla dene):
-- --   current_turn'ü maçtan oku, DİĞER kullanıcının claim'iyle:
-- select make_guess('MATCH_ID', '123');         -- HATA: not_your_turn (sıra onda değilse)
--
-- -- Sıradaki oyuncu tahmin eder; feedback yalnızca partial:N /
-- -- digits_correct_wrong_order / win olabilir, pozisyon bilgisi YOK:
-- select make_guess('MATCH_ID', '789');         -- örn. feedback=partial:0
--
-- -- Win senaryosu: rakibin sırrını bilen tahmin (test için sırrı panelden
-- -- postgres rolüyle okuyabilirsin; istemci rolü OKUYAMAZ — aşağıya bak):
-- select make_guess('MATCH_ID', '456');         -- feedback=win, status=finished, winner=çağıran
--
-- -- Timeout senaryosu: sırası gelenin turn_started_at'ını geriye çek
-- -- (yalnızca test amaçlı, postgres rolüyle):
-- reset role;
-- update public.matches set turn_started_at = now() - interval '2 minutes'
--   where id = 'MATCH_ID';
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"SIRASI_OLMAYAN_USER"}';
-- select claim_timeout('MATCH_ID');             -- status=finished, result=timeout, winner=iddia eden
--
-- -- secrets HİÇBİR yoldan istemciden okunamaz:
-- set local request.jwt.claims = '{"sub":"USER_A"}';
-- select * from public.secrets;                 -- beklenen: permission denied
-- select * from public.secrets where player = 'USER_A';   -- beklenen: permission denied (kendi satırı dahil)
-- select public.evaluate_guess('456','456');    -- beklenen: permission denied (yardımcı da kapalı)
--
-- rollback;
