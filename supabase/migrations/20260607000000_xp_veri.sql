-- Online 1v1: kalıcı ilerleme temeli — seviye (XP) + Veri parası
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Tasarım (Faz 1 / Adım 1 — yalnızca sayılar; protokol/ağaç sonraki fazlar):
--   * Kazanım YALNIZCA sunucuda, _apply_rating ile AYNI yolda ve AYNI
--     rating_applied guard'ıyla tam bir kez uygulanır:
--       kazanan: +70 Veri, +90 XP   |   kaybeden: +15 Veri, +25 XP
--     mode='private' ve offline guard'a zaten takılır → hiçbir şey kazandırmaz.
--   * Seviye 1-10; XP'den eşik tablosuyla hesaplanır (xp düşmez, level düşmez).
--     Eşikler (kümülatif XP): 0, 100, 240, 420, 640, 900, 1200, 1540, 1920, 2340
--     Artışlar aritmetik (+40): 100, 140, 180, ... 420.
--     %50 galibiyetle maç başına ort. (90+25)/2 = 57.5 XP → seviye 10 ≈ 41 maç
--     (%40-%65 galibiyet aralığında ≈ 35-46 maç). İnce ayar sonra.
--   * İstemci xp/level/veri YAZAMAZ: migration 9'daki kolon-bazlı grant zaten
--     yalnızca username'e izin veriyor; yeni kolonlar otomatik kapalı.

-- 1) Alanlar -----------------------------------------------------------------------

alter table public.profiles
  add column if not exists xp int not null default 0;

alter table public.profiles
  add column if not exists level int not null default 1;

alter table public.profiles
  add column if not exists veri int not null default 0;

-- 2) Seviye eğrisi -------------------------------------------------------------------
-- Eşikler tek yerde; _level_for_xp ve get_my_rank (ilerleme çubuğu) bunu kullanır.

create or replace function public._xp_thresholds()
returns int[]
language sql
immutable
as $$
  select array[0, 100, 240, 420, 640, 900, 1200, 1540, 1920, 2340];
$$;

-- XP → seviye: eşiği aşılmış en yüksek seviye (1-10 arası kalır).
create or replace function public._level_for_xp(p_xp int)
returns int
language sql
immutable
as $$
  select coalesce(max(i)::int, 1)
    from unnest(public._xp_thresholds()) with ordinality t(thr, i)
   where thr <= greatest(p_xp, 0);
$$;

revoke execute on function public._xp_thresholds() from public, anon, authenticated;
revoke execute on function public._level_for_xp(int) from public, anon, authenticated;

-- 3) _apply_rating: puan + seri + XP/Veri tek yerde ----------------------------------
-- (Migration 11'deki gövde korunarak yalnızca xp/veri/level güncellemeleri eklendi;
-- rating_applied guard'ı hepsini birden tam bir kez uygular.)

create or replace function public._apply_rating(m public.matches)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  loser uuid;
  r_w int;
  r_l int;
  gain int;
  loss int;
begin
  -- Yalnızca puanlı maçlar; rating_applied çifte uygulamayı keser.
  if m.mode <> 'quick' or m.status <> 'finished' or m.winner is null or m.rating_applied then
    return;
  end if;
  loser := case when m.winner = m.player1 then m.player2 else m.player1 end;
  if loser is null then
    return;
  end if;

  -- İki profil satırını DETERMİNİSTİK sırayla kilitle (deadlock önleme).
  perform 1 from profiles where id in (m.winner, loser) order by id for update;

  select rating into r_w from profiles where id = m.winner;
  select rating into r_l from profiles where id = loser;
  if r_w is null or r_l is null then
    return; -- profil satırı yoksa (teorik) puanlama atlanır
  end if;

  -- Kazanan açısından rakip−ben = kaybeden−kazanan; kaybeden açısından tersi.
  gain := least(50, greatest(15, round(30 + (r_l - r_w) / 25.0)::int));
  loss := least(-8, greatest(-40, round(-20 + (r_w - r_l) / 25.0)::int));

  -- UPDATE içindeki xp referansı eski değerdir; level yeni toplamdan hesaplanır.
  update profiles
     set rating = greatest(0, rating + gain),
         current_streak = current_streak + 1,
         xp = xp + 90,
         veri = veri + 70,
         level = _level_for_xp(xp + 90)
   where id = m.winner;
  update profiles
     set rating = greatest(0, rating + loss),
         current_streak = 0,
         xp = xp + 25,
         veri = veri + 15,
         level = _level_for_xp(xp + 25)
   where id = loser;
  update matches set rating_applied = true where id = m.id;
end;
$$;

revoke execute on function public._apply_rating(public.matches)
  from public, anon, authenticated;

-- 4) get_my_rank: + xp / level / veri / ilerleme eşikleri -----------------------------
-- level_floor = mevcut seviyenin alt eşiği, level_next = sonraki seviyenin eşiği
-- (maks seviyede null). İstemci ilerleme oranını
-- (xp - level_floor) / (level_next - level_floor) ile çizer. Dönüş jsonb
-- olduğundan yeni alanlar eski istemcileri kırmaz.

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
    end);
end;
$$;

-- Grant'ler migration 9'da verildi; create or replace bunları korur.

-- 5) Doğrulama (panelde elle denenebilir) --------------------------------------------
--
--   -- Bir quick maç bitir; kazanan +70 Veri +90 XP, kaybeden +15 Veri +25 XP:
--   select username, xp, level, veri from public.profiles;
--
--   -- Seviye eğrisi:
--   select public._level_for_xp(0), public._level_for_xp(99),
--          public._level_for_xp(100), public._level_for_xp(2340),
--          public._level_for_xp(99999);   -- beklenen: 1, 1, 2, 10, 10
--
--   -- Modal verisi (yeni alanlarla):
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"USER_A"}';
--   select public.get_my_rank();
--   -- beklenen: {..., "xp":.., "level":.., "veri":.., "level_floor":.., "level_next":..}
--
--   -- İstemci xp/level/veri yazamaz (kolon grant'i yok):
--   update public.profiles set veri = 9999 where id = auth.uid();
--                                   -- beklenen: permission denied
--   reset role;
