-- Faz 3 / Düzeltme: eşleşme/iptal doğruluğu — bağımsız el + hayalet maç + otomatik geçiş
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Üç doğruluk hatası düzeltilir:
--
-- (1) BAĞIMSIZ EL: _deal_protocol_hand'deki "select unnest(...) x order by random()"
--     deseni Postgres'te KARIŞTIRMAZ — random() SRF (unnest) açılımından önce,
--     altta yatan TEK satır için bir kez değerlenir; tüm açılan satırlar aynı
--     sıralama anahtarını paylaşır ve el hep owned_protocols'un İLK N elemanı
--     olurdu (deterministik). İki oyuncunun sahipliği benzerse "aynı el" gibi
--     görünüyordu. Düzeltme: unnest FROM içine alınır → random() satır başına
--     değerlenir → her oyuncuya kendi sahipliğinden BAĞIMSIZ rastgele el.
--     (_fill_selection ve _obstacle_waste'taki "array_agg(x order by random())"
--     aggregate-içi sıralamadır, satır başına değerlenir — onlar zaten doğru.)
--
-- (2) HAYALET MAÇ: optimistik çıkışta leave_match ağda kaybolur ya da yeni arama
--     RPC'si uçuştaki leave'den ÖNCE koşarsa, çağıran "henüz waiting görünen ama
--     birazdan iptal edilecek" eski maçına geri düşüyordu; ayrıca taze (<2 dk,
--     deadline'sız) protocol_select/setup artıkları temizlenmiyordu. Düzeltme:
--     eşleştirme RPC'leri artık çağıranın BAŞLAMAMIŞ (waiting / protocol_select /
--     setup tur 1) matchmade maçlarını koşulsuz iptal ederek başlar — yeni arama
--     "önceki ön-oyun maçlarımı bırakıyorum" beyanıdır. Geciken leave_match
--     no-op'a düşer (idempotent); karşı taraf realtime UPDATE ile "maç iptal"
--     görür ve lobiye döner. cancelled/finished maçlar zaten eşleşme sorgusunun
--     dışındadır (status='waiting' + taze + player2 null + FOR UPDATE SKIP LOCKED).
--
-- (3) OTOMATİK GEÇİŞ (VS ekranı): "Hazır" el sıkışması manuel olmaktan çıkar;
--     istemci eşleşme ekranına girer girmez mark_ready'yi otomatik çağırır ve
--     7 sn sonra sonraki ekrana kendiliğinden geçer. İki taraf present olunca
--     kurulan pencerelere bu 7 sn'lik VS tamponu eklenir (seçim 20→27 sn,
--     belirleme 30→37 sn) — oyuncu asıl ekrana vardığında tam süresi kalır.
--     Sayaç/iptal kararları SUNUCUDA kalır (present_deadline idle penceresi
--     değişmez: rakip hiç gelmezse 20 sn sonra iptal edilebilir).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) _deal_protocol_hand: GERÇEK rastgele el (FROM-unnest + order by random)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._deal_protocol_hand(p_match_id uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  pr public.profiles;
  slots int;
  hand_size int;
  dealt text[];
begin
  select * into pr from profiles where id = p_player;
  slots := _protocol_slots(pr.level);
  hand_size := least(coalesce(array_length(pr.owned_protocols, 1), 0), slots + 3);
  -- unnest FROM içinde: random() her satır için ayrı değerlenir (gerçek karıştırma).
  select coalesce(array_agg(x), '{}') into dealt
    from (select t.x from unnest(pr.owned_protocols) as t(x)
          order by random() limit hand_size) s;
  insert into protocol_hands (match_id, player, hand, selected)
  values (p_match_id, p_player, dealt, '{}')
  on conflict (match_id, player) do update set hand = excluded.hand, selected = '{}';
end;
$$;
revoke execute on function public._deal_protocol_hand(uuid, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) _cancel_unstarted_matchmade: çağıranın başlamamış kuyruk maçlarını kapat
-- ════════════════════════════════════════════════════════════════════════════
-- Yeni bir arama, önceki ön-oyun (henüz başlamamış) matchmade maçlarından vazgeçmek
-- demektir: waiting / protocol_select / setup(tur 1) → cancelled. Aktif ya da
-- turlar arası (setup, tur>1) maçlara DOKUNULMAZ (hükmen kayıp leave_match'in işi).
-- Özel odalar (mode='private') kapsam DIŞI — kendi yaşam döngüleri korunur.
create or replace function public._cancel_unstarted_matchmade(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update matches
     set status = 'cancelled', result = 'cancelled',
         current_turn = null, turn_started_at = null
   where (player1 = p_uid or player2 = p_uid)
     and mode in ('quick', 'protocol')
     and (
       status in ('waiting', 'protocol_select')
       or (status = 'setup' and current_round = 1)
     );
end;
$$;
revoke execute on function public._cancel_unstarted_matchmade(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) find_or_create_protocol_match: artıkları kapat → yalnız taze waiting eşleştir
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

  -- Yalnızca GERÇEKTEN bekleyen maça katıl: waiting + taze (<2 dk) + rakipsiz.
  -- FOR UPDATE SKIP LOCKED: kilit anında satır yeniden değerlenir (EvalPlanQual);
  -- bu arada cancelled/dolu olmuş maç sonuçtan düşer — cancelled ASLA eşleşmez.
  select * into m
    from matches
   where status = 'waiting' and mode = 'protocol'
     and player1 <> uid and player2 is null
     and created_at >= now() - interval '2 minutes'
   order by created_at
   limit 1
   for update skip locked;

  if found then
    -- Katıl → seçim fazı; HER İKİ oyuncuya kendi sahipliğinden BAĞIMSIZ el.
    update matches set player2 = uid, status = 'protocol_select' where id = m.id;
    perform _deal_protocol_hand(m.id, m.player1);
    perform _deal_protocol_hand(m.id, uid);
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'protocol_select');
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
-- 4) find_or_create_quick_match: aynı yaşam döngüsü düzeltmesi (tutarlılık)
-- ════════════════════════════════════════════════════════════════════════════
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

  -- Yalnızca gerçekten bekleyen taze quick maçına katıl.
  select * into m
    from matches
   where status = 'waiting' and mode = 'quick'
     and player1 <> uid and player2 is null
     and created_at >= now() - interval '2 minutes'
   order by created_at
   limit 1
   for update skip locked;

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

-- ════════════════════════════════════════════════════════════════════════════
-- 5) mark_ready: otomatik el sıkışması + 7 sn VS tamponu
-- ════════════════════════════════════════════════════════════════════════════
-- İstemci eşleşme (VS) ekranına girer girmez otomatik çağırır (manuel "Hazır"
-- yok). İki taraf present olunca kurulan pencereye 7 sn VS tamponu eklenir:
-- seçim 20+7=27 sn, belirleme 30+7=37 sn — oyuncu asıl ekrana vardığında tam
-- süresi (20/30 sn) kalır. Idle penceresi (rakip hiç gelmedi → 20 sn) değişmez.
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
    -- İki taraf hazır: seçim (20+7 sn) ya da belirleme (30+7 sn) penceresi.
    if is_select then
      if m.select_deadline is null then
        update matches set select_deadline = now() + interval '27 seconds',
                           present_deadline = null
         where id = m.id returning * into m;
      end if;
    else
      if m.setup_deadline is null then
        update matches set setup_deadline = now() + interval '37 seconds',
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

-- PostgREST şema önbelleğini tazele.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - El: aynı sahiplikte ardışık dağıtımlar FARKLI sıralar üretir; iki oyuncunun
--     eli kendi owned_protocols'undan, bağımsız rastgele (min(owned, slots+3)).
--   - Hayalet maç: eşleş → leave → yeniden ara: eski maç cancelled kalır, yeni
--     temiz waiting açılır. Leave hiç ulaşmasa bile yeni arama eski
--     protocol_select/setup(tur 1) artığını iptal eder; rakip realtime ile
--     lobiye döner. cancelled/finished maç asla yeniden eşleşmez.
--   - mark_ready: iki taraf present → select_deadline = now()+27 sn (protocol),
--     setup_deadline = now()+37 sn (quick/private). Idle: present_deadline 20 sn.
--   - Aktif maç / setup(tur>1) aramayla İPTAL EDİLMEZ (hükmen kayıp ayrı yol).
