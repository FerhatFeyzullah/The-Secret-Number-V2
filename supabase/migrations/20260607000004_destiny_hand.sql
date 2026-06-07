-- Faz 3 / Adım 3: Destiny's Hand — maç başı rastgele el + seçim (otoriteli)
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Protokol Maçı (mode='protocol') eşleşince, BELİRLEME ÖNCESİ bir "seçim fazı"
-- (status='protocol_select') gelir: her oyuncuya SUNUCUDA sahip olduklarından
-- rastgele bir EL dağıtılır (yuva+3, sahip sayısıyla sınırlı); oyuncu elinden
-- yuva kadar protokol seçer. Seçim maç başına BİR KEZ (tur başına değil); Best
-- of 3 boyunca sabit. Süre (20 sn) dolarsa ya da eksik seçilirse sunucu eldeki
-- kartlardan rastgele tamamlar. Protokol ETKİLERİ bu adımda YOK (Adım 4).
-- Quick (tek tur) + offline: seçim fazı YOK — değişmez.
--
-- Gizlilik: el + seçim protocol_hands tablosunda; RLS "yalnızca kendi satırı"
-- → rakibin eli/seçimi sızmaz. Yazma yalnız security definer RPC'lerden.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ŞEMA: yeni status 'protocol_select' + select_deadline
-- ════════════════════════════════════════════════════════════════════════════
alter table public.matches drop constraint if exists matches_status_check;
alter table public.matches
  add constraint matches_status_check check (status in (
    'waiting', 'protocol_select', 'setup', 'active', 'finished', 'cancelled', 'abandoned'
  ));

alter table public.matches add column if not exists select_deadline timestamptz;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) protocol_hands: dağıtılan el + seçim (RLS ile rakibe KAPALI)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.protocol_hands (
  match_id uuid not null references public.matches(id) on delete cascade,
  player   uuid not null references public.profiles(id) on delete cascade,
  hand     text[] not null,
  selected text[] not null default '{}',
  primary key (match_id, player)
);

alter table public.protocol_hands enable row level security;
drop policy if exists "protocol_hands_select_own" on public.protocol_hands;
create policy "protocol_hands_select_own"
  on public.protocol_hands for select
  using (auth.uid() = player);
-- INSERT/UPDATE politikası YOK: tüm yazma security definer RPC'lerden.
revoke all on table public.protocol_hands from anon, authenticated;
grant select on table public.protocol_hands to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Yardımcılar: yuva (seviye), el dağıtımı, eksik-seçim tamamlama
-- ════════════════════════════════════════════════════════════════════════════
-- Yuva limiti SUNUCUDA seviyeye göre: Sv4+ → 3, altı → 2 (istemciye güvenme).
create or replace function public._protocol_slots(p_level int)
returns int language sql immutable as $$
  select case when p_level >= 4 then 3 else 2 end;
$$;

-- Bir oyuncuya el dağıt: sahip olduklarından (owned_protocols) rastgele yuva+3
-- kart; sahip sayısı azsa o kadar. OTORİTELİ — istemci eline karışamaz.
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
  select coalesce(array_agg(x), '{}') into dealt
    from (select unnest(pr.owned_protocols) x order by random() limit hand_size) s;
  insert into protocol_hands (match_id, player, hand, selected)
  values (p_match_id, p_player, dealt, '{}')
  on conflict (match_id, player) do update set hand = excluded.hand, selected = '{}';
end;
$$;
revoke execute on function public._deal_protocol_hand(uuid, uuid) from public, anon, authenticated;

-- Seçimi yuvaya kadar elden rastgele tamamla (chosen ⊆ hand, distinct varsayılır).
-- Hedef = min(slots, el boyutu). volatile (random).
create or replace function public._fill_selection(p_hand text[], p_chosen text[], p_slots int)
returns text[] language plpgsql volatile as $$
declare
  target int;
  result text[] := coalesce(p_chosen, '{}');
  pool text[];
  pick text;
begin
  target := least(p_slots, coalesce(array_length(p_hand, 1), 0));
  if coalesce(array_length(result, 1), 0) >= target then
    return result[1:target];
  end if;
  select coalesce(array_agg(x order by random()), '{}') into pool
    from (select unnest(p_hand) x except select unnest(result)) s;
  foreach pick in array pool loop
    exit when coalesce(array_length(result, 1), 0) >= target;
    result := result || pick;
  end loop;
  return result;
end;
$$;
revoke execute on function public._fill_selection(text[], text[], int) from public, anon, authenticated;

-- Seçim fazından belirlemeye geç (iki taraf zaten present; el sıkışması yok).
create or replace function public._start_protocol_setup(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update matches
     set status = 'setup',
         setup_deadline = now() + interval '30 seconds',
         select_deadline = null,
         player1_ready = false,
         player2_ready = false
   where id = p_match_id;
end;
$$;
revoke execute on function public._start_protocol_setup(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) find_or_create_protocol_match: katılınca → protocol_select + el dağıt
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

  -- Çağıranın ölü maçlarını kapat (bayat waiting / süresi geçmiş setup/seçim).
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

  select * into m
    from matches
   where status = 'waiting' and mode = 'protocol' and player1 = uid
   order by created_at
   limit 1;
  if found then
    return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', m.status);
  end if;

  select * into m
    from matches
   where status = 'waiting' and mode = 'protocol'
     and player1 <> uid and player2 is null
     and created_at >= now() - interval '2 minutes'
   order by created_at
   limit 1
   for update skip locked;

  if found then
    -- Katıl → seçim fazı; her iki oyuncuya el dağıt (otoriteli).
    update matches set player2 = uid, status = 'protocol_select' where id = m.id;
    perform _deal_protocol_hand(m.id, m.player1);
    perform _deal_protocol_hand(m.id, uid);
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'protocol_select');
  end if;

  insert into matches (mode, player1, win_target) values ('protocol', uid, 2)
    returning * into m;
  return jsonb_build_object('match_id', m.id, 'role', 'player1', 'status', 'waiting');
end;
$$;
revoke execute on function public.find_or_create_protocol_match() from public, anon;
grant execute on function public.find_or_create_protocol_match() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) mark_ready: setup + protocol_select (present → ilgili deadline'ı başlat)
-- ════════════════════════════════════════════════════════════════════════════
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
    -- İki taraf hazır: seçim (20 sn) ya da belirleme (30 sn) penceresini başlat.
    if is_select then
      if m.select_deadline is null then
        update matches set select_deadline = now() + interval '20 seconds',
                           present_deadline = null
         where id = m.id returning * into m;
      end if;
    else
      if m.setup_deadline is null then
        update matches set setup_deadline = now() + interval '30 seconds',
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

-- ════════════════════════════════════════════════════════════════════════════
-- 6) cancel_setup_timeout: setup + protocol_select idle iptali
-- ════════════════════════════════════════════════════════════════════════════
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

  if m.status not in ('setup', 'protocol_select') then
    raise exception 'not_in_setup';
  end if;

  both_present := m.player1_present and m.player2_present;

  if m.status = 'protocol_select' then
    -- Seçim fazında iptal yalnız idle: bir taraf gelmedi, present_deadline geçti.
    -- (İki taraf present + select_deadline geçti → resolve_protocol_select tamamlar.)
    if not (not both_present and m.present_deadline is not null and now() > m.present_deadline) then
      raise exception 'setup_not_expired';
    end if;
  else
    select count(*) into secret_count
      from secrets where match_id = m.id and round = m.current_round;
    if not (
         (not both_present and m.present_deadline is not null and now() > m.present_deadline)
      or (both_present and m.setup_deadline is not null and now() > m.setup_deadline and secret_count < 2)
    ) then
      raise exception 'setup_not_expired';
    end if;
    if both_present and secret_count = 2 then
      raise exception 'match_already_ready';
    end if;
  end if;

  update matches
     set status = 'cancelled', result = 'cancelled',
         current_turn = null, turn_started_at = null
   where id = m.id
   returning * into m;

  return jsonb_build_object('match_id', m.id, 'status', m.status, 'result', m.result);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) leave_match: protocol_select de "henüz başlamadı" → iptal (forfeit DEĞİL)
-- ════════════════════════════════════════════════════════════════════════════
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

  if m.status in ('waiting', 'protocol_select')
     or (m.status = 'setup' and m.current_round = 1) then
    -- Maç gerçekten başlamadı: iptal (kazanan yok).
    update matches
       set status = 'cancelled', result = 'cancelled',
           current_turn = null, turn_started_at = null
     where id = m.id
     returning * into m;
  else
    -- active ya da turlar arası (setup, round>1): mid-match → hükmen kaybeder.
    opp := case when uid = m.player1 then m.player2 else m.player1 end;
    update matches
       set status = 'finished', result = 'forfeit', winner = opp,
           current_turn = null, turn_started_at = null
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'left', true,
    'status', m.status, 'result', m.result, 'winner', m.winner);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) get_my_hand: çağıranın eli + seçimi + yuva (rakibinki ASLA)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.get_my_hand(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  h public.protocol_hands;
  pr public.profiles;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  perform _match_for_player(p_match_id); -- oyuncu değilse hata
  select * into h from protocol_hands where match_id = p_match_id and player = uid;
  select * into pr from profiles where id = uid;
  if not found then
    return jsonb_build_object('hand', '[]'::jsonb, 'selected', '[]'::jsonb,
                              'slots', _protocol_slots(coalesce(pr.level, 1)));
  end if;
  return jsonb_build_object(
    'hand', to_jsonb(h.hand),
    'selected', to_jsonb(h.selected),
    'slots', _protocol_slots(pr.level));
end;
$$;
revoke execute on function public.get_my_hand(uuid) from public, anon;
grant execute on function public.get_my_hand(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) set_protocol_selection: seçimi doğrula + kaydet (eksikse tamamla); kilitle
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.set_protocol_selection(p_match_id uuid, p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  h public.protocol_hands;
  pr public.profiles;
  slots int;
  v_ids text[] := coalesce(p_ids, '{}');
  final text[];
begin
  m := _match_for_player(p_match_id);
  if m.status <> 'protocol_select' then
    raise exception 'not_in_select';
  end if;

  select * into h from protocol_hands where match_id = m.id and player = uid;
  if not found then
    raise exception 'no_hand';
  end if;
  select * into pr from profiles where id = uid;
  slots := _protocol_slots(pr.level);

  -- Doğrulama: seçilenler elde mi, tekrar var mı, yuvayı aşıyor mu (OTORİTELİ).
  if not (v_ids <@ h.hand) then
    raise exception 'not_in_hand';
  end if;
  if (select count(*) from unnest(v_ids)) <>
     (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'invalid_selection';
  end if;
  if coalesce(array_length(v_ids, 1), 0) > slots then
    raise exception 'too_many_selected';
  end if;

  -- Eksikse eldeki kartlardan rastgele yuvaya kadar tamamla.
  final := _fill_selection(h.hand, v_ids, slots);
  update protocol_hands set selected = final where match_id = m.id and player = uid;

  -- Seçimi KİLİTLE (matches'taki boolean ready bayrağı; içerik sızdırmaz).
  if uid = m.player1 then
    update matches set player1_ready = true where id = m.id returning * into m;
  else
    update matches set player2_ready = true where id = m.id returning * into m;
  end if;

  -- İki taraf da kilitlediyse belirlemeye geç.
  if m.player1_ready and m.player2_ready then
    perform _start_protocol_setup(m.id);
    return jsonb_build_object('match_id', m.id, 'status', 'setup', 'selected', to_jsonb(final));
  end if;

  return jsonb_build_object('match_id', m.id, 'status', 'protocol_select', 'selected', to_jsonb(final));
end;
$$;
revoke execute on function public.set_protocol_selection(uuid, text[]) from public, anon;
grant execute on function public.set_protocol_selection(uuid, text[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 10) resolve_protocol_select: süre dolunca eksikleri rastgele tamamla → setup
-- ════════════════════════════════════════════════════════════════════════════
-- Her iki istemci de yerel sayaç 0'a inince çağırır (idempotent, otoriteli).
create or replace function public.resolve_protocol_select(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  rec record;
  pr public.profiles;
  slots int;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'protocol_select' then
    return jsonb_build_object('match_id', m.id, 'status', m.status);
  end if;
  if not (m.player1_present and m.player2_present) then
    raise exception 'not_both_present';
  end if;
  if m.select_deadline is null or now() <= m.select_deadline then
    raise exception 'select_not_expired';
  end if;

  perform 1 from matches where id = m.id for update;

  -- Boş (kilitlenmemiş) seçimleri eldeki kartlardan rastgele tamamla.
  for rec in select * from protocol_hands where match_id = m.id loop
    if coalesce(array_length(rec.selected, 1), 0) = 0 then
      select * into pr from profiles where id = rec.player;
      slots := _protocol_slots(pr.level);
      update protocol_hands
         set selected = _fill_selection(rec.hand, '{}', slots)
       where match_id = m.id and player = rec.player;
    end if;
  end loop;

  perform _start_protocol_setup(m.id);
  return jsonb_build_object('match_id', m.id, 'status', 'setup');
end;
$$;
revoke execute on function public.resolve_protocol_select(uuid) from public, anon;
grant execute on function public.resolve_protocol_select(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 11) Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - El boyutu = min(owned, slots+3); slots Sv4+→3, altı→2.
--   - Eksik seçim → süre dolunca resolve rastgele tamamlar.
--   - Quick'te protocol_select YOK (find_or_create_quick_match → setup).
--   - Rakibin eli/seçimi: protocol_hands RLS (kendi satırı) → sızmaz.
