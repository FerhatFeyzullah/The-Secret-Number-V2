-- ══════════════════════════════════════════════════════════════════════════
-- KLAN SİSTEMİ — Faz 1: İskelet (kimlik + üyelik)
--
-- Tablolar: clans, clan_members, clan_join_requests.
-- Roller (saklanan): leader / coleader / member. UI etiketleri:
--   leader → Operatör · coleader → Şifreci · member(kıdemli) → Ajan · member → Çaylak
--   "Ajan" TÜRETİLİR: profiles.wins - clan_members.wins_at_join >= AJAN_ESIGI (10).
-- Katılım modları: open (anında) / approval (istek+onay). 'invite' enum'da var ama
--   Faz 1'de create_clan izin vermez (davet gönderme Faz 2).
-- Klan kurma şartı: seviye >= 3 ve 1000 Veri (kurulunca düşülür). Boyut <= 30.
--
-- Kimlik: oyuncu = auth.uid() = profiles.id (uuid). Tüm mutasyonlar SECURITY DEFINER
-- RPC'lerden; istemciye INSERT/UPDATE/DELETE verilmez. Hata: raise exception '<token>'.
-- ══════════════════════════════════════════════════════════════════════════

-- ─── Tablolar ──────────────────────────────────────────────────────────────

create table if not exists public.clans (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  tag           text not null,
  description   text not null default '',
  emblem        jsonb not null default '{}'::jsonb,
  join_mode     text not null default 'open' check (join_mode in ('open', 'approval', 'invite')),
  min_trophies  int  not null default 0,
  owner         uuid not null references public.profiles (id) on delete cascade,
  member_count  int  not null default 1,
  created_at    timestamptz not null default now()
);
-- Tag benzersiz (büyük/küçük duyarsız).
create unique index if not exists clans_tag_unique on public.clans (upper(tag));
create index if not exists clans_member_count_idx on public.clans (member_count desc);

-- Oyuncu TEK klanda: player birincil anahtar.
create table if not exists public.clan_members (
  player        uuid primary key references public.profiles (id) on delete cascade,
  clan_id       uuid not null references public.clans (id) on delete cascade,
  role          text not null default 'member' check (role in ('leader', 'coleader', 'member')),
  wins_at_join  int  not null default 0,   -- katılınca oyuncunun kalıcı galibiyeti (Ajan türetimi)
  joined_at     timestamptz not null default now()
);
create index if not exists clan_members_clan_idx on public.clan_members (clan_id);

-- Onaylı mod: bekleyen katılım istekleri.
create table if not exists public.clan_join_requests (
  clan_id     uuid not null references public.clans (id) on delete cascade,
  player      uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (clan_id, player)
);
create index if not exists clan_requests_player_idx on public.clan_join_requests (player);

-- ─── RLS: okuma açık (dizin/roster); yazma yalnız RPC ──────────────────────

alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.clan_join_requests enable row level security;

drop policy if exists "clans_select_auth" on public.clans;
create policy "clans_select_auth" on public.clans
  for select using (auth.uid() is not null);
revoke all on table public.clans from anon, authenticated;
grant select on table public.clans to authenticated;

drop policy if exists "clan_members_select_auth" on public.clan_members;
create policy "clan_members_select_auth" on public.clan_members
  for select using (auth.uid() is not null);
revoke all on table public.clan_members from anon, authenticated;
grant select on table public.clan_members to authenticated;

-- İstekler: yalnız kendi isteğin ya da yönettiğin klanın istekleri görünür.
drop policy if exists "clan_requests_select" on public.clan_join_requests;
create policy "clan_requests_select" on public.clan_join_requests
  for select using (
    player = auth.uid()
    or exists (
      select 1 from public.clan_members cm
       where cm.clan_id = clan_join_requests.clan_id
         and cm.player = auth.uid()
         and cm.role in ('leader', 'coleader')
    )
  );
revoke all on table public.clan_join_requests from anon, authenticated;
grant select on table public.clan_join_requests to authenticated;

-- ─── İç yardımcılar (server-only) ──────────────────────────────────────────

-- Bir klanın üye listesi (rütbe → katkı → kupa sırası). Katkı = wins - wins_at_join.
create or replace function public._clan_members_json(p_clan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player', cm.player,
        'username', p.username,
        'role', cm.role,
        'rating', p.rating,
        'contribution', greatest(0, p.wins - cm.wins_at_join),
        'joined_at', cm.joined_at
      )
      order by
        case cm.role when 'leader' then 0 when 'coleader' then 1 else 2 end,
        greatest(0, p.wins - cm.wins_at_join) desc,
        p.rating desc
    ),
    '[]'::jsonb
  )
  from clan_members cm
  join profiles p on p.id = cm.player
  where cm.clan_id = p_clan_id;
$$;
revoke execute on function public._clan_members_json(uuid) from public, anon, authenticated;

-- Bir klanın bekleyen istekleri (yönetici görünümü).
create or replace function public._clan_requests_json(p_clan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player', r.player,
        'username', p.username,
        'rating', p.rating,
        'created_at', r.created_at
      )
      order by r.created_at
    ),
    '[]'::jsonb
  )
  from clan_join_requests r
  join profiles p on p.id = r.player
  where r.clan_id = p_clan_id;
$$;
revoke execute on function public._clan_requests_json(uuid) from public, anon, authenticated;

-- ─── Okuma RPC'leri ────────────────────────────────────────────────────────

-- Oyuncunun klanı (yoksa null). Yönetici ise 'requests' de gelir.
create or replace function public.get_my_clan()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.clan_members;
  c public.clans;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into m from clan_members where player = uid;
  if not found then
    return null;   -- klanda değil
  end if;
  select * into c from clans where id = m.clan_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'tag', c.tag,
    'description', c.description,
    'emblem', c.emblem,
    'join_mode', c.join_mode,
    'min_trophies', c.min_trophies,
    'member_count', c.member_count,
    'owner', c.owner,
    'my_role', m.role,
    'members', public._clan_members_json(c.id),
    'requests', case
      when m.role in ('leader', 'coleader') then public._clan_requests_json(c.id)
      else '[]'::jsonb
    end
  );
end;
$$;
revoke execute on function public.get_my_clan() from public, anon;
grant execute on function public.get_my_clan() to authenticated;

-- Klan dizini + arama (ad/tag). Boş sorgu → en kalabalık 40 klan.
create or replace function public.list_clans(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(card order by mc desc, created_at desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'tag', c.tag,
        'emblem', c.emblem,
        'join_mode', c.join_mode,
        'min_trophies', c.min_trophies,
        'member_count', c.member_count
      ) as card,
      c.member_count as mc,
      c.created_at
    from clans c
    where p_query is null
       or btrim(p_query) = ''
       or c.name ilike '%' || p_query || '%'
       or c.tag ilike '%' || p_query || '%'
    order by c.member_count desc, c.created_at desc
    limit 40
  ) s;
$$;
revoke execute on function public.list_clans(text) from public, anon;
grant execute on function public.list_clans(text) to authenticated;

-- Oyuncunun bekleyen katılım istekleri (klanda-değil ekranı için).
create or replace function public.get_my_requests()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id, 'name', c.name, 'tag', c.tag, 'emblem', c.emblem,
        'join_mode', c.join_mode, 'min_trophies', c.min_trophies, 'member_count', c.member_count
      )
      order by r.created_at desc
    ),
    '[]'::jsonb
  )
  from clan_join_requests r
  join clans c on c.id = r.clan_id
  where r.player = auth.uid();
$$;
revoke execute on function public.get_my_requests() from public, anon;
grant execute on function public.get_my_requests() to authenticated;

-- ─── Mutasyon RPC'leri ─────────────────────────────────────────────────────

-- Klan kur: Sv.>=3 ve 1000 Veri; kuran = Operatör (leader).
create or replace function public.create_clan(
  p_name text,
  p_tag text,
  p_description text,
  p_emblem jsonb,
  p_join_mode text,
  p_min_trophies int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  new_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_tag  text := upper(btrim(coalesce(p_tag, '')));
  v_desc text := btrim(coalesce(p_description, ''));
  v_mode text := coalesce(p_join_mode, 'open');
  v_min  int  := greatest(0, coalesce(p_min_trophies, 0));
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 20 then
    raise exception 'invalid_clan_name';
  end if;
  if char_length(v_tag) < 2 or char_length(v_tag) > 5 or v_tag !~ '^[A-Z0-9]+$' then
    raise exception 'invalid_clan_tag';
  end if;
  if char_length(v_desc) > 120 then
    raise exception 'invalid_clan_description';
  end if;
  -- Faz 1: yalnız open/approval kurulabilir (davet gönderme Faz 2).
  if v_mode not in ('open', 'approval') then
    raise exception 'invalid_join_mode';
  end if;

  select * into me from profiles where id = uid for update;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if exists (select 1 from clan_members where player = uid) then
    raise exception 'already_in_clan';
  end if;
  if me.level < 3 then
    raise exception 'level_too_low';
  end if;
  if me.veri < 1000 then
    raise exception 'insufficient_veri';
  end if;
  if exists (select 1 from clans where upper(tag) = v_tag) then
    raise exception 'clan_tag_taken';
  end if;

  update profiles set veri = veri - 1000 where id = uid;

  insert into clans (name, tag, description, emblem, join_mode, min_trophies, owner, member_count)
  values (v_name, v_tag, v_desc, coalesce(p_emblem, '{}'::jsonb), v_mode, v_min, uid, 1)
  returning id into new_id;

  insert into clan_members (player, clan_id, role, wins_at_join)
  values (uid, new_id, 'leader', me.wins);

  -- Klana girince oyuncunun tüm bekleyen istekleri temizlenir.
  delete from clan_join_requests where player = uid;

  return public.get_my_clan();
end;
$$;
revoke execute on function public.create_clan(text, text, text, jsonb, text, int) from public, anon;
grant execute on function public.create_clan(text, text, text, jsonb, text, int) to authenticated;

-- Klana katıl / istek gönder (moda göre).
create or replace function public.join_clan(p_clan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  c public.clans;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into me from profiles where id = uid;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if exists (select 1 from clan_members where player = uid) then
    raise exception 'already_in_clan';
  end if;
  select * into c from clans where id = p_clan_id for update;
  if not found then
    raise exception 'clan_not_found';
  end if;
  if me.rating < c.min_trophies then
    raise exception 'trophies_too_low';
  end if;

  if c.join_mode = 'approval' then
    insert into clan_join_requests (clan_id, player) values (c.id, uid)
      on conflict do nothing;
    return jsonb_build_object('status', 'requested');
  end if;

  -- open (ya da ileride invite kabul edilmişse): doğrudan üye ol.
  if c.member_count >= 30 then
    raise exception 'clan_full';
  end if;
  insert into clan_members (player, clan_id, role, wins_at_join)
  values (uid, c.id, 'member', me.wins);
  update clans set member_count = member_count + 1 where id = c.id;
  delete from clan_join_requests where player = uid;
  return jsonb_build_object('status', 'joined', 'clan', public.get_my_clan());
end;
$$;
revoke execute on function public.join_clan(uuid) from public, anon;
grant execute on function public.join_clan(uuid) to authenticated;

-- Bekleyen isteği iptal et.
create or replace function public.cancel_request(p_clan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  delete from clan_join_requests where clan_id = p_clan_id and player = uid;
  return jsonb_build_object('cancelled', p_clan_id);
end;
$$;
revoke execute on function public.cancel_request(uuid) from public, anon;
grant execute on function public.cancel_request(uuid) to authenticated;

-- Klandan ayrıl. Lider + başka üye varsa önce devir gerekir.
create or replace function public.leave_clan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.clan_members;
  cnt int;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into m from clan_members where player = uid for update;
  if not found then
    raise exception 'not_in_clan';
  end if;
  select member_count into cnt from clans where id = m.clan_id for update;
  if m.role = 'leader' and cnt > 1 then
    raise exception 'leader_must_transfer';
  end if;
  delete from clan_members where player = uid;
  if cnt <= 1 then
    delete from clans where id = m.clan_id;   -- son üye = klan dağılır
  else
    update clans set member_count = member_count - 1 where id = m.clan_id;
  end if;
  return jsonb_build_object('left', true);
end;
$$;
revoke execute on function public.leave_clan() from public, anon;
grant execute on function public.leave_clan() to authenticated;

-- Üye at (lider herkesi, yönetici lider hariç herkesi).
create or replace function public.kick_member(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.clan_members;
  target public.clan_members;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_player = uid then
    raise exception 'cannot_kick_self';
  end if;
  select * into me from clan_members where player = uid;
  if not found or me.role not in ('leader', 'coleader') then
    raise exception 'not_authorized';
  end if;
  select * into target from clan_members where player = p_player for update;
  if not found or target.clan_id <> me.clan_id then
    raise exception 'member_not_found';
  end if;
  if target.role = 'leader' then
    raise exception 'cannot_kick_leader';
  end if;
  delete from clan_members where player = p_player;
  update clans set member_count = member_count - 1 where id = me.clan_id;
  return jsonb_build_object('kicked', p_player);
end;
$$;
revoke execute on function public.kick_member(uuid) from public, anon;
grant execute on function public.kick_member(uuid) to authenticated;

-- Rol ata/al (Yönetici ↔ Üye) — YALNIZ Lider.
create or replace function public.set_member_role(p_player uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.clan_members;
  target public.clan_members;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_role not in ('coleader', 'member') then
    raise exception 'invalid_role';
  end if;
  if p_player = uid then
    raise exception 'invalid_role';
  end if;
  select * into me from clan_members where player = uid;
  if not found or me.role <> 'leader' then
    raise exception 'not_authorized';
  end if;
  select * into target from clan_members where player = p_player for update;
  if not found or target.clan_id <> me.clan_id then
    raise exception 'member_not_found';
  end if;
  if target.role = 'leader' then
    raise exception 'invalid_role';
  end if;
  update clan_members set role = p_role where player = p_player;
  return jsonb_build_object('player', p_player, 'role', p_role);
end;
$$;
revoke execute on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- Liderliği devret (Lider → hedef; eski lider Yönetici olur).
create or replace function public.transfer_leadership(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.clan_members;
  target public.clan_members;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into me from clan_members where player = uid for update;
  if not found or me.role <> 'leader' then
    raise exception 'not_authorized';
  end if;
  if p_player = uid then
    raise exception 'member_not_found';
  end if;
  select * into target from clan_members where player = p_player for update;
  if not found or target.clan_id <> me.clan_id then
    raise exception 'member_not_found';
  end if;
  update clan_members set role = 'leader' where player = p_player;
  update clan_members set role = 'coleader' where player = uid;
  update clans set owner = p_player where id = me.clan_id;
  return jsonb_build_object('leader', p_player);
end;
$$;
revoke execute on function public.transfer_leadership(uuid) from public, anon;
grant execute on function public.transfer_leadership(uuid) to authenticated;

-- Klanı dağıt (yalnız Lider) — cascade ile üyeler/istekler silinir.
create or replace function public.disband_clan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.clan_members;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into me from clan_members where player = uid;
  if not found or me.role <> 'leader' then
    raise exception 'not_authorized';
  end if;
  delete from clans where id = me.clan_id;
  return jsonb_build_object('disbanded', true);
end;
$$;
revoke execute on function public.disband_clan() from public, anon;
grant execute on function public.disband_clan() to authenticated;

-- İsteği onayla (yönetici) — üye ekler, tüm isteklerini temizler.
create or replace function public.accept_request(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.clan_members;
  c public.clans;
  tp public.profiles;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into me from clan_members where player = uid;
  if not found or me.role not in ('leader', 'coleader') then
    raise exception 'not_authorized';
  end if;
  if not exists (select 1 from clan_join_requests where clan_id = me.clan_id and player = p_player) then
    raise exception 'request_not_found';
  end if;
  if exists (select 1 from clan_members where player = p_player) then
    delete from clan_join_requests where clan_id = me.clan_id and player = p_player;
    raise exception 'already_in_clan';
  end if;
  select * into c from clans where id = me.clan_id for update;
  if c.member_count >= 30 then
    raise exception 'clan_full';
  end if;
  select * into tp from profiles where id = p_player;
  if not found then
    raise exception 'profile_not_found';
  end if;
  insert into clan_members (player, clan_id, role, wins_at_join)
  values (p_player, me.clan_id, 'member', tp.wins);
  update clans set member_count = member_count + 1 where id = me.clan_id;
  delete from clan_join_requests where player = p_player;   -- tüm isteklerini temizle
  return jsonb_build_object('accepted', p_player, 'clan', public.get_my_clan());
end;
$$;
revoke execute on function public.accept_request(uuid) from public, anon;
grant execute on function public.accept_request(uuid) to authenticated;

-- İsteği reddet (yönetici).
create or replace function public.reject_request(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.clan_members;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into me from clan_members where player = uid;
  if not found or me.role not in ('leader', 'coleader') then
    raise exception 'not_authorized';
  end if;
  delete from clan_join_requests where clan_id = me.clan_id and player = p_player;
  return jsonb_build_object('rejected', p_player);
end;
$$;
revoke execute on function public.reject_request(uuid) from public, anon;
grant execute on function public.reject_request(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════
-- MANUEL DOĞRULAMA (Supabase SQL editor — auth shim ile):
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<USER_A_UUID>"}';
--   select create_clan('Şifre Kırıcılar', 'SK1', 'Test klanı', '{"shape":"shield","icon":"hash","color":"cyan"}', 'open', 0);
--   select get_my_clan();
--   select list_clans('');
--
--   -- USER_B başka bir kullanıcı; open klana katılır:
--   set local request.jwt.claims = '{"sub":"<USER_B_UUID>"}';
--   select join_clan('<CLAN_ID>');
--   select get_my_clan();
--
--   -- Lider (USER_A) USER_B'yi Yönetici yapar / atar / liderliği devreder:
--   set local request.jwt.claims = '{"sub":"<USER_A_UUID>"}';
--   select set_member_role('<USER_B_UUID>', 'coleader');
--   select kick_member('<USER_B_UUID>');            -- veya
--   select transfer_leadership('<USER_B_UUID>');
--   select leave_clan();  -- lider tek başınaysa klan dağılır
-- ══════════════════════════════════════════════════════════════════════════
