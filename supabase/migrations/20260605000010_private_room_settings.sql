-- Online 1v1: özel oda ayarları — maç süresi + ilk sıra
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Özel oda kuran kişi seçer: süre (kişi başı saat: 60000/90000/120000 ms) ve
-- ilk tahmin sırası ('random' | 'creator'). Hızlı Maç + offline AYNEN kalır:
-- yeni kolonlar DB default'larıyla (60000 / 'random') eski davranışı korur.

-- 1) Konfig kolonları -----------------------------------------------------------
-- clock_ms = KONFİG (başlangıç süresi); oyuncu saatleri clock1_ms/clock2_ms ayrı.
alter table public.matches
  add column if not exists clock_ms int not null default 60000;
alter table public.matches
  add column if not exists first_turn_mode text not null default 'random'
  check (first_turn_mode in ('random', 'creator'));

-- 2) create_private_room: artık süre + ilk sıra parametreli ----------------------
-- ÖNEMLİ: create or replace ile PARAMETRE eklemek eski 0-argümanlı imzayı silmez;
-- iki overload kalırsa create_private_room() AMBIGUOUS olur. Önce eskiyi düşür.
drop function if exists public.create_private_room();

create or replace function public.create_private_room(
  p_clock_ms int default 60000,
  p_first_turn_mode text default 'random'
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
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  -- Yalnızca izinli değerler (istemci ön-doğrular; nihai otorite sunucu).
  if p_clock_ms not in (60000, 90000, 120000) then
    raise exception 'invalid_clock';
  end if;
  if p_first_turn_mode not in ('random', 'creator') then
    raise exception 'invalid_first_turn';
  end if;

  for attempt in 1..20 loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '')
      into code
      from generate_series(1, 6);
    begin
      insert into matches (mode, player1, room_code, clock_ms, first_turn_mode)
      values ('private', uid, code, p_clock_ms, p_first_turn_mode)
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

revoke execute on function public.create_private_room(int, text) from public, anon;
grant execute on function public.create_private_room(int, text) to authenticated;

-- 3) set_secret: active geçişinde saatleri KONFİGden kur + ilk sırayı uygula -----
-- (migration 6 sürümünün birebir aynısı; YALNIZCA active-geçiş bloğu değişti.)
create or replace function public.set_secret(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if not is_valid_secret(p_digits) then
    raise exception 'invalid_digits';
  end if;

  insert into secrets (match_id, player, digits)
  values (m.id, uid, p_digits)
  on conflict (match_id, player) do update set digits = excluded.digits;

  select count(*) into cnt from secrets where match_id = m.id;

  if cnt = 2 then
    update matches
       set status = 'active',
           -- İlk sıra: 'creator' ise oda kuran (player1), değilse rastgele.
           current_turn = case
             when m.first_turn_mode = 'creator' then m.player1
             when random() < 0.5 then m.player1
             else m.player2
           end,
           turn_started_at = now(),
           -- Saatler konfigden (özel oda 60/90/120 sn; quick'te default 60 sn).
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
$$;
-- set_secret grant'i migration 2'de verildi; create or replace korur.

-- 4) Doğrulama (panelde elle denenebilir) ---------------------------------------
--
--   -- Geçersiz değerler reddedilir:
--   select create_private_room(45000, 'random');   -- HATA: invalid_clock
--   select create_private_room(90000, 'host');     -- HATA: invalid_first_turn
--
--   -- Geçerli: 90 sn + kuran başlar
--   select create_private_room(90000, 'creator');  -- room_code döner
--   select clock_ms, first_turn_mode from public.matches where id='MATCH_ID';
--                                                  -- 90000 / creator
--   -- İki sayı kilitlenince: saatler 90000, current_turn = player1 (kuran)
--
--   -- Hızlı maç etkilenmez: clock_ms=60000, first_turn_mode='random' (default),
--   -- set_secret saatleri 60000 kurar, sıra rastgele.
