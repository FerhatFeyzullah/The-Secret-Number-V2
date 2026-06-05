-- Online 1v1: belirleme "Hazır" el sıkışması + sayaç başlangıcı düzeltmesi
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Hata: setup_deadline eşleşme anında kuruluyordu; oyuncular VS/Hazır ekranında
-- beklerken 15 sn akıyordu, setup'a varınca sayaç çoktan azalmıştı.
--
-- Çözüm — iki ayrı boolean kavram (gizli sayı SIZMAZ, ikisi de sadece bayrak):
--   * player1_present / player2_present = "Hazır'a bastı / belirleme ekranına girdi"
--     (mark_ready set eder). İki taraf da present olunca 30 sn'lik belirleme
--     penceresi (setup_deadline) BAŞLAR — sayaç ancak o an akar.
--   * player1_ready  / player2_ready  = "gizli sayısını KİLİTLEDİ"
--     (set_secret set eder, migration 6). Bu migration bu alanlara dokunmaz.
--
-- Ayrıca idle fallback: bir taraf present olduktan sonra diğeri 20 sn içinde
-- present olmazsa maç iptal (kazanan yok) — present_deadline ile.

-- 1) Alanlar ---------------------------------------------------------------------
alter table public.matches
  add column if not exists player1_present boolean not null default false;
alter table public.matches
  add column if not exists player2_present boolean not null default false;
-- İlk present olandan sonra rakip için tanınan kısa süre (idle penceresi).
alter table public.matches
  add column if not exists present_deadline timestamptz null;

-- 2) Katılma RPC'lerinden setup_deadline'ı KALDIR -------------------------------
-- Artık deadline eşleşmede değil, iki taraf da "Hazır" olunca (mark_ready) kurulur.

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

  -- setup'a geç; SÜRE BAŞLATMA (deadline mark_ready'de, iki taraf hazır olunca).
  update matches
     set player2 = uid,
         status = 'setup'
   where id = m.id;
  return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
end;
$$;

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

  -- Çağıranın ölü maçlarını kapat (bayat waiting / süresi geçmiş ya da terk
  -- edilmiş setup). setup_deadline artık eşleşmede kurulmadığı için, eski setup
  -- maçlarını present/idle deadline'ı geçmiş VEYA 2 dk'dan eski olanlardan yakala.
  update matches
     set status = 'cancelled',
         result = 'cancelled',
         current_turn = null,
         turn_started_at = null
   where (player1 = uid or player2 = uid)
     and (
       (status = 'waiting' and created_at < now() - interval '2 minutes')
       or (
         status = 'setup' and (
           (setup_deadline is not null and setup_deadline < now())
           or (present_deadline is not null and present_deadline < now())
           or created_at < now() - interval '2 minutes'
         )
       )
     );

  select * into m
    from matches
   where status = 'waiting' and mode = 'quick' and player1 = uid
   order by created_at
   limit 1;
  if found then
    return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', m.status);
  end if;

  select * into m
    from matches
   where status = 'waiting' and mode = 'quick'
     and player1 <> uid and player2 is null
     and created_at >= now() - interval '2 minutes'
   order by created_at
   limit 1
   for update skip locked;

  if found then
    -- setup'a geç; SÜRE BAŞLATMA (mark_ready'de).
    update matches
       set player2 = uid,
           status = 'setup'
     where id = m.id;
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
  end if;

  insert into matches (mode, player1) values ('quick', uid) returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$$;

-- 3) mark_ready: "Hazır'a bastı" + sayaç/idle penceresi yönetimi ----------------
-- İki taraf present → 30 sn belirleme penceresi başlar (setup_deadline).
-- Tek taraf present → rakip için 20 sn idle penceresi (present_deadline).

create or replace function public.mark_ready(p_match_id uuid)
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

  -- Idempotent / yarış güvenli: setup değilse mevcut durumu döndür.
  if m.status <> 'setup' then
    return jsonb_build_object('match_id', m.id, 'status', m.status);
  end if;

  -- present = "Hazır'a bastı / belirleme ekranına girdi" (sayı DEĞİL).
  if uid = m.player1 then
    update matches set player1_present = true where id = m.id returning * into m;
  else
    update matches set player2_present = true where id = m.id returning * into m;
  end if;

  if m.player1_present and m.player2_present then
    -- İki taraf da hazır: 30 sn'lik belirleme penceresini BİR KEZ başlat.
    if m.setup_deadline is null then
      update matches
         set setup_deadline = now() + interval '30 seconds',
             present_deadline = null
       where id = m.id
       returning * into m;
    end if;
  else
    -- İlk present olan: rakip için 20 sn idle penceresi (bir kez).
    if m.present_deadline is null then
      update matches
         set present_deadline = now() + interval '20 seconds'
       where id = m.id
       returning * into m;
    end if;
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status,
    'player1_present', m.player1_present, 'player2_present', m.player2_present);
end;
$$;

-- 4) cancel_setup_timeout: idle (present_deadline) VE belirleme (setup_deadline)
-- İki iptal nedenini de işler; kararı her zaman sunucu now() ile verir.

create or replace function public.cancel_setup_timeout(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  both_present boolean;
  secret_count int;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'setup' then
    raise exception 'not_in_setup';
  end if;

  both_present := m.player1_present and m.player2_present;
  select count(*) into secret_count from secrets where match_id = m.id;

  -- Geçerli iptal nedenleri:
  --  a) idle: bir taraf present, diğeri gelmedi ve present_deadline geçti.
  --  b) belirleme: iki taraf present, setup_deadline geçti ve iki sayı yok.
  if not (
       (not both_present and m.present_deadline is not null and now() > m.present_deadline)
    or (both_present and m.setup_deadline is not null and now() > m.setup_deadline and secret_count < 2)
  ) then
    raise exception 'setup_not_expired';
  end if;

  -- İki sayı da yazılmışsa set_secret çoktan active yapardı; emniyet kontrolü.
  if both_present and secret_count = 2 then
    raise exception 'match_already_ready';
  end if;

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

-- 5) Grant'ler -------------------------------------------------------------------
revoke execute on function public.mark_ready(uuid) from public, anon;
grant execute on function public.mark_ready(uuid) to authenticated;
-- join/quick/cancel_setup_timeout grant'leri önceki migration'larda verildi;
-- create or replace bunları korur.

-- 6) Doğrulama (panelde elle denenebilir) ---------------------------------------
--
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"USER_A"}';
-- select find_or_create_quick_match();            -- waiting (deadline YOK)
-- set local request.jwt.claims = '{"sub":"USER_B"}';
-- select find_or_create_quick_match();            -- setup; setup_deadline NULL olmalı
-- select setup_deadline, present_deadline from public.matches where id='MATCH_ID'; -- ikisi de null
-- select mark_ready('MATCH_ID');                  -- B present; present_deadline = now()+20s
-- set local request.jwt.claims = '{"sub":"USER_A"}';
-- select mark_ready('MATCH_ID');                  -- iki taraf present; setup_deadline = now()+30s
-- select setup_deadline, present_deadline from public.matches where id='MATCH_ID'; -- deadline dolu, present_deadline null
-- rollback;
--
-- -- idle iptal: yalnız bir taraf present, present_deadline geç:
-- --   update public.matches set present_deadline = now() - interval '1 second' where id='MATCH_ID';
-- --   select cancel_setup_timeout('MATCH_ID');   -- status=cancelled (kazanan yok)
