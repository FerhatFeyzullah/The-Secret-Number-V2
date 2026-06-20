-- Kelime modu tur süresi (satranç saati) 60 sn → 120 sn.
--
-- KARAR: Standart/online KELİME maçında her oyuncunun TUR BAŞINA tahmin
-- süresi (satranç saati banka değeri) 120 saniyedir. Kaynak: matches.clock_ms
-- (tur başında clock1_ms/clock2_ms = clock_ms olarak sıfırlanır). Kelime maçı
-- doğumunda clock_ms ATANMADIĞI için şimdiye dek tablo defaultu 60000'i (60 sn)
-- alıyordu; artık word dalı 120000 (120 sn) ile doğar.
--
-- SAYI MODU SIFIR REGRESYON: number dalı clock_ms ATAMAZ → default 60000
-- (60 sn) AYNEN. Yalnız ★ işaretli word insert satırı değişti.
--
-- KURULUM (SETUP) SÜRESİ AYRIDIR — DOKUNULMADI: kelime gizli-belirleme
-- penceresi 60 sn'dir ve setup_deadline'dan (mark_ready / _start_protocol_setup)
-- gelir; clock_ms ile İLGİSİ YOKTUR. Bu migration setup süresine dokunmaz.
--
-- Gövde yürürlükteki canlı tanımdan (20260615000000) alınmıştır; yalnız
-- işaretli (★) satır değişti.

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
    --   tur 1 uzunluğu random (4/5/6, Kader Eli deseni). clock_ms=120000 →
    --   her oyuncuya TUR BAŞINA 120 sn satranç saati (★ bu satır eklendi).
    insert into matches (mode, player1, win_target, content_type, word_length, clock_ms)
    values ('quick', uid, 2, 'word', 4 + floor(random() * 3)::int, 120000)
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
