-- ════════════════════════════════════════════════════════════════════════════
-- Lig sistemi: rating → lig türetimi + haftalık sezon (yumuşak kupa çekme).
-- Lig AYRI KOLON DEĞİL — rating'ten türetilir. Sınırlar src/leagues/catalog.ts
-- ile BİREBİR: Bronz <1200 · Gümüş 1200–1449 · Altın 1450–1749 · Platin
-- 1750–2099 · Elmas 2100–2499 · Usta 2500–2999 · Efsane ≥3000.
-- Idempotent (create or replace / if not exists).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Kupa → lig anahtarı (immutable; matchmaking + get_my_rank kullanır).
create or replace function public._league_key(p_rating int)
returns text
language sql
immutable
as $$
  select case
    when p_rating >= 3000 then 'legend'
    when p_rating >= 2500 then 'master'
    when p_rating >= 2100 then 'diamond'
    when p_rating >= 1750 then 'platinum'
    when p_rating >= 1450 then 'gold'
    when p_rating >= 1200 then 'silver'
    else 'bronze'
  end;
$$;

-- 2) Kupa → ligin [lo, hi] bandı (eşleşme filtresi için; lig-içi = aynı band).
--    Efsane üst sınırı pratikte sınırsız (int max).
create or replace function public._league_bounds(p_rating int, out lo int, out hi int)
language sql
immutable
as $$
  select
    case
      when p_rating >= 3000 then 3000
      when p_rating >= 2500 then 2500
      when p_rating >= 2100 then 2100
      when p_rating >= 1750 then 1750
      when p_rating >= 1450 then 1450
      when p_rating >= 1200 then 1200
      else 0
    end,
    case
      when p_rating >= 3000 then 2147483647
      when p_rating >= 2500 then 2999
      when p_rating >= 2100 then 2499
      when p_rating >= 1750 then 2099
      when p_rating >= 1450 then 1749
      when p_rating >= 1200 then 1449
      else 1199
    end;
$$;

-- 3) Sezonlar: her haftalık sıfırlama yeni bir satır açar. İstemci en yüksek
--    season_id'yi izler; değişince "yeni sezon" modalını bir kez gösterir.
create table if not exists public.seasons (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now()
);

-- İlk sezon (yoksa).
insert into public.seasons (started_at)
  select now() where not exists (select 1 from public.seasons);

-- seasons: İSTEMCİYE TAMAMEN KAPALI (secrets deseni). RLS açık + politika YOK =
-- anon/authenticated için SELECT/INSERT/UPDATE/DELETE hepsi RED → istemci sezon
-- satırını okuyamaz/yazamaz, sezonu manipüle edemez. Tablo owner'ı (postgres) ve
-- security-definer fonksiyonlar (reset_season / get_season_info / get_my_rank)
-- RLS'yi baypas eder → çalışmaya devam eder. enable RLS idempotent (zaten açıksa
-- no-op). Ek emniyet kemeri: tablo grant'leri de kaldırılır.
alter table public.seasons enable row level security;
revoke all on table public.seasons from anon, authenticated;

-- 4) Sezon bilgisi: güncel season_id + başlangıç + sonraki Pazartesi 00:00 UTC.
create or replace function public.get_season_info()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'season_id', (select id from seasons order by id desc limit 1),
    'started_at', (select started_at from seasons order by id desc limit 1),
    -- Bir sonraki haftalık sıfırlama: gelecek Pazartesi 00:00 UTC (cron ile aynı).
    'ends_at', ((date_trunc('week', (now() at time zone 'utc')) + interval '7 days')
                at time zone 'utc')
  );
$$;
revoke execute on function public.get_season_info() from public, anon;
grant execute on function public.get_season_info() to authenticated;

-- 5) Haftalık sezon sıfırlaması: YALNIZCA Kupa yumuşak çekilir — mesafenin
--    %70'i kalır (rating = 1000 + round((rating-1000)*0.7)). Seviye/XP/protokol/
--    sinyal/Veri ve streak DOKUNULMAZ. Yalnız cron çağırır (istemciye kapalı).
create or replace function public.reset_season()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
     set rating = greatest(0, 1000 + round((rating - 1000) * 0.7)::int)
   where rating <> 1000;
  insert into seasons (started_at) values (now());
end;
$$;
revoke execute on function public.reset_season() from public, anon, authenticated;

-- 6) get_my_rank: mevcut sürüm (20260607000014) + 'season_id'. İstemci yeni
--    sezonu bu alandan algılar. Gerisi AYNEN korunur.
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
    'signal_deck', to_jsonb(me.signal_deck),
    'season_id', (select id from seasons order by id desc limit 1));
end;
$$;

notify pgrst, 'reload schema';
