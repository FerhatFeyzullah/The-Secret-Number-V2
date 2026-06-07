-- Faz 2a: Protokol kataloğu + sahiplik + satın alma (Veri) + loadout
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Maç içi ETKİ YOK (Faz 3). Burada yalnızca: katalog (sunucu doğruluk kaynağı),
-- sahiplik, unlock_protocol (Veri ile satın alma), loadout (yuva limiti).
-- Tüm doğrulama sunucuda; istemci protokol açamaz / Veri / owned / loadout YAZAMAZ
-- (migration 9'daki kolon-bazlı grant yalnızca username'e izin verir; yeni
-- kolonlar otomatik kapalı). İstemci kataloğu src/protocols/catalog.ts ile bire
-- bir aynıdır (değerler eşleşmeli).

-- 1) Katalog tablosu (sunucu doğrulama otoritesi) -----------------------------------
create table if not exists public.protocols (
  id text primary key,
  pillar text not null check (pillar in ('info', 'time', 'disrupt', 'defense')),
  level_gate int not null,
  veri_cost int not null,
  one_shot boolean not null default false
);

insert into public.protocols (id, pillar, level_gate, veri_cost, one_shot) values
  ('time_add',        'time',    1,    0, false),
  ('info_eliminate',  'info',    1,    0, false),
  ('def_shield',      'defense', 2,  250, false),
  ('info_readlast',   'info',    2,  300, false),
  ('time_steal',      'time',    3,  350, false),
  ('disrupt_fog',     'disrupt', 3,  350, false),
  ('info_postest',    'info',    4,  450, false),
  ('time_freeze',     'time',    5,  550, false),
  ('disrupt_silence', 'disrupt', 5,  600, false),
  ('time_slow',       'time',    6,  700, false),
  ('disrupt_waste',   'disrupt', 7,  850, false),
  ('info_reveal',     'info',    8, 1100, true),
  ('disrupt_deceive', 'disrupt', 9, 1300, false),
  ('def_reflect',     'defense', 10, 1500, false)
on conflict (id) do update set
  pillar = excluded.pillar,
  level_gate = excluded.level_gate,
  veri_cost = excluded.veri_cost,
  one_shot = excluded.one_shot;

-- Katalog gizli değil; giriş yapan herkes okuyabilir (istemci yine kendi
-- config'ini kullanır). Yazma istemciye kapalı.
alter table public.protocols enable row level security;
drop policy if exists "protocols_select_authenticated" on public.protocols;
create policy "protocols_select_authenticated"
  on public.protocols for select using (auth.uid() is not null);
revoke all on table public.protocols from anon, authenticated;
grant select on table public.protocols to authenticated;

-- 2) Sahiplik + loadout kolonları --------------------------------------------------
-- Yeni kullanıcı bedava Sv1 ikilisiyle başlar (time_add + info_eliminate);
-- add column default'u mevcut satırlara da uygulanır (geri dolum).
alter table public.profiles
  add column if not exists owned_protocols text[] not null
  default array['time_add', 'info_eliminate']::text[];
alter table public.profiles
  add column if not exists loadout text[] not null
  default array['time_add', 'info_eliminate']::text[];

-- 3) Yuva limiti: Sv1-2 → 2, Sv3+ → 3 ----------------------------------------------
create or replace function public._loadout_slots(p_level int)
returns int language sql immutable as $$
  select case when p_level >= 3 then 3 else 2 end;
$$;
revoke execute on function public._loadout_slots(int) from public, anon, authenticated;

-- 4) unlock_protocol: Veri ile satın alma (atomik, yarış güvenli) -------------------
create or replace function public.unlock_protocol(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  proto public.protocols;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into proto from protocols where id = p_id;
  if not found then
    raise exception 'protocol_not_found';
  end if;
  -- Profil satırını kilitle: eşzamanlı/çifte unlock serileşir, Veri iki kez düşmez.
  select * into me from profiles where id = uid for update;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if p_id = any(me.owned_protocols) then
    raise exception 'already_owned';
  end if;
  if me.level < proto.level_gate then
    raise exception 'level_too_low';
  end if;
  if me.veri < proto.veri_cost then
    raise exception 'insufficient_veri';
  end if;

  update profiles
     set veri = veri - proto.veri_cost,
         owned_protocols = array_append(owned_protocols, p_id)
   where id = uid;

  return jsonb_build_object(
    'id', p_id,
    'veri', me.veri - proto.veri_cost,
    'owned', array_append(me.owned_protocols, p_id));
end;
$$;
revoke execute on function public.unlock_protocol(text) from public, anon;
grant execute on function public.unlock_protocol(text) to authenticated;

-- 5) set_loadout: seçili protokolleri kaydet (sahiplik + yuva limiti) ---------------
create or replace function public.set_loadout(p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  slots int;
  pid text;
  ids text[] := coalesce(p_ids, '{}');
  n int := coalesce(array_length(ids, 1), 0);
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into me from profiles where id = uid for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  slots := _loadout_slots(me.level);
  if n > slots then
    raise exception 'loadout_too_large';
  end if;
  -- Tekrar eden id olmamalı.
  if (select count(distinct x) from unnest(ids) x) <> n then
    raise exception 'invalid_loadout';
  end if;
  -- Hepsi sahip olunan olmalı (owned ⊆ katalog olduğundan geçerlilik de kapsanır).
  foreach pid in array ids loop
    if not (pid = any(me.owned_protocols)) then
      raise exception 'not_owned';
    end if;
  end loop;

  update profiles set loadout = ids where id = uid;
  return jsonb_build_object('loadout', ids, 'slots', slots);
end;
$$;
revoke execute on function public.set_loadout(text[]) from public, anon;
grant execute on function public.set_loadout(text[]) to authenticated;

-- 6) get_my_rank: + owned_protocols / loadout / loadout_slots (UI için) -------------
-- (20260607000000 sürümü korunarak yalnızca sahiplik/loadout alanları eklendi.)
create or replace function public.get_my_rank()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  my_rank bigint;
  my_wins bigint;
  my_played bigint;
  thresholds int[] := public._xp_thresholds();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into me from profiles where id = uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  select 1 + count(*) into my_rank from profiles where rating > me.rating;
  select count(*) into my_wins
    from matches
   where winner = uid and mode = 'quick' and status = 'finished';
  select count(*) into my_played
    from matches
   where mode = 'quick' and status = 'finished'
     and (player1 = uid or player2 = uid);
  return jsonb_build_object(
    'rank', my_rank,
    'username', me.username,
    'rating', me.rating,
    'wins', my_wins,
    'played', my_played,
    'streak', me.current_streak,
    'xp', me.xp,
    'level', me.level,
    'veri', me.veri,
    'level_floor', thresholds[me.level],
    'level_next', case
      when me.level >= array_length(thresholds, 1) then null
      else thresholds[me.level + 1]
    end,
    'owned_protocols', to_jsonb(me.owned_protocols),
    'loadout', to_jsonb(me.loadout),
    'loadout_slots', _loadout_slots(me.level));
end;
$$;
-- get_my_rank grant'i migration 9'da verildi; create or replace korur.

-- 7) Doğrulama (panelde elle denenebilir) ------------------------------------------
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"USER_A"}';
--   select get_my_rank();                 -- owned: [time_add, info_eliminate], slots 2
--   select unlock_protocol('def_shield'); -- Sv2/250: seviye/Veri yetersizse hata
--   select set_loadout(array['time_add','info_eliminate']);  -- OK (2 yuva)
--   select set_loadout(array['time_add','info_eliminate','def_shield']); -- loadout_too_large (Sv<3)
--   -- İstemci yazamaz:
--   update public.profiles set veri = 9999 where id = auth.uid();  -- permission denied
--   reset role;
