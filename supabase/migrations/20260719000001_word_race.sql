-- ════════════════════════════════════════════════════════════════════════════
-- YENİ ONLINE MOD: "Kelime Yarışı" (word race) — content_type = 'wordrace'
-- ════════════════════════════════════════════════════════════════════════════
--
-- KURAL ÖZETİ
--   • Sunucu TEK bir gizli kelime seçer; İKİ oyuncu AYNI kelimeyi eşzamanlı
--     yarışarak çözer. İlk çözen turu ANINDA alır (rakip donar).
--   • Best-of-3 (win_target=2). Her tur uzunluğu RASTGELE (4/5/6) — iki oyuncuya
--     da aynı kelime → aynı uzunluk (maç kolonu word_length garantisi).
--   • Tur başına 180000 ms (3 dk) ORTAK geri sayım (matches.clock_ms +
--     turn_started_at). Sıra YOK — her oyuncu istediği an, sınırsız tahmin eder.
--   • Süre dolar ve kimse çözemezse tur "en çok ilerleyen"e gider:
--       1) max green (yeşil)  2) eşitse max yellow (sarı)
--       3) yine eşitse o green sayısına ÖNCE ulaşan (guesses.created_at min)
--       4) son çare deterministik p1 (maç sahibi / player1).
--
-- ANTI-CHEAT (kritik) — İki oyuncu AYNI gizli kelimeyi çözdüğü için:
--   • guesses SELECT RLS'i wordrace'te SIKI: oyuncu YALNIZ kendi satırını görür
--     (guesser = auth.uid()). number/word davranışı (iki oyuncu tüm satırları
--     görür) AYNEN korunur (content_type <> 'wordrace' dalı).
--   • Rakip ilerlemesi istemciye YALNIZ toplu sayı olarak iner:
--     matches.p1_best_green/p1_best_yellow/p2_best_green/p2_best_yellow.
--     Harf/dizi/marks ASLA maç satırında değildir.
--   • Gizli kelime istemciye hiçbir zaman inmez; yalnız tur BİTİNCE reveal
--     RPC'siyle (kararlaşmış tur) döner.
--
-- GERİYE UYUM: number/word modlarının davranışı BOZULMAZ. Paylaşılan dispatch'ler
-- (is_valid_secret_for / is_valid_guess_for / evaluate_guess) ve guesses policy'si
-- yalnız EK 'wordrace' dalıyla genişletilir. Idempotent (create or replace / add
-- column if not exists / drop ... if exists).

-- ─── 1) matches.content_type CHECK: 'wordrace' ekle ─────────────────────────
-- Canlı değer kümesi ('number','word') 20260611000001'den; yalnız 'wordrace' eklenir.
alter table public.matches drop constraint if exists matches_content_type_check;
alter table public.matches add constraint matches_content_type_check
  check (content_type in ('number', 'word', 'wordrace'));

-- ─── 1b) word_length uyum CHECK: wordrace de uzunluk TAŞIR (KRİTİK) ─────────
-- Canlı kısıt (20260611000002): (content_type = 'word') = (word_length is not null).
-- wordrace maçları da word_length taşıdığından bu kısıt onları REDDEDERDİ. Geriye
-- uyumlu genişletme: number → uzunluk YOK; word/wordrace → uzunluk ZORUNLU.
alter table public.matches drop constraint if exists matches_word_length_coherence;
alter table public.matches add constraint matches_word_length_coherence
  check ((content_type in ('word', 'wordrace')) = (word_length is not null));

-- ─── 2) matches: rakip-güvenli toplu ilerleme kolonları ─────────────────────
-- Rakibe YALNIZ bu sayılar iner (harf/dizi asla). Standart kelime modundaki
-- yeşil/sarı ilerleme çubuğuyla aynı mantık; tur başında 0'a döner.
alter table public.matches add column if not exists p1_best_green  int not null default 0;
alter table public.matches add column if not exists p1_best_yellow int not null default 0;
alter table public.matches add column if not exists p2_best_green  int not null default 0;
alter table public.matches add column if not exists p2_best_yellow int not null default 0;

-- ─── 2b) guesses.feedback CHECK: wordrace per-harf marks ('G'/'Y'/'X') kabul ─
-- word_race_guess, feedback sütununa Wordle marks dizisini yazar ('GYXXX' vb.).
-- Bu satır wordrace RLS'iyle YALNIZ sahibine görünür (rakibe SIZMAZ) → per-harf
-- diziyi burada tutmak güvenli ve yeniden bağlanınca oyuncunun kendi tahtasını
-- boyamasını sağlar. Kısıt SALT GENİŞLETİLİR: number/word'ün mevcut değerleri
-- ('partial:N' / 'win' / 'digits_correct_wrong_order') aynen geçerli (geriye uyumlu).
alter table public.guesses drop constraint if exists guesses_feedback_check;
alter table public.guesses add constraint guesses_feedback_check
  check (
    feedback ~ '^partial:[0-5]$'
    or feedback = any (array['digits_correct_wrong_order', 'win'])
    or feedback ~ '^[GYX]{4,6}$'
  );

-- ─── 3) Doğrulama dispatch'lerine 'wordrace' dalı (word ile birebir) ─────────
-- secrets/guesses insert trigger'ları (_validate_secret_digits/_validate_guess_digits)
-- matches.content_type'ı ('wordrace') bu dispatch'lere geçirir; dal olmazsa
-- 'unknown_content_type' fırlar. number/word davranışı DEĞİŞMEZ.
create or replace function public.is_valid_secret_for(p_content_type text, p_value text, p_length int default null)
returns boolean
language plpgsql stable
as $$
begin
  if p_content_type = 'number' then
    return public.is_valid_secret(p_value);
  elsif p_content_type in ('word', 'wordrace') then
    return (p_length is null or char_length(p_value) = p_length)
       and exists (select 1 from public.secret_words where word = p_value);
  end if;
  raise exception 'unknown_content_type';
end;
$$;

-- NOT: tahmin havuzu 20260706000000'de TEK havuza (secret_words) birleştirildi
-- (valid_words DROP edildi). Bu yüzden word/wordrace tahmin doğrulaması da
-- secret_words'e bakar — canlı 20260706000000 gövdesi + 'wordrace' dalı.
create or replace function public.is_valid_guess_for(p_content_type text, p_value text, p_length int default null)
returns boolean
language plpgsql stable
as $$
begin
  if p_content_type = 'number' then
    return public.is_valid_secret(p_value);
  elsif p_content_type in ('word', 'wordrace') then
    return (p_length is null or char_length(p_value) = p_length)
       and exists (select 1 from public.secret_words where word = p_value);
  end if;
  raise exception 'unknown_content_type';
end;
$$;

create or replace function public.evaluate_guess(p_content_type text, p_secret text, p_guess text)
returns text
language plpgsql immutable
as $$
begin
  if p_content_type = 'number' then
    return public._evaluate_guess_number(p_secret, p_guess);
  elsif p_content_type in ('word', 'wordrace') then
    return public._evaluate_guess_word(p_secret, p_guess);
  end if;
  raise exception 'unknown_content_type';
end;
$$;

-- ─── 4) guesses SELECT RLS: wordrace'te YALNIZ kendi satırı ──────────────────
-- Canlı policy (20260605000001): using (public.is_match_player(match_id)) → maçın
-- iki oyuncusu TÜM tahmin satırlarını görür. Yeni policy:
--   • guesser = auth.uid()                     → kendi satırın HER ZAMAN görünür.
--   • VEYA maçın oyuncususun AND content_type <> 'wordrace' → number/word'te eski
--     davranış (rakip satırları da görünür) BİREBİR korunur.
-- wordrace'te ikinci dal false → yalnız kendi satırın → gizli kelime SIZMAZ.
drop policy if exists "guesses_select_match_players" on public.guesses;
create policy "guesses_select_match_players"
  on public.guesses for select
  using (
    guesser = auth.uid()
    or exists (
      select 1 from public.matches m
       where m.id = guesses.match_id
         and (m.player1 = auth.uid() or m.player2 = auth.uid())
         and m.content_type <> 'wordrace'
    )
  );

-- ─── 5) _word_race_pick_secret: secret_words havuzundan rastgele kelime ──────
-- Kolon: secret_words.word (generated length ile). Sunucu-içi yardımcı.
create or replace function public._word_race_pick_secret(p_length int)
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select word from public.secret_words where length = p_length order by random() limit 1;
$$;
revoke execute on function public._word_race_pick_secret(int) from public, anon, authenticated;

-- ─── 6) _word_race_begin_round: bir turu başlatır (doğrudan 'active') ────────
-- Rastgele uzunluk → matches.word_length (secret'ten ÖNCE; trigger doğrulaması
-- geçsin) → gizli kelime seç → secrets'e TEK satır (player=player1, round=
-- current_round; iki oyuncuya aynı gizli) → ortak saat başlat + toplu ilerleme 0.
create or replace function public._word_race_begin_round(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  v_len int := 4 + floor(random() * 3)::int;   -- 4 / 5 / 6
  v_secret text;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;

  -- word_length'i secret INSERT'inden ÖNCE set et (trigger is_valid_secret_for
  -- m.word_length ile doğrular → uyumsuz uzunluk 'invalid_digits' olurdu).
  update public.matches set word_length = v_len where id = p_match_id;

  v_secret := public._word_race_pick_secret(v_len);
  if v_secret is null then
    raise exception 'secret_pool_empty';
  end if;

  -- Tek gizli satır yeterli (iki oyuncu aynı kelimeyi çözer); round bazlı.
  insert into public.secrets (match_id, player, digits, round)
  values (p_match_id, m.player1, v_secret, m.current_round)
  on conflict (match_id, player, round) do update set digits = excluded.digits;

  update public.matches
     set turn_started_at = now(),
         p1_best_green = 0, p1_best_yellow = 0,
         p2_best_green = 0, p2_best_yellow = 0,
         status = 'active'
   where id = p_match_id;
end;
$$;
revoke execute on function public._word_race_begin_round(uuid) from public, anon, authenticated;

-- ─── 7) _word_race_progress_winner: "en çok ilerleyen" tiebreak ──────────────
-- Sıralama: (1) max green → (2) max yellow → (3) o green'e ÖNCE ulaşan
-- (guesses.created_at min, green_count = ilgili best; 0-green ise atlanır) →
-- (4) son çare deterministik p1 (player1).
create or replace function public._word_race_progress_winner(m public.matches)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t1 timestamptz;
  t2 timestamptz;
begin
  if m.p1_best_green <> m.p2_best_green then
    return case when m.p1_best_green > m.p2_best_green then m.player1 else m.player2 end;
  end if;
  if m.p1_best_yellow <> m.p2_best_yellow then
    return case when m.p1_best_yellow > m.p2_best_yellow then m.player1 else m.player2 end;
  end if;

  -- Eşit yeşil & sarı → best green sayısına ÖNCE ulaşan (bu turdaki tahminler).
  select min(created_at) into t1 from public.guesses
   where match_id = m.id and round = m.current_round
     and guesser = m.player1 and green_count = m.p1_best_green and m.p1_best_green > 0;
  select min(created_at) into t2 from public.guesses
   where match_id = m.id and round = m.current_round
     and guesser = m.player2 and green_count = m.p2_best_green and m.p2_best_green > 0;

  if t1 is not null and t2 is not null then
    return case when t1 <= t2 then m.player1 else m.player2 end;
  elsif t1 is not null then
    return m.player1;
  elsif t2 is not null then
    return m.player2;
  end if;

  return m.player1;   -- son çare: deterministik p1
end;
$$;
revoke execute on function public._word_race_progress_winner(public.matches) from public, anon, authenticated;

-- ─── 8) _word_race_advance: wordrace-özel tur ilerlet / maç bitir ────────────
-- Standart _advance_or_finish word_length'i yeniden zarlar VE status='setup'
-- yapar (kelime belirleme penceresi). wordrace'te SETUP YOK → ayrı ilerletme:
-- kazananın round_wins++; win_target'a ulaştıysa 'finished' + _apply_rating;
-- değilse current_round++ ve _word_race_begin_round ile doğrudan yeni 'active' tur.
create or replace function public._word_race_advance(p_match_id uuid, p_round_winner uuid, p_result text)
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
  select * into m from public.matches where id = p_match_id for update;
  w1 := m.p1_round_wins + (case when p_round_winner = m.player1 then 1 else 0 end);
  w2 := m.p2_round_wins + (case when p_round_winner = m.player2 then 1 else 0 end);
  winner_wins := case when p_round_winner = m.player1 then w1 else w2 end;

  if winner_wins >= m.win_target then
    update public.matches
       set status = 'finished',
           result = p_result,
           winner = p_round_winner,
           p1_round_wins = w1,
           p2_round_wins = w2,
           turn_started_at = null
     where id = m.id
     returning * into m;
    perform public._apply_rating(m);   -- quick + finished + winner → puanlı
  else
    update public.matches
       set p1_round_wins = w1,
           p2_round_wins = w2,
           current_round = current_round + 1
     where id = m.id
     returning * into m;
    perform public._word_race_begin_round(m.id);   -- yeni tur: yeni gizli + 'active'
    select * into m from public.matches where id = m.id;
  end if;

  return m;
end;
$$;
revoke execute on function public._word_race_advance(uuid, uuid, text) from public, anon, authenticated;

-- ─── 9) find_or_create_quick_match: 'wordrace' dalı ─────────────────────────
-- Gövde canlı tanımdan (20260704000000); yalnız (a) guard'a 'wordrace' eklendi,
-- (b) word dalından KOPYA yeni 'wordrace' dalı eklendi. Fark: ikinci oyuncu
-- katılıp maç dolunca status='setup' YERİNE _word_race_begin_round → doğrudan
-- 'active' (kelime belirleme penceresi YOK; gizliyi sunucu seçer).
create or replace function public.find_or_create_quick_match(p_content_type text default 'number')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if p_content_type not in ('number', 'word', 'wordrace') then
    raise exception 'unknown_content_type';
  end if;

  -- Çağıranın başlamamış kuyruk maçlarını koşulsuz kapat.
  perform _cancel_unstarted_matchmade(uid);

  -- Özel oda vb. bayat artıklar (eski davranış).
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

  -- Çağıranın Kupa'sı + lig bandı (eşleşme filtresi).
  select coalesce(rating, 1000) into my_rating from profiles where id = uid;
  select lo, hi into band_lo, band_hi from _league_bounds(my_rating);

  if p_content_type = 'wordrace' then
    -- KELİME YARIŞI: protokolsüz Bo3 kuyruğu (mode='quick', content_type=
    -- 'wordrace', win_target=2, clock_ms=180000). Lig-içi öncelik + en-yakın
    -- fallback word dalıyla aynı; dolunca setup YERİNE begin_round → 'active'.
    select mt.* into m
      from matches mt
      join profiles p on p.id = mt.player1
     where mt.status = 'waiting' and mt.mode = 'quick'
       and mt.content_type = 'wordrace'
       and mt.player1 <> uid and mt.player2 is null
       and mt.created_at >= now() - interval '2 minutes'
       and p.rating between band_lo and band_hi
     order by mt.created_at
     limit 1
     for update of mt skip locked;

    if not found then
      select mt.* into m
        from matches mt
        join profiles p on p.id = mt.player1
       where mt.status = 'waiting' and mt.mode = 'quick'
         and mt.content_type = 'wordrace'
         and mt.player1 <> uid and mt.player2 is null
         and mt.created_at >= now() - interval '2 minutes'
       order by abs(p.rating - my_rating), mt.created_at
       limit 1
       for update of mt skip locked;
    end if;

    if found then
      -- Katıl → sunucu gizliyi seçer, ortak saat başlar → doğrudan 'active'.
      update matches set player2 = uid where id = m.id;
      perform _word_race_begin_round(m.id);
      return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'active');
    end if;

    -- Yeni wordrace maçı: Bo3 + tur süresi 180 sn + placeholder word_length
    -- (coherence CHECK için; begin_round dolunca yeniden zarlar).
    insert into matches (mode, player1, win_target, content_type, word_length, clock_ms)
    values ('quick', uid, 2, 'wordrace', 4 + floor(random() * 3)::int, 180000)
    returning * into m;
    return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
  end if;

  if p_content_type = 'word' then
    -- KELİME: protokolsüz Bo3 kuyruğu (mode='quick', content_type='word').
    select mt.* into m
      from matches mt
      join profiles p on p.id = mt.player1
     where mt.status = 'waiting' and mt.mode = 'quick'
       and mt.content_type = 'word'
       and mt.player1 <> uid and mt.player2 is null
       and mt.created_at >= now() - interval '2 minutes'
       and p.rating between band_lo and band_hi
     order by mt.created_at
     limit 1
     for update of mt skip locked;

    if not found then
      select mt.* into m
        from matches mt
        join profiles p on p.id = mt.player1
       where mt.status = 'waiting' and mt.mode = 'quick'
         and mt.content_type = 'word'
         and mt.player1 <> uid and mt.player2 is null
         and mt.created_at >= now() - interval '2 minutes'
       order by abs(p.rating - my_rating), mt.created_at
       limit 1
       for update of mt skip locked;
    end if;

    if found then
      update matches set player2 = uid, status = 'setup' where id = m.id;
      return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
    end if;

    insert into matches (mode, player1, win_target, content_type, word_length, clock_ms)
    values ('quick', uid, 2, 'word', 4 + floor(random() * 3)::int, 180000)
    returning * into m;
    return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
  end if;

  -- NUMBER: birebir eski davranış (tek tur quick kuyruğu).
  select mt.* into m
    from matches mt
    join profiles p on p.id = mt.player1
   where mt.status = 'waiting' and mt.mode = 'quick'
     and mt.content_type = 'number'
     and mt.player1 <> uid and mt.player2 is null
     and mt.created_at >= now() - interval '2 minutes'
     and p.rating between band_lo and band_hi
   order by mt.created_at
   limit 1
   for update of mt skip locked;

  if not found then
    select mt.* into m
      from matches mt
      join profiles p on p.id = mt.player1
     where mt.status = 'waiting' and mt.mode = 'quick'
       and mt.content_type = 'number'
       and mt.player1 <> uid and mt.player2 is null
       and mt.created_at >= now() - interval '2 minutes'
     order by abs(p.rating - my_rating), mt.created_at
     limit 1
     for update of mt skip locked;
  end if;

  if found then
    update matches set player2 = uid, status = 'setup' where id = m.id;
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
  end if;

  insert into matches (mode, player1, content_type) values ('quick', uid, 'number')
  returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$function$;

revoke execute on function public.find_or_create_quick_match(text) from public, anon;
grant execute on function public.find_or_create_quick_match(text) to authenticated;

-- ─── 10) word_race_guess: eşzamanlı tahmin (sıra yok, ortak saat) ────────────
-- p_expected_round: istemcinin OYNADIĞI tur (tur guard; null → guard kapalı).
drop function if exists public.word_race_guess(uuid, text);
create or replace function public.word_race_guess(p_match_id uuid, p_digits text, p_expected_round int default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  v_is_p1 boolean;
  v_remaining int;
  v_secret text;
  v_marks text;
  v_green int;
  v_yellow int;
  v_status text;
  v_reveal text := null;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if uid not in (m.player1, m.player2) then
    raise exception 'not_a_player';
  end if;
  if m.status <> 'active' then
    raise exception 'match_not_active';
  end if;

  -- Tur guard (anti-sızma): istemcinin oynadığı tur sunucunun aktif turundan farklıysa
  -- (rakip turu az önce çözüp yeni tur başlattı; realtime gecikme penceresi) geç gelen
  -- tahmini REDDET → yeni tura SIZMAZ. İstemci 'stale_round'u sessizce yutar (realtime
  -- tur-sonu ekranını zaten gösterir).
  if p_expected_round is not null and p_expected_round <> m.current_round then
    raise exception 'stale_round';
  end if;

  v_is_p1 := (uid = m.player1);

  -- Ortak geri sayım (sıra yok). Süre dolduysa tahmin REDDEDİLİR → istemci
  -- claim_word_race_timeout çağırır (turu ilerlemeye göre böler).
  v_remaining := m.clock_ms - floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  if v_remaining <= 0 then
    raise exception 'round_over';
  end if;

  -- Format + havuz doğrulama (birleşik secret_words havuzu; 'word' dalı yeter).
  if char_length(p_digits) <> m.word_length then
    raise exception 'wrong_length';
  end if;
  if not is_valid_guess_for('word', p_digits, m.word_length) then
    raise exception 'word_not_in_pool';
  end if;

  select digits into v_secret
    from secrets where match_id = m.id and round = m.current_round limit 1;
  if v_secret is null then
    raise exception 'secret_missing';
  end if;

  v_marks  := _word_marks(v_secret, p_digits);                       -- 'G'/'Y'/'X'
  v_green  := char_length(v_marks) - char_length(replace(v_marks, 'G', ''));
  v_yellow := char_length(v_marks) - char_length(replace(v_marks, 'Y', ''));

  -- Tahmini kaydet (guesser satırı; wordrace RLS ile rakip GÖREMEZ). green_count/
  -- yellow_count satıra yazılır (rakip-güvenli toplu sayı; trigger de doğrular).
  insert into guesses (match_id, guesser, digits, feedback, round, green_count, yellow_count)
  values (m.id, uid, p_digits, v_marks, m.current_round, v_green, v_yellow);

  -- Bu oyuncunun toplu ilerlemesi (rakibe İNEN tek veri) — greatest.
  if v_is_p1 then
    update matches
       set p1_best_green  = greatest(p1_best_green,  v_green),
           p1_best_yellow = greatest(p1_best_yellow, v_yellow)
     where id = m.id;
  else
    update matches
       set p2_best_green  = greatest(p2_best_green,  v_green),
           p2_best_yellow = greatest(p2_best_yellow, v_yellow)
     where id = m.id;
  end if;

  if v_green = m.word_length then
    -- ÇÖZDÜ: tur ANINDA biter (rakip donar). Turu wordrace-özel ilerlet.
    m := _word_race_advance(m.id, uid, 'win');
    v_reveal := v_secret;
    v_status := case when m.status = 'finished' then 'match_won' else 'round_won' end;
  else
    v_status := 'playing';
    select * into m from matches where id = p_match_id;   -- best_* güncellenmiş
  end if;

  return jsonb_build_object(
    'status',        v_status,
    'marks',         v_marks,
    'green_count',   v_green,
    'yellow_count',  v_yellow,
    'remaining_ms',  greatest(0, v_remaining),
    'p1_round_wins', m.p1_round_wins,
    'p2_round_wins', m.p2_round_wins,
    'current_round', m.current_round,
    'reveal',        v_reveal);
end;
$$;
revoke execute on function public.word_race_guess(uuid, text, int) from public, anon;
grant execute on function public.word_race_guess(uuid, text, int) to authenticated;

-- ─── 11) claim_word_race_timeout: süre dolunca turu ilerlemeye göre böl ──────
-- Süre sunucuda DOĞRULANIR; dolmadıysa 'clock_not_expired' (standart claim_timeout
-- deseni). Dolduysa "en çok ilerleyen" turu alır (_word_race_progress_winner).
create or replace function public.claim_word_race_timeout(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  v_remaining int;
  v_winner uuid;
  v_secret text;
  v_status text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if uid not in (m.player1, m.player2) then
    raise exception 'not_a_player';
  end if;

  -- Zaten çözülmüş/geçmiş: no-op (yarış: rakip az önce çözdü → realtime taşır).
  if m.status <> 'active' then
    return jsonb_build_object(
      'status',        case when m.status = 'finished' then 'match_won' else 'playing' end,
      'reveal',        null,
      'p1_round_wins', m.p1_round_wins,
      'p2_round_wins', m.p2_round_wins,
      'current_round', m.current_round,
      'remaining_ms',  0);
  end if;

  v_remaining := m.clock_ms - floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  if v_remaining > 0 then
    raise exception 'clock_not_expired';
  end if;

  -- Kararlaşacak turun gizlisini reveal için sakla (ilerlemeden ÖNCE oku).
  select digits into v_secret
    from secrets where match_id = m.id and round = m.current_round limit 1;

  v_winner := _word_race_progress_winner(m);
  m := _word_race_advance(m.id, v_winner, 'timeout');

  v_status := case when m.status = 'finished' then 'match_won' else 'round_won' end;

  return jsonb_build_object(
    'status',        v_status,
    'reveal',        v_secret,
    'p1_round_wins', m.p1_round_wins,
    'p2_round_wins', m.p2_round_wins,
    'current_round', m.current_round,
    'remaining_ms',  0);
end;
$$;
revoke execute on function public.claim_word_race_timeout(uuid) from public, anon;
grant execute on function public.claim_word_race_timeout(uuid) to authenticated;

-- ─── 12) word_race_reveal: yalnız KARARLAŞMIŞ turun gizlisi ──────────────────
-- get_round_reveal deseni; wordrace tek gizli → yalnız { secret }. Aktif/gelecek
-- tur ASLA (canlı gizli sızmaz): p_round < current_round VEYA (p_round =
-- current_round AND status='finished').
create or replace function public.word_race_reveal(p_match_id uuid, p_round int)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  v_secret text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into m from matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if uid not in (m.player1, m.player2) then
    raise exception 'not_a_player';
  end if;

  if not (p_round < m.current_round
          or (p_round = m.current_round and m.status = 'finished')) then
    raise exception 'round_not_revealable';
  end if;

  select digits into v_secret
    from secrets where match_id = p_match_id and round = p_round limit 1;

  return jsonb_build_object('secret', v_secret);
end;
$$;
revoke execute on function public.word_race_reveal(uuid, int) from public, anon;
grant execute on function public.word_race_reveal(uuid, int) to authenticated;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- MANUEL DOĞRULAMA (yorum — psql/harness ile koşulur; tüm migration'lar
-- uygulandıktan sonra iki auth kullanıcısı A ve B ile)
-- ════════════════════════════════════════════════════════════════════════════
--
-- -- Kurulum: iki profil (auth.uid() shim harness'te set_config ile taklit edilir)
-- --   :uid_a  = A (player1 / maç sahibi), :uid_b = B (player2)
--
-- -- 1) Eşleşme: A arar (waiting), B arar (dolar → doğrudan 'active').
-- set local role authenticated; select set_config('request.jwt.claim.sub', :'uid_a', true);
-- select find_or_create_quick_match('wordrace');   -- {status:'waiting', role:'player1'}
-- select set_config('request.jwt.claim.sub', :'uid_b', true);
-- select find_or_create_quick_match('wordrace');   -- {status:'active',  role:'player2'}
-- --   → matches: content_type='wordrace', status='active', clock_ms=180000,
-- --     word_length ∈ {4,5,6}, current_round=1, p*_best_green/yellow=0;
-- --     secrets: TEK satır (player=player1, round=1).
--
-- -- 2) A yanlış tahmin → marks döner (kendi tahtası), green/yellow_count satıra yazılır.
-- select set_config('request.jwt.claim.sub', :'uid_a', true);
-- select word_race_guess(:'match_id', <geçerli-yanlış-kelime>);
-- --   → {status:'playing', marks:'GYX...', green_count, yellow_count, remaining_ms>0,
-- --      current_round:1, reveal:null}. matches.p1_best_green/yellow güncellendi.
--
-- -- 3) RLS: B, A'nın guess satırını GÖREMEZ (wordrace anti-cheat).
-- select set_config('request.jwt.claim.sub', :'uid_b', true);
-- select count(*) from guesses where match_id = :'match_id';   -- BEKLENEN: 0
-- --   (B henüz tahmin etmedi; A'nın satırı guesser<>B olduğu için RLS ile gizli.)
-- --   Karşılaştırma: aynı senaryo content_type='word' maçında count = A'nın tahmin
-- --   sayısı (eski davranış korunur).
--
-- -- 4) A doğru tahmin (gizli = word_race_reveal ile DOĞRULANAMAZ çünkü tur aktif;
-- --    harness'te secrets'i definer sorguyla oku) → round_won + reveal.
-- select set_config('request.jwt.claim.sub', :'uid_a', true);
-- select word_race_guess(:'match_id', <gizli-kelime>);
-- --   → {status:'round_won', green_count=word_length, reveal:<gizli>, current_round:2,
-- --      p1_round_wins:1}. Yeni tur otomatik 'active', yeni gizli, best_*=0.
--
-- -- 5) Süre dolumu → ilerlemeye göre kazanan (tiebreak).
-- --    (Harness'te turn_started_at'i geçmişe çek: update matches set
-- --     turn_started_at = now() - interval '200 seconds' where id=:match_id;)
-- select claim_word_race_timeout(:'match_id');
-- --   remaining>0 iken: EXCEPTION 'clock_not_expired'. Dolmuşken:
-- --   {status:'round_won'|'match_won', reveal:<gizli>, p*_round_wins, current_round}.
-- --   Kazanan: max green → max yellow → min created_at (o green'e önce ulaşan) → p1.
--
-- -- 6) Maç bitişi (2 tur alan) → rating uygulanır.
-- --   status='finished', winner set → _apply_rating: profiles.rating/wins/played,
-- --   matches.rating_applied=true + p*_rating_delta güncellenir (mode='quick',
-- --   is_friendly=false kapısı geçer).
-- select word_race_reveal(:'match_id', 1);   -- {secret:<1. tur gizlisi>} (kararlaşmış)
-- select word_race_reveal(:'match_id', <current_round>);  -- finished ise son tur gizlisi
-- ════════════════════════════════════════════════════════════════════════════
