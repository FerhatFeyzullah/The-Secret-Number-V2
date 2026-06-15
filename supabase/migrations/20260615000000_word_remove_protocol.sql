-- Kelime modundan protokol kaldırımı (Faz 2C sonrası düzeltme).
--
-- KARAR: Kelime maçı artık protokolsüz Bo3'tür. Kaynakta (maç doğumunda)
-- mode='protocol' yerine mode='quick' + win_target=2 ile doğar; eşleşince
-- doğrudan 'setup'a geçer (protocol_select FAZI YOK) ve EL DAĞITILMAZ
-- (_deal_protocol_hand çağrısı kaldırıldı). Bo3 turluluğun gerçek kaynağı
-- win_target=2 olduğundan (mod'dan bağımsız), tur akışı/skor/tur-arası
-- belirleme AYNEN korunur. İstemci protokol UI'ı word-duel-screen'den
-- ayrıca kaldırılır; bu migration yalnız sunucu doğumunu değiştirir.
--
-- BİLİNÇLİ KARAR — mevcut satırlar TAŞINMAZ: Halihazırda mode='protocol'
-- olarak doğmuş in-flight kelime maçları (eşleşmiş ama bitmemiş) bitene
-- kadar eski protokol akışını görmeye devam eder. Yeni doğan kelime maçları
-- protokolsüzdür. Bu kabul edilebilir; geriye dönük veri migrasyonu YOK
-- (kelime maçları kısa ömürlü; en geç birkaç dakikada sonuçlanır/iptal olur).
--
-- SAYI MODU SIFIR REGRESYON: find_or_create_protocol_match'e DOKUNULMAZ
-- (sayı protokol Bo3 kuyruğu birebir aynı). find_or_create_quick_match'in
-- 'number' dalı da bit-bit aynıdır; yalnız 'word' dalı değişti (★).
--
-- Gövde yürürlükteki canlı tanımdan (20260611000003) alınmıştır; yalnız
-- işaretli satırlar değişti.

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
    --   tur 1 uzunluğu random (4/5/6, Kader Eli deseni).
    insert into matches (mode, player1, win_target, content_type, word_length)
    values ('quick', uid, 2, 'word', 4 + floor(random() * 3)::int)
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

-- ─── mark_ready: kelime ilk-tur belirleme penceresi 60 sn ──────────────
-- Eskiden kelime ilk turunun 60 sn'lik belirleme penceresi protocol_select
-- → _start_protocol_setup yolundan geliyordu. Kelime artık protocol_select'i
-- ATLADIĞI için doğrudan 'setup'a düşüyor ve mark_ready süreyi başlatıyor.
-- mark_ready sayıya göre 37 sn (30+7) sabitliyordu; kelime için 60 sn'ye
-- dallandırılır ki 2C'deki "kelime belirleme 60 sn" davranışı korunsun.
-- SAYI/ÖZEL OYUN: 37 sn AYNEN; protocol_select (sayı) seçim penceresi 27 sn
-- AYNEN. Gövde 20260607000010'dan; yalnız setup_deadline dalı değişti (★).
create or replace function public.mark_ready(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  is_select boolean;
begin
  m := _match_for_player(p_match_id);

  if m.status not in ('setup', 'protocol_select') then
    return jsonb_build_object('match_id', m.id, 'status', m.status);
  end if;
  is_select := m.status = 'protocol_select';

  if uid = m.player1 then
    update matches set player1_present = true where id = m.id returning * into m;
  else
    update matches set player2_present = true where id = m.id returning * into m;
  end if;

  if m.player1_present and m.player2_present then
    -- İki taraf hazır: seçim (20+7 sn) ya da belirleme penceresi.
    if is_select then
      if m.select_deadline is null then
        update matches set select_deadline = now() + interval '27 seconds',
                           present_deadline = null
         where id = m.id returning * into m;
      end if;
    else
      if m.setup_deadline is null then
        -- ★ kelime: 60 sn (sayı/özel oyun: 37 sn = 30+7, eski değer).
        update matches set setup_deadline = now() + case when m.content_type = 'word'
                                                         then interval '60 seconds'
                                                         else interval '37 seconds' end,
                           present_deadline = null
         where id = m.id returning * into m;
      end if;
    end if;
  else
    -- İlk present olan: rakip için 20 sn idle penceresi (bir kez).
    if m.present_deadline is null then
      update matches set present_deadline = now() + interval '20 seconds'
       where id = m.id returning * into m;
    end if;
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status,
    'player1_present', m.player1_present, 'player2_present', m.player2_present);
end;
$$;

notify pgrst, 'reload schema';
