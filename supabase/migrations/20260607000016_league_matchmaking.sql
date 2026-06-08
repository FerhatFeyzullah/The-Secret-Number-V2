-- ════════════════════════════════════════════════════════════════════════════
-- Lig-içi eşleşme: rakip seçimi Kupa bandına göre yapılır; band içi bekleyen
-- yoksa EN YAKIN Kupa'ya düşülür → oyuncu ASLA eşleşmesiz kalmaz. Yalnızca
-- rakip-seçim bloğu değişir; temizlik, _deal_protocol_hand, insert-waiting,
-- deadline'lar ve FOR UPDATE SKIP LOCKED dayanıklılığı (EvalPlanQual) AYNEN
-- korunur. (Önceki sürüm: 20260607000010_matchmaking_fixes.sql)
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
$$;
revoke execute on function public.find_or_create_protocol_match() from public, anon;
grant execute on function public.find_or_create_protocol_match() to authenticated;

create or replace function public.find_or_create_quick_match()
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

  -- 1) LİG-İÇİ: aynı band, taze waiting, rakipsiz. (Tablo takma adı `mt`; `m`
  --    plpgsql kayıt değişkeni — çakışmayı önler.)
  select mt.* into m
    from matches mt
    join profiles p on p.id = mt.player1
   where mt.status = 'waiting' and mt.mode = 'quick'
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

  insert into matches (mode, player1) values ('quick', uid) returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$$;
revoke execute on function public.find_or_create_quick_match() from public, anon;
grant execute on function public.find_or_create_quick_match() to authenticated;

notify pgrst, 'reload schema';
