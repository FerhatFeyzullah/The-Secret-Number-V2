-- Kelime modu eşleşmesi (Faz 2B): maç-uzunluğu + ayrı kelime kuyruğu.
--
-- 1) matches.word_length: kelime maçında harf uzunluğu (4/5/6) — maç başına
--    RANDOM atanır (Kader Eli'ndeki random dağıtım deseni), iki oyuncuya da
--    aynı (adalet). Number maçlarda null (tutarlılık CHECK ile zorlanır).
-- 2) Doğrulama artık maç-uzunluğunu geçirir: yanlış uzunlukta secret/tahmin
--    'invalid_digits' ile reddedilir (2A'daki savunmacı length_mismatch
--    guard'ına artık normal akışta düşülmez).
-- 3) find_or_create_quick_match content_type'a göre AYRIŞIR: word oyuncusu
--    yalnız word kuyruğuyla, number yalnız number'la eşleşir. Lig-içi +
--    en-yakın fallback mantığı AYNEN korunur; yalnız content_type filtresi
--    eklenir. Parametre default 'number' → eski çağrılar birebir aynı davranır.
-- 4) Protokol kuyruğuna DOKUNULMAZ: protokoller rakam-uzayına gömülü (Faz 1
--    kararı); kelime maçı yalnız quick. Protokol maçları content_type
--    default'u ile her zaman 'number' doğar.
--
-- set_secret/make_guess/find_or_create_quick_match gövdeleri yürürlükteki
-- canlı tanımlardan (pg_get_functiondef) alınmıştır; yalnız işaretli satırlar
-- değişti. Protokol/saat/yanıltma mantığı el değmedi.

-- ─── 1) Maç-uzunluğu kolonu ────────────────────────────────────────────
alter table public.matches add column if not exists word_length int;

alter table public.matches drop constraint if exists matches_word_length_check;
alter table public.matches add constraint matches_word_length_check
  check (word_length is null or word_length in (4, 5, 6));

-- Tutarlılık: word maçında uzunluk ZORUNLU, number maçında YOK.
alter table public.matches drop constraint if exists matches_word_length_coherence;
alter table public.matches add constraint matches_word_length_coherence
  check ((content_type = 'word') = (word_length is not null));

-- ─── 2) Trigger doğrulamaları maç-uzunluğunu geçirir ───────────────────
create or replace function public._validate_secret_digits()
returns trigger
language plpgsql
as $$
declare
  ct text;
  wl int;
begin
  select content_type, word_length into ct, wl from public.matches where id = new.match_id;
  if ct is null then
    raise exception 'match_not_found';
  end if;
  if not public.is_valid_secret_for(ct, new.digits, wl) then
    raise exception 'invalid_digits';
  end if;
  return new;
end;
$$;

create or replace function public._validate_guess_digits()
returns trigger
language plpgsql
as $$
declare
  ct text;
  wl int;
begin
  select content_type, word_length into ct, wl from public.matches where id = new.match_id;
  if ct is null then
    raise exception 'match_not_found';
  end if;
  if not public.is_valid_guess_for(ct, new.digits, wl) then
    raise exception 'invalid_digits';
  end if;
  return new;
end;
$$;

-- ─── 3) set_secret: doğrulamaya m.word_length (tek değişen satır) ──────
create or replace function public.set_secret(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if not is_valid_secret_for(m.content_type, p_digits, m.word_length) then
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
$function$;

-- ─── 4) make_guess: doğrulamaya m.word_length (tek değişen satır) ──────
create or replace function public.make_guess(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  m public.matches;
  opp uuid;
  my_clock int;
  my_fog boolean;
  my_deceive boolean;
  opp_secret text;
  fb text;
  display_fb text;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'active' then
    raise exception 'match_not_active';
  end if;
  if m.current_turn <> uid then
    raise exception 'not_your_turn';
  end if;
  if not is_valid_guess_for(m.content_type, p_digits, m.word_length) then
    raise exception 'invalid_digits';
  end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;
  my_fog := case when uid = m.player1 then m.fog_p1 else m.fog_p2 end;

  -- Yanıltma durumu KAPALI tablodan (istemciye inmez); satır yoksa false.
  my_deceive := false;
  select case when uid = m.player1 then deceived_p1 else deceived_p2 end
    into my_deceive from match_hidden_state where match_id = m.id;
  my_deceive := coalesce(my_deceive, false);

  my_clock := (case when uid = m.player1 then m.clock1_ms else m.clock2_ms end)
              - _turn_elapsed_ms(m);

  if my_clock <= 0 then
    perform 1 from matches where id = m.id for update;
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

  select digits into opp_secret
    from secrets where match_id = m.id and player = opp and round = m.current_round;
  if not found then
    raise exception 'opponent_secret_missing';
  end if;

  fb := evaluate_guess(m.content_type, opp_secret, p_digits); -- GERÇEK (otorite)

  -- Yanıltma: yalnız partial:0/1 bir kademe şişirilir (gösterim); win/dcwo/
  -- partial:2 sahtelenmez. Gerçek sonuç oyunu yönetir.
  display_fb := fb;
  if my_deceive then
    if fb = 'partial:0' then
      display_fb := 'partial:1';
    elsif fb = 'partial:1' then
      display_fb := 'partial:2';
    end if;
  end if;

  -- Yanıltma bayrağı bu tahminle tüketilir (KAPALI tablo; satır yoksa no-op).
  update match_hidden_state
     set deceived_p1 = case when uid = m.player1 then false else deceived_p1 end,
         deceived_p2 = case when uid = m.player2 then false else deceived_p2 end
   where match_id = m.id;

  -- Satıra GÖSTERİLEN değer yazılır (kurbana gerçek inmez; şişirme işareti yok).
  insert into guesses (match_id, guesser, digits, feedback, round, fogged)
  values (m.id, uid, p_digits, display_fb, m.current_round, my_fog);

  if fb = 'win' then
    perform 1 from matches where id = m.id for update;
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end
     where id = m.id;
    m := _advance_or_finish(m.id, uid, 'win');
  else
    -- Sıra rakibe geçer. Tur bitti: donma söner; çağıranın yavaşlatması/
    -- susturması/sisi temizlenir (yanıltma yukarıda tüketildi).
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end,
           current_turn = opp,
           turn_started_at = now(),
           turn_frozen = false,
           turn_slow_p1 = case when uid = player1 then false else turn_slow_p1 end,
           turn_slow_p2 = case when uid = player2 then false else turn_slow_p2 end,
           silenced_p1 = case when uid = player1 then false else silenced_p1 end,
           silenced_p2 = case when uid = player2 then false else silenced_p2 end,
           fog_p1 = case when uid = player1 then false else fog_p1 end,
           fog_p2 = case when uid = player2 then false else fog_p2 end
     where id = m.id
     returning * into m;
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'feedback', display_fb, 'current_turn', m.current_turn,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms,
    'fogged', my_fog);
end;
$function$;

-- ─── 5) find_or_create_quick_match: content_type kuyruğu ───────────────
-- Eski 0-arg imza düşürülür (1-arg default ile PostgREST çakışması olmasın);
-- parametresiz çağrı default 'number' ile birebir eski davranıştır.
drop function if exists public.find_or_create_quick_match();
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
  if p_content_type not in ('number', 'word') then
    raise exception 'unknown_content_type';
  end if;

  -- Çağıranın başlamamış kuyruk maçlarını koşulsuz kapat (protocol dahil —
  -- mod değiştirip arayan oyuncunun artığı da temizlenir).
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

  -- 1) LİG-İÇİ: aynı band, taze waiting, rakipsiz, AYNI İÇERİK TİPİ.
  --    (Tablo takma adı `mt`; `m` plpgsql kayıt değişkeni — çakışmayı önler.)
  select mt.* into m
    from matches mt
    join profiles p on p.id = mt.player1
   where mt.status = 'waiting' and mt.mode = 'quick'
     and mt.content_type = p_content_type           -- ★ kelime/sayı kuyruğu ayrımı
     and mt.player1 <> uid and mt.player2 is null
     and mt.created_at >= now() - interval '2 minutes'
     and p.rating between band_lo and band_hi
   order by mt.created_at
   limit 1
   for update of mt skip locked;

  -- 2) EN YAKIN: band içi yoksa Kupa farkı en küçük olan (oyuncu eşleşmesiz kalmasın).
  if not found then
    select mt.* into m
      from matches mt
      join profiles p on p.id = mt.player1
     where mt.status = 'waiting' and mt.mode = 'quick'
       and mt.content_type = p_content_type         -- ★ kelime/sayı kuyruğu ayrımı
       and mt.player1 <> uid and mt.player2 is null
       and mt.created_at >= now() - interval '2 minutes'
     order by abs(p.rating - my_rating), mt.created_at
     limit 1
     for update of mt skip locked;
  end if;

  if found then
    -- setup'a geç; SÜRE BAŞLATMA (mark_ready'de, iki taraf hazır olunca).
    update matches set player2 = uid, status = 'setup' where id = m.id;
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
  end if;

  -- Yeni kuyruk maçı. Kelimede uzunluk MAÇ BAŞINA random (4/5/6, Kader Eli
  -- deseni) — iki oyuncu da aynı uzunlukta kelime girer (adalet).
  insert into matches (mode, player1, content_type, word_length)
  values ('quick', uid, p_content_type,
          case when p_content_type = 'word' then 4 + floor(random() * 3)::int end)
  returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$function$;

notify pgrst, 'reload schema';
