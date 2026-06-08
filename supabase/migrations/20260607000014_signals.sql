-- Sinyal sistemi Adım 2: sahiplik + Veri ile satın alma + 6'lık kalıcı deste
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Protokol deseninin (protocols / owned_protocols / unlock_protocol / set_loadout)
-- BİREBİR sinyal karşılığı. Maç-içi/UI YOK (Adım 3/4). Seviye kapısı YOK (yalnız
-- Veri). Tüm yazma (Veri düşme, owned/deck değişimi) security-definer RPC ile;
-- istemci yeni kolonlara YAZAMAZ (kolon-bazlı grant yalnız username'e izin verir).
-- İstemci kataloğu (src/signals/catalog.ts) ile fiyatlar BİREBİR aynı olmalı.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Katalog tablosu (sunucu doğrulama otoritesi) — src/signals/catalog.ts ile eş
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.signals (
  id text primary key,
  veri_cost int not null,
  starter boolean not null default false
);

insert into public.signals (id, veri_cost, starter) values
  ('sig_victory',   0,   true),
  ('sig_defeat',    0,   true),
  ('sig_gg',        0,   true),
  ('sig_laugh',     0,   true),
  ('sig_thinking',  0,   true),
  ('sig_shock',     150, false),
  ('sig_crying',    150, false),
  ('sig_anger',     150, false),
  ('sig_confident', 200, false),
  ('sig_disbelief', 200, false),
  ('sig_clap',      200, false),
  ('sig_lucky',     300, false),
  ('sig_eureka',    300, false),
  ('sig_respect',   300, false),
  ('sig_fire',      450, false),
  ('sig_ice',       450, false),
  ('sig_sneaky',    600, false),
  ('sig_locked',    800, false)
on conflict (id) do update set
  veri_cost = excluded.veri_cost,
  starter = excluded.starter;

-- Katalog gizli değil; giriş yapan herkes okuyabilir. Yazma istemciye kapalı.
alter table public.signals enable row level security;
drop policy if exists "signals_select_authenticated" on public.signals;
create policy "signals_select_authenticated"
  on public.signals for select using (auth.uid() is not null);
revoke all on table public.signals from anon, authenticated;
grant select on table public.signals to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Sahiplik + deste kolonları (starter ile başlar; default mevcut satırlara da
--    uygulanır → geri dolum). Deste varsayılanı 5 starter (asla boş kalmaz).
-- ════════════════════════════════════════════════════════════════════════════
alter table public.profiles
  add column if not exists owned_signals text[] not null
  default array['sig_victory', 'sig_defeat', 'sig_gg', 'sig_laugh', 'sig_thinking']::text[];
alter table public.profiles
  add column if not exists signal_deck text[] not null
  default array['sig_victory', 'sig_defeat', 'sig_gg', 'sig_laugh', 'sig_thinking']::text[];

-- Açık backfill: kolon önceden boş/null kalmışsa starter ile doldur (eski hesaplar).
update public.profiles
   set owned_signals = array['sig_victory', 'sig_defeat', 'sig_gg', 'sig_laugh', 'sig_thinking']::text[]
 where owned_signals is null or cardinality(owned_signals) = 0;
update public.profiles
   set signal_deck = array['sig_victory', 'sig_defeat', 'sig_gg', 'sig_laugh', 'sig_thinking']::text[]
 where signal_deck is null or cardinality(signal_deck) = 0;

-- Not: handle_new_user'a ekleme GEREKMEZ — owned_protocols deseninde olduğu gibi
-- kolon default'u yeni insert'lerde otomatik starter atar.

-- ════════════════════════════════════════════════════════════════════════════
-- 3) unlock_signal: Veri ile satın alma (atomik, yarış güvenli) — seviye kapısı yok
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.unlock_signal(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  sig public.signals;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into sig from signals where id = p_id;
  if not found then
    raise exception 'signal_not_found';
  end if;
  -- Profil satırını kilitle: eşzamanlı/çifte unlock serileşir, Veri iki kez düşmez.
  select * into me from profiles where id = uid for update;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if p_id = any(me.owned_signals) then
    raise exception 'already_owned';
  end if;
  if me.veri < sig.veri_cost then
    raise exception 'insufficient_veri';
  end if;

  update profiles
     set veri = veri - sig.veri_cost,
         owned_signals = array_append(owned_signals, p_id)
   where id = uid;

  return jsonb_build_object(
    'id', p_id,
    'veri', me.veri - sig.veri_cost,
    'owned_signals', to_jsonb(array_append(me.owned_signals, p_id)));
end;
$$;
revoke execute on function public.unlock_signal(text) from public, anon;
grant execute on function public.unlock_signal(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) set_signal_deck: kalıcı deste (≤6, hepsi owned, tekrar yok, boş değil)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.set_signal_deck(p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  sid text;
  ids text[] := coalesce(p_ids, '{}');
  n int := coalesce(array_length(ids, 1), 0);
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if n = 0 then
    raise exception 'deck_empty';
  end if;
  if n > 6 then
    raise exception 'deck_too_large';
  end if;
  -- Tekrar eden id olmamalı.
  if (select count(distinct x) from unnest(ids) x) <> n then
    raise exception 'invalid_deck';
  end if;

  select * into me from profiles where id = uid for update;
  if not found then
    raise exception 'profile_not_found';
  end if;
  -- Hepsi sahip olunan olmalı.
  foreach sid in array ids loop
    if not (sid = any(me.owned_signals)) then
      raise exception 'not_owned';
    end if;
  end loop;

  update profiles set signal_deck = ids where id = uid;
  return jsonb_build_object('signal_deck', to_jsonb(ids));
end;
$$;
revoke execute on function public.set_signal_deck(text[]) from public, anon;
grant execute on function public.set_signal_deck(text[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) get_my_rank: + owned_signals / signal_deck (istemci kendi verisini okur)
-- ════════════════════════════════════════════════════════════════════════════
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
   where winner = uid and mode in ('quick', 'protocol') and status = 'finished';
  select count(*) into my_played
    from matches
   where mode in ('quick', 'protocol') and status = 'finished'
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
    'owned_signals', to_jsonb(me.owned_signals),
    'signal_deck', to_jsonb(me.signal_deck));
end;
$$;
-- get_my_rank grant'i önceki migration'da verildi; create or replace korur.

-- PostgREST şema önbelleğini tazele.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Doğrulama (panelde elle)
-- ════════════════════════════════════════════════════════════════════════════
--   set local role authenticated; set local request.jwt.claims = '{"sub":"USER"}';
--   select get_my_rank();  -- owned_signals/signal_deck: 5 starter
--   select unlock_signal('sig_shock');   -- 150: yeterliyse alır, yetersizde insufficient_veri
--   select unlock_signal('sig_victory'); -- already_owned (starter)
--   select set_signal_deck(array['sig_victory','sig_shock']); -- OK
--   select set_signal_deck(array['sig_fire']); -- not_owned (alınmadıysa)
--   update public.profiles set veri = 9999 where id = auth.uid(); -- permission denied
