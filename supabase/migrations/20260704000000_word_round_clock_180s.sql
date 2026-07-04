-- Kelime modu tur süresi (satranç saati) 120 sn → 180 sn (3 dk) + özel odaya
-- 3 dk seçeneği.
--
-- KARAR: Standart/online (eşleşmeli/lig) KELİME maçında her oyuncunun TUR
-- BAŞINA tahmin süresi (satranç saati banka değeri) 180 saniyedir. Kaynak:
-- matches.clock_ms (tur başında clock1_ms/clock2_ms = clock_ms olarak sıfırlanır).
-- Kelime maçı doğumunda clock_ms önce 120000 (120 sn) atanıyordu; artık word dalı
-- 180000 (180 sn) ile doğar.
--
-- ÖZEL ODA: create_private_room süre seçeneklerine 180000 (3 dk) eklenir
-- (60000/90000/120000/180000). Süre seçici sayı+kelime özel odalarında ortaktır.
--
-- SAYI MODU (EŞLEŞMELİ) SIFIR REGRESYON: number dalı clock_ms ATAMAZ → tablo
-- default 60000 (60 sn) AYNEN. Yalnız ★ işaretli word insert satırı 180000 olur.
--
-- KURULUM (SETUP) SÜRESİ AYRIDIR — DOKUNULMADI: kelime gizli-belirleme penceresi
-- 60 sn'dir ve setup_deadline'dan gelir; clock_ms ile İLGİSİ YOKTUR.
--
-- Gövdeler yürürlükteki canlı tanımlardan alınmıştır (find_or_create_quick_match:
-- 20260620000000; create_private_room: 20260620000001); yalnız işaretli (★)
-- satırlar değişti.

-- ─── 1) find_or_create_quick_match: word tur saati 180 sn ────────────────
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
    -- ★ KELİME: PROTOKOLSÜZ Bo3 kuyruğu (mode='quick' + content_type='word',
    --   win_target=2). Lig-içi öncelik + en-yakın fallback sayı kuyruğuyla
    --   aynı desen; eşleşince doğrudan 'setup' (protocol_select YOK, el YOK).
    select mt.* into m
      from matches mt
      join profiles p on p.id = mt.player1
     where mt.status = 'waiting' and mt.mode = 'quick'       -- ★ 'protocol' değil
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
       where mt.status = 'waiting' and mt.mode = 'quick'     -- ★ 'protocol' değil
         and mt.content_type = 'word'
         and mt.player1 <> uid and mt.player2 is null
         and mt.created_at >= now() - interval '2 minutes'
       order by abs(p.rating - my_rating), mt.created_at
       limit 1
       for update of mt skip locked;
    end if;

    if found then
      -- ★ Katıl → doğrudan setup; SÜRE BAŞLATMA yok (mark_ready'de, iki
      --   taraf hazır olunca _start_protocol_setup süreyi başlatır). El
      --   DAĞITILMAZ (_deal_protocol_hand çağrısı kaldırıldı).
      update matches set player2 = uid, status = 'setup' where id = m.id;
      return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
    end if;

    -- ★ Yeni kelime maçı: PROTOKOLSÜZ Bo3 (mode='quick', win_target=2) +
    --   tur 1 uzunluğu random (4/5/6, Kader Eli deseni). clock_ms=180000 →
    --   her oyuncuya TUR BAŞINA 180 sn satranç saati (★ 120000 → 180000).
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
    -- setup'a geç; SÜRE BAŞLATMA (mark_ready'de, iki taraf hazır olunca).
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

-- ─── 2) create_private_room: süre seçeneklerine 180000 (3 dk) ekle ───────
-- Gövde 20260620000001'den birebir; yalnız ★ CHECK satırına 180000 eklendi.
-- İmza (int, text, text) değişmedi → drop gerekmez; join_private_room aynen kalır.
create or replace function public.create_private_room(
  p_clock_ms int default 60000,
  p_first_turn_mode text default 'random',
  p_room_mode text default 'quick'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  m public.matches;
  attempt int;
  v_mode text;
  v_content text;
  v_win_target int;
  v_word_length int;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_clock_ms not in (60000, 90000, 120000, 180000) then  -- ★ 180000 (3 dk) eklendi
    raise exception 'invalid_clock';
  end if;
  if p_first_turn_mode not in ('random', 'creator') then
    raise exception 'invalid_first_turn';
  end if;
  if p_room_mode not in ('quick', 'protocol', 'word') then
    raise exception 'invalid_room_mode';
  end if;

  -- Oda modu → kamudaki karşılığının BİREBİR kolonları:
  --   quick    : mode='private', number, tek tur (win_target=1)   [private=quick rules]
  --   protocol : mode='protocol', number, Bo3 (win_target=2)      [protokol kuralları mode'a bağlı]
  --   word     : mode='private', word, Bo3 (win_target=2), uzunluk random(4-6)
  if p_room_mode = 'protocol' then
    v_mode := 'protocol'; v_content := 'number'; v_win_target := 2; v_word_length := null;
  elsif p_room_mode = 'word' then
    v_mode := 'private'; v_content := 'word'; v_win_target := 2; v_word_length := 4 + floor(random() * 3)::int;
  else
    v_mode := 'private'; v_content := 'number'; v_win_target := 1; v_word_length := null;
  end if;

  for attempt in 1..20 loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '')
      into code
      from generate_series(1, 6);
    begin
      insert into matches (
        mode, player1, room_code, clock_ms, first_turn_mode,
        content_type, win_target, word_length, is_friendly)
      values (
        v_mode, uid, code, p_clock_ms, p_first_turn_mode,
        v_content, v_win_target, v_word_length, true)
      returning * into m;
      return jsonb_build_object(
        'match_id', m.id, 'room_code', m.room_code,
        'role', 'player1', 'status', m.status);
    exception when unique_violation then
      null; -- kod çakıştı, yeniden üret
    end;
  end loop;
  raise exception 'room_code_generation_failed';
end;
$$;

revoke execute on function public.create_private_room(int, text, text) from public, anon;
grant execute on function public.create_private_room(int, text, text) to authenticated;

notify pgrst, 'reload schema';
