-- Online 1v1: profil istatistikleri — current_streak + genişletilmiş get_my_rank
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Bağlam: offline istatistikler istemciden kaldırılıyor; istatistik artık
-- YALNIZCA sunucudan (Hızlı Maç) gelir. Eksik olan galibiyet serisi
-- profiles.current_streak olarak eklenir ve _apply_rating içinde güncellenir:
--   * kazanan: current_streak + 1, kaybeden: 0
--   * _apply_rating yalnızca quick + finished + winner'lı maçlarda ve
--     rating_applied=false iken (maç satırı kilitliyken) çalıştığından seri
--     güncellemesi de puanla aynı idempotans/yarış garantisini bedavaya alır;
--     özel oda / iptal / abandon seriyi etkilemez.
--
-- get_my_rank ayrıca oynanan maç sayısını (played) döndürür. Dönüş jsonb
-- olduğundan yeni alanlar eski istemcileri kırmaz.

-- 1) Alan -------------------------------------------------------------------------

alter table public.profiles
  add column if not exists current_streak int not null default 0;

-- 2) _apply_rating: puan + seri tek yerde ------------------------------------------
-- (Migration 9'daki gövde korunarak yalnızca current_streak güncellemeleri eklendi.)

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

  update profiles
     set rating = greatest(0, rating + gain),
         current_streak = current_streak + 1
   where id = m.winner;
  update profiles
     set rating = greatest(0, rating + loss),
         current_streak = 0
   where id = loser;
  update matches set rating_applied = true where id = m.id;
end;
$$;

revoke execute on function public._apply_rating(public.matches)
  from public, anon, authenticated;

-- 3) get_my_rank: profil istatistik modalının tek veri kaynağı ----------------------
-- played: quick + finished + oyuncunun yer aldığı maçlar (status='finished'
-- olduğu için cancelled/abandoned doğal olarak HARİÇ). Başarı oranı istemcide
-- wins/played'den türetilir; ayrıca saklanmaz.

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
    'streak', me.current_streak);
end;
$$;

-- Grant'ler migration 9'da verildi; create or replace bunları korur.

-- 4) Doğrulama (panelde elle denenebilir) --------------------------------------------
--
--   -- Bir quick maç bitir; kazananın serisi +1, kaybedeninki 0 olmalı:
--   select username, rating, current_streak from public.profiles;
--
--   -- Modal verisi:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"USER_A"}';
--   select public.get_my_rank();
--   -- beklenen: {"rank":..,"username":..,"rating":..,"wins":..,"played":..,"streak":..}
--   reset role;
