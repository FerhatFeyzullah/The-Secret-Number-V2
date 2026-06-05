-- Online 1v1: maçtan çıkış temizliği — leave_match RPC + kuyruk sağlamlaştırma
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Gerekçe (hata): eşleşme sonrası (setup) "İptal"/geri ile çıkan kullanıcının
-- maçı sunucuda ayakta kalıyordu; cancel_waiting yalnızca waiting'i kapatır.
-- Biriken bayat waiting/setup maçları, sonraki "Hızlı Maç" aramalarında
-- kullanıcıyı eski maça/rakibe geri düşürüyordu.
--
-- Çözüm: her fazı doğru kapatan tek çıkış RPC'si (leave_match) + kuyruk
-- taramasının bayat kayıtları görmezden gelip temizlemesi. cancel_waiting
-- geriye dönük uyumluluk için aynen kalır.

-- 1) leave_match -----------------------------------------------------------------
-- Çağıranın maçtan çıkışı, faza göre:
--   waiting  -> cancelled  (kuyruktan/odadan çıkış)
--   setup    -> cancelled  (kazanan yok, istatistik etkilenmez)
--   active   -> finished, result='forfeit', winner=rakip (çıkan hükmen kaybeder)
--   bitmiş   -> no-op (left=false döner; hata DEĞİL — çifte tıklama/yarışta güvenli)

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
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'left', true,
    'status', m.status, 'result', m.result, 'winner', m.winner);
end;
$$;

revoke execute on function public.leave_match(uuid) from public, anon;
grant execute on function public.leave_match(uuid) to authenticated;

-- 2) Kuyruk sağlamlaştırma --------------------------------------------------------
-- find_or_create_quick_match artık:
--   a) çağıranın ölü maçlarını (2 dk'dan eski waiting ya da deadline'ı geçmiş
--      setup) önce cancelled'a çeker — kullanıcı hep temiz başlar;
--   b) kuyruk taramasında 2 dk'dan eski waiting maçları atlar — başka
--      kullanıcının bayat kaydına kimse düşmez.
-- Tam otomatik 15 sn setup iptali belirleme ekranı adımında ele alınacak;
-- buradaki amaç bayatların kuyruğu/durumu kirletmemesi.

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

  -- Çağıranın ölü maçlarını kapat (bayat waiting / süresi geçmiş setup).
  update matches
     set status = 'cancelled',
         result = 'cancelled',
         current_turn = null,
         turn_started_at = null
   where (player1 = uid or player2 = uid)
     and (
       (status = 'waiting' and created_at < now() - interval '2 minutes')
       or (status = 'setup' and setup_deadline is not null and setup_deadline < now())
     );

  -- Hâlâ taze bir waiting maçın varsa aynı maçı döndür (mükerrer kayıt açılmaz).
  select * into m
    from matches
   where status = 'waiting' and mode = 'quick' and player1 = uid
   order by created_at
   limit 1;
  if found then
    return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', m.status);
  end if;

  -- Başkasının TAZE bekleyen maçına katıl. FOR UPDATE SKIP LOCKED: iki
  -- kullanıcı aynı anda eşleşmeye çalışırsa aynı satırı kapamazlar.
  select * into m
    from matches
   where status = 'waiting' and mode = 'quick'
     and player1 <> uid and player2 is null
     and created_at >= now() - interval '2 minutes'   -- bayatları atla
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

-- Grant'ler migration 2'de verildi; create or replace bunları korur.

-- 3) Doğrulama (panelde elle denenebilir) -------------------------------------------
--
--   -- setup maçtan çıkış artık temizleniyor:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"USER_A"}';
--   select find_or_create_quick_match();        -- waiting
--   set local request.jwt.claims = '{"sub":"USER_B"}';
--   select find_or_create_quick_match();        -- aynı maç, setup
--   set local request.jwt.claims = '{"sub":"USER_A"}';
--   select leave_match('MATCH_ID');             -- left=true, status=cancelled
--   select leave_match('MATCH_ID');             -- left=false (no-op, hata yok)
--   reset role;
--
--   -- active maçtan çıkan hükmen kaybeder:
--   (maçı active'e getirdikten sonra) select leave_match('MATCH_ID');
--                                    -- status=finished, result=forfeit, winner=rakip
--
--   -- 2 dk'dan eski waiting maçlara kimse düşmez; sahibinin sonraki araması
--   -- onları cancelled'a çeker:
--   update public.matches set created_at = now() - interval '3 minutes'
--    where id = 'BAYAT_WAITING_ID';  -- (test için, postgres rolüyle)
--   select find_or_create_quick_match();        -- bayata katılmaz / bayatı kapatır
