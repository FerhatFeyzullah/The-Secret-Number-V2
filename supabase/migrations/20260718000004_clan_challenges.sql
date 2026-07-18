-- ══════════════════════════════════════════════════════════════════════════
-- KLAN SİSTEMİ — Faz 2b: Klan içi meydan okuma (dostluk)
--
-- Bir üye, çevrimiçi klan üyesine dostluk maçı daveti gönderir (30 sn geçerli).
-- Onaylanınca iki oyuncu arası maç kurulur (create_private_room + join mantığı;
-- is_friendly=true → ödülsüz). Reddedilince hazır mesaj taşınır. Realtime.
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.clan_challenges (
  id            uuid primary key default gen_random_uuid(),
  from_player   uuid not null references public.profiles (id) on delete cascade,
  from_username text not null default '',
  to_player     uuid not null references public.profiles (id) on delete cascade,
  clan_id       uuid not null references public.clans (id) on delete cascade,
  mode          text not null check (mode in ('quick', 'protocol', 'word')),
  clock_ms      int  not null default 60000,
  first_turn    text not null default 'random',
  word_length   int,
  status        text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  reject_message text,
  match_id      uuid references public.matches (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index if not exists clan_challenges_to_idx on public.clan_challenges (to_player, status);
create index if not exists clan_challenges_from_idx on public.clan_challenges (from_player, status);
-- UPDATE/DELETE realtime olayları OLD satırın tamamını taşısın (filtreler çalışsın).
alter table public.clan_challenges replica identity full;

alter table public.clan_challenges enable row level security;
drop policy if exists "clan_challenges_select" on public.clan_challenges;
create policy "clan_challenges_select" on public.clan_challenges
  for select using (from_player = auth.uid() or to_player = auth.uid());
revoke all on table public.clan_challenges from anon, authenticated;
grant select on table public.clan_challenges to authenticated;

-- Realtime yayınına ekle (idempotent).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clan_challenges'
    ) then
      execute 'alter publication supabase_realtime add table public.clan_challenges';
    end if;
  end if;
end;
$$;

-- Bir oyuncu şu an gerçek bir maçta/kuyrukta mı? (meşgul kontrolü)
create or replace function public._player_busy(p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from matches
     where status in ('waiting', 'setup', 'active', 'protocol_select')
       and (player1 = p_player or player2 = p_player)
  );
$$;
revoke execute on function public._player_busy(uuid) from public, anon, authenticated;

-- ─── Davet gönder ──────────────────────────────────────────────────────────
create or replace function public.create_challenge(
  p_to uuid,
  p_mode text,
  p_clock_ms int,
  p_first_turn text,
  p_word_length int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  my_clan uuid;
  to_clan uuid;
  ch public.clan_challenges;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_to = uid then
    raise exception 'cannot_challenge_self';
  end if;
  if p_mode not in ('quick', 'protocol', 'word') then
    raise exception 'invalid_room_mode';
  end if;
  if p_clock_ms not in (60000, 90000, 120000, 180000) then
    raise exception 'invalid_clock';
  end if;
  if p_first_turn not in ('random', 'creator') then
    raise exception 'invalid_first_turn';
  end if;
  if p_word_length is not null and p_word_length not in (4, 5, 6) then
    raise exception 'invalid_word_length';
  end if;

  select clan_id into my_clan from clan_members where player = uid;
  if my_clan is null then
    raise exception 'not_in_clan';
  end if;
  select clan_id into to_clan from clan_members where player = p_to;
  if to_clan is null or to_clan <> my_clan then
    raise exception 'member_not_found';
  end if;

  if public._player_busy(uid) then
    raise exception 'already_in_match';
  end if;
  if public._player_busy(p_to) then
    raise exception 'opponent_busy';
  end if;
  if exists (
    select 1 from clan_challenges
     where to_player = p_to and status = 'pending' and expires_at > now()
  ) then
    raise exception 'opponent_busy';
  end if;

  select * into me from profiles where id = uid;
  -- Kendi eski bekleyen davetini iptal et (tek giden davet).
  update clan_challenges set status = 'cancelled' where from_player = uid and status = 'pending';

  insert into clan_challenges (
    from_player, from_username, to_player, clan_id, mode, clock_ms, first_turn, word_length, status, expires_at)
  values (
    uid, coalesce(me.username, ''), p_to, my_clan, p_mode, p_clock_ms, p_first_turn, p_word_length,
    'pending', now() + interval '30 seconds')
  returning * into ch;

  return jsonb_build_object(
    'id', ch.id, 'to_player', ch.to_player, 'mode', ch.mode,
    'status', ch.status, 'expires_at', ch.expires_at);
end;
$$;
revoke execute on function public.create_challenge(uuid, text, int, text, int) from public, anon;
grant execute on function public.create_challenge(uuid, text, int, text, int) to authenticated;

-- ─── Daveti onayla → dostluk maçı kur (iki oyuncu hazır) ───────────────────
create or replace function public.accept_challenge(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ch public.clan_challenges;
  new_match uuid;
  v_mode text;
  v_content text;
  v_win int;
  v_wl int;
  v_fwl int;
  v_status text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into ch from clan_challenges where id = p_id for update;
  if not found then
    raise exception 'challenge_not_found';
  end if;
  if ch.to_player <> uid then
    raise exception 'not_authorized';
  end if;
  if ch.status <> 'pending' then
    raise exception 'challenge_not_pending';
  end if;
  if ch.expires_at <= now() then
    update clan_challenges set status = 'expired' where id = ch.id;
    raise exception 'challenge_expired';
  end if;
  -- Bu arada taraflardan biri maça girmiş olabilir.
  if public._player_busy(ch.from_player) or public._player_busy(ch.to_player) then
    update clan_challenges set status = 'cancelled' where id = ch.id;
    raise exception 'opponent_busy';
  end if;

  -- Mod → maç ayarları (create_private_room mantığıyla birebir).
  if ch.mode = 'protocol' then
    v_mode := 'protocol'; v_content := 'number'; v_win := 2; v_wl := null; v_fwl := null; v_status := 'protocol_select';
  elsif ch.mode = 'word' then
    v_mode := 'private'; v_content := 'word'; v_win := 2;
    v_wl := coalesce(ch.word_length, 4 + floor(random() * 3)::int); v_fwl := ch.word_length; v_status := 'setup';
  else
    v_mode := 'private'; v_content := 'number'; v_win := 1; v_wl := null; v_fwl := null; v_status := 'setup';
  end if;

  -- Davet eden = player1 (kurucu), davet edilen = player2. Dostluk (ödülsüz).
  insert into matches (
    mode, player1, player2, clock_ms, first_turn_mode,
    content_type, win_target, word_length, fixed_word_length, is_friendly, status)
  values (
    v_mode, ch.from_player, ch.to_player, ch.clock_ms, ch.first_turn,
    v_content, v_win, v_wl, v_fwl, true, v_status)
  returning id into new_match;

  if ch.mode = 'protocol' then
    perform _deal_protocol_hand(new_match, ch.from_player);
    perform _deal_protocol_hand(new_match, ch.to_player);
  end if;

  update clan_challenges set status = 'accepted', match_id = new_match where id = ch.id;

  return jsonb_build_object('match_id', new_match, 'role', 'player2', 'status', v_status);
end;
$$;
revoke execute on function public.accept_challenge(uuid) from public, anon;
grant execute on function public.accept_challenge(uuid) to authenticated;

-- ─── Daveti reddet (hazır mesajla) ─────────────────────────────────────────
create or replace function public.reject_challenge(p_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ch public.clan_challenges;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into ch from clan_challenges where id = p_id for update;
  if not found then
    raise exception 'challenge_not_found';
  end if;
  if ch.to_player <> uid then
    raise exception 'not_authorized';
  end if;
  if ch.status <> 'pending' then
    raise exception 'challenge_not_pending';
  end if;
  update clan_challenges
     set status = 'rejected', reject_message = nullif(btrim(coalesce(p_message, '')), '')
   where id = ch.id;
  return jsonb_build_object('rejected', p_id);
end;
$$;
revoke execute on function public.reject_challenge(uuid, text) from public, anon;
grant execute on function public.reject_challenge(uuid, text) to authenticated;

-- ─── Daveti iptal et (gönderen) ────────────────────────────────────────────
create or replace function public.cancel_challenge(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ch public.clan_challenges;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into ch from clan_challenges where id = p_id for update;
  if not found then
    raise exception 'challenge_not_found';
  end if;
  if ch.from_player <> uid then
    raise exception 'not_authorized';
  end if;
  if ch.status <> 'pending' then
    raise exception 'challenge_not_pending';
  end if;
  update clan_challenges set status = 'cancelled' where id = ch.id;
  return jsonb_build_object('cancelled', p_id);
end;
$$;
revoke execute on function public.cancel_challenge(uuid) from public, anon;
grant execute on function public.cancel_challenge(uuid) to authenticated;

-- ─── Bekleyen gelen davet (yeniden bağlanınca kaçanı yakala) ───────────────
create or replace function public.get_pending_challenge()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', ch.id, 'from_player', ch.from_player, 'from_username', ch.from_username,
    'mode', ch.mode, 'clock_ms', ch.clock_ms, 'first_turn', ch.first_turn,
    'word_length', ch.word_length, 'expires_at', ch.expires_at)
  from clan_challenges ch
  where ch.to_player = auth.uid() and ch.status = 'pending' and ch.expires_at > now()
  order by ch.created_at desc
  limit 1;
$$;
revoke execute on function public.get_pending_challenge() from public, anon;
grant execute on function public.get_pending_challenge() to authenticated;

notify pgrst, 'reload schema';
