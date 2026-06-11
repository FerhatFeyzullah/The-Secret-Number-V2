-- Kelime modu Faz 2C sunucu ayağı: TUR-seviyesi uzunluk + Bo3/protokol akışı.
--
-- 1) TUR-SEVİYESİ UZUNLUK: matches.word_length artık "şu anki turun uzunluğu"
--    anlamını taşır. Tur 1 değeri maç oluşturulurken atanır (2B); her tur
--    geçişinde _advance_or_finish YENİDEN ZARLAR (4 + floor(random()*3) —
--    Kader Eli deseni). Kolon maç satırında olduğu için iki oyuncuya aynı
--    uzunluk yapısal garantidir; doğrulama (is_valid_*_for) zaten
--    m.word_length okuduğundan otomatik o turun uzunluğunu kullanır.
-- 2) KELİME MAÇI = Bo3 + PROTOKOL: kelime maçları mode='protocol' +
--    content_type='word' doğar (win_target=2, Kader Eli, protokol seçimi,
--    use_protocol — mevcut altyapı değişmeden). find_or_create_quick_match'in
--    'word' dalı protokol-akışlı eşleşme yapar; 'number' dalı BİREBİR eski
--    davranıştır. Sayı protokol kuyruğuna content_type='number' filtresi
--    eklenir (kelime maçlarına hizmet etmesin).
-- 3) EL FİLTRESİ: kelime maçında 'info' sütunu protokolleri DAĞITILMAZ
--    (rakam-uzayına gömülü: eleme/konum testi/ifşa; harf protokolleri Faz 4).
--    Seçim doğrulaması el-alt-kümesi olduğundan ekstra kontrol gerekmez.
-- 4) SÜRE: kelime belirleme 60 sn (sayıda 30); tur arası da aynı oran.
--
-- Gövdeler yürürlükteki canlı tanımlardan (pg_get_functiondef); değişen
-- satırlar ★ ile işaretli. Protokol/saat/yanıltma mantığı el değmedi.

-- ─── 1) _advance_or_finish: tur geçişinde uzunluğu yeniden zarla ───────
create or replace function public._advance_or_finish(p_match_id uuid, p_round_winner uuid, p_result text)
returns matches
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    update matches
       set status = 'finished',
           result = p_result,
           winner = p_round_winner,
           p1_round_wins = w1,
           p2_round_wins = w2,
           current_turn = null,
           turn_started_at = null,
           turn_frozen = false,
           turn_slow_p1 = false,
           turn_slow_p2 = false,
           silenced_p1 = false,
           silenced_p2 = false,
           fog_p1 = false,
           fog_p2 = false
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
  else
    update matches
       set p1_round_wins = w1,
           p2_round_wins = w2,
           current_round = current_round + 1,
           status = 'setup',
           -- ★ kelimede tur arası belirleme 60+8 sn (sayıda 30+8, eski değer);
           --   yeni tur uzunluğu YENİDEN zarlanır (iki oyuncuya aynı — maç kolonu).
           setup_deadline = now() + case when content_type = 'word'
                                         then interval '68 seconds'
                                         else interval '38 seconds' end,
           word_length = case when content_type = 'word'
                              then 4 + floor(random() * 3)::int
                              else word_length end,
           current_turn = null,
           turn_started_at = null,
           turn_frozen = false,
           turn_slow_p1 = false,
           turn_slow_p2 = false,
           silenced_p1 = false,
           silenced_p2 = false,
           fog_p1 = false,
           fog_p2 = false,
           player1_ready = false,
           player2_ready = false,
           clock1_ms = clock_ms,
           clock2_ms = clock_ms
     where id = m.id
     returning * into m;
  end if;

  -- Yanıltma bayrağı tur/maç sınırında KAPALI tabloda temizlenir (satır yoksa no-op).
  update match_hidden_state set deceived_p1 = false, deceived_p2 = false
   where match_id = p_match_id;

  return m;
end;
$function$;

-- ─── 2) _start_protocol_setup: kelimede belirleme penceresi 60 sn ──────
create or replace function public._start_protocol_setup(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update matches
     set status = 'setup',
         -- ★ kelime: 60 sn (sayı: 30 sn, eski değer)
         setup_deadline = now() + case when content_type = 'word'
                                       then interval '60 seconds'
                                       else interval '30 seconds' end,
         select_deadline = null,
         player1_ready = false,
         player2_ready = false
   where id = p_match_id;
end;
$function$;

-- ─── 3) _deal_protocol_hand: kelime maçında 'info' sütunu dağıtılmaz ───
create or replace function public._deal_protocol_hand(p_match_id uuid, p_player uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  pr public.profiles;
  m_ct text;
  slots int;
  hand_size int;
  dealt text[];
begin
  select * into pr from profiles where id = p_player;
  select content_type into m_ct from matches where id = p_match_id;  -- ★
  slots := _protocol_slots(pr.level);
  hand_size := least(coalesce(array_length(pr.owned_protocols, 1), 0), slots + 3);
  -- unnest FROM içinde: random() her satır için ayrı değerlenir (gerçek karıştırma).
  -- ★ kelimede info sütunu (rakam-uzayına gömülü) elenmiş havuzdan dağıtılır.
  select coalesce(array_agg(x), '{}') into dealt
    from (select t.x from unnest(pr.owned_protocols) as t(x)
          join protocols pt on pt.id = t.x
          where m_ct <> 'word' or pt.pillar <> 'info'
          order by random() limit hand_size) s;
  insert into protocol_hands (match_id, player, hand, selected)
  values (p_match_id, p_player, dealt, '{}')
  on conflict (match_id, player) do update set hand = excluded.hand, selected = '{}';
end;
$function$;

-- ─── 4) find_or_create_quick_match: 'word' dalı protokol-akışlı Bo3 ────
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

  if p_content_type = 'word' then
    -- ★ KELİME: protokollü Bo3 kuyruğu (mode='protocol' + content_type='word').
    --   Lig-içi öncelik + en-yakın fallback sayı kuyruğuyla aynı desen.
    select mt.* into m
      from matches mt
      join profiles p on p.id = mt.player1
     where mt.status = 'waiting' and mt.mode = 'protocol'
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
       where mt.status = 'waiting' and mt.mode = 'protocol'
         and mt.content_type = 'word'
         and mt.player1 <> uid and mt.player2 is null
         and mt.created_at >= now() - interval '2 minutes'
       order by abs(p.rating - my_rating), mt.created_at
       limit 1
       for update of mt skip locked;
    end if;

    if found then
      -- Katıl → seçim fazı; HER İKİ oyuncuya el (info'suz — _deal filtreler).
      update matches set player2 = uid, status = 'protocol_select' where id = m.id;
      perform _deal_protocol_hand(m.id, m.player1);
      perform _deal_protocol_hand(m.id, uid);
      return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'protocol_select');
    end if;

    -- Yeni kelime maçı: Bo3 + tur 1 uzunluğu random (Kader Eli deseni).
    insert into matches (mode, player1, win_target, content_type, word_length)
    values ('protocol', uid, 2, 'word', 4 + floor(random() * 3)::int)
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
    -- setup'a geç; SÜRE BAŞLATMA (mark_ready'de, iki taraf hazır olunca).
    update matches set player2 = uid, status = 'setup' where id = m.id;
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
  end if;

  insert into matches (mode, player1, content_type) values ('quick', uid, 'number')
  returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$function$;

-- ─── 5) find_or_create_protocol_match: sayı kuyruğu content filtresi ───
create or replace function public.find_or_create_protocol_match()
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

  -- Çağıranın başlamamış kuyruk maçlarını koşulsuz kapat (hayalet maç önlenir:
  -- uçuşta kaybolan/geciken leave_match artık no-op'a düşer; rakip realtime ile
  -- "maç iptal" görür). Kendi eski waiting maçına geri dönmek YOK — her arama
  -- temiz başlar.
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

  -- Çağıranın Kupa'sı + lig bandı (eşleşme filtresi).
  select coalesce(rating, 1000) into my_rating from profiles where id = uid;
  select lo, hi into band_lo, band_hi from _league_bounds(my_rating);

  -- 1) LİG-İÇİ: rakibin Kupa'sı aynı bandda, taze waiting, rakipsiz. FOR UPDATE
  --    OF mt SKIP LOCKED → yalnız matches kilitlenir; cancelled/dolu satır düşer.
  --    (Tablo takma adı `mt`; `m` plpgsql kayıt değişkeni — çakışmayı önler.)
  select mt.* into m
    from matches mt
    join profiles p on p.id = mt.player1
   where mt.status = 'waiting' and mt.mode = 'protocol'
     and mt.content_type = 'number'              -- ★ kelime maçlarına hizmet etmez
     and mt.player1 <> uid and mt.player2 is null
     and mt.created_at >= now() - interval '2 minutes'
     and p.rating between band_lo and band_hi
   order by mt.created_at
   limit 1
   for update of mt skip locked;

  -- 2) EN YAKIN: band içi yoksa Kupa farkı en küçük olan (lig fark etmez) →
  --    küçük oyuncu tabanında oyuncu eşleşmesiz kalmasın.
  if not found then
    select mt.* into m
      from matches mt
      join profiles p on p.id = mt.player1
     where mt.status = 'waiting' and mt.mode = 'protocol'
       and mt.content_type = 'number'            -- ★ kelime maçlarına hizmet etmez
       and mt.player1 <> uid and mt.player2 is null
       and mt.created_at >= now() - interval '2 minutes'
     order by abs(p.rating - my_rating), mt.created_at
     limit 1
     for update of mt skip locked;
  end if;

  if found then
    -- Katıl → seçim fazı; HER İKİ oyuncuya kendi sahipliğinden BAĞIMSIZ el.
    update matches set player2 = uid, status = 'protocol_select' where id = m.id;
    perform _deal_protocol_hand(m.id, m.player1);
    perform _deal_protocol_hand(m.id, uid);
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'protocol_select');
  end if;

  -- 3) Bekleyen yok: yeni protokol maçı (Best of 3).
  insert into matches (mode, player1, win_target) values ('protocol', uid, 2)
    returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$function$;

notify pgrst, 'reload schema';
