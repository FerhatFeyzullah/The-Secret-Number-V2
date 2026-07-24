-- ══════════════════════════════════════════════════════════════════════════
-- GİZEM ÇAĞI · v2 — kural revizyonu (kullanıcı istişaresi sonrası)
--
-- Değişiklikler:
--  • Süreler: hazırlık 5 dk · savaş 10 dk. Hazırlıkta atakların AYRI süresi YOK
--    (tek prep saati). Savaşta atak süresi: kule 90 sn, kale 120 sn (düz).
--  • Savaş sonu: son 10 sn'de YENİ saldırı başlatılamaz; başlamış olanlar bitene
--    kadar maç beklenir; sonra puanla biter.
--  • Harita: her kalede 3 kule (5 kale + 15 kule = 20 parça).
--  • Kapı: saldıran o kalenin EN AZ BİR kulesine sahip olmalı.
--  • Eşzamanlılık: hazırlıkta bir hedefe herkes saldırabilir (yarış); savaşta bir
--    hedefe aynı anda TEK aktif saldırgan.
--  • Savunma: hak = 1 (kale) + sahip olunan kule sayısı. Her hakta botun sayısını
--    çöz → dezavantaj seç: Süre −15sn (ücretsiz) / Sis (Veri) / Zaman Hırsızı (Veri).
--    Dezavantaj yalnız sayı çözülünce uygulanır. (Lanetli Harf kaldırıldı.)
--  • Kule/Kale şifre yenileme: sahip Veri ödeyip şifreyi yeniler → saldırganın
--    biriken tahtası sıfırlanır.
--  • Fetih sonrası şifre: kule → 30 sn'de girilmezse random. Kale → 30 sn'de
--    kelime girilmezse SAVUNMASIZ (word null) → ilk uygun saldırgan tek hamlede kapar.
--  • Puanlama: kule = 2 puan, kale = harf × 5 (4h=20/5h=25/6h=30). Maç sonu TOPLAM
--    puan kazananı belirler; toprağın yoksa 0 puan.
-- ══════════════════════════════════════════════════════════════════════════

-- ─── Sabitler v2 ────────────────────────────────────────────────────────────
create or replace function public._age_const(p_key text)
returns int
language sql
immutable
as $$
  select case p_key
    when 'prep_ms'            then 300000  -- hazırlık 5 dk (tek saat)
    when 'war_ms'             then 600000  -- savaş 10 dk
    when 'war_tower_try'      then 90000   -- savaş: kule deneme 1.5 dk
    when 'war_castle_try'     then 120000  -- savaş: kale deneme 2 dk
    when 'war_lock_ms'        then 10000   -- savaş sonu son 10 sn: yeni saldırı yok
    when 'defense_time_cut'   then 15000   -- savunma çözümü → saldırana -15 sn
    when 'thief_penalty_ms'   then 1000    -- zaman hırsızı: yanlışta her gri hane -1sn
    when 'fog_turns'          then 3       -- sis kaç tahmin maskeler
    when 'thief_turns'        then 3       -- zaman hırsızı kaç tahmin sürer
    when 'cost_fog'           then 50      -- Sis (Veri)
    when 'cost_thief'         then 60      -- Zaman Hırsızı (Veri)
    when 'cost_refresh_tower' then 40      -- kule şifre yenileme (Veri)
    when 'cost_refresh_castle' then 60     -- kale şifre yenileme (Veri)
    when 'set_code_ms'        then 30000   -- fetih sonrası şifre penceresi
    else null
  end;
$$;

-- ─── age_attacks: zaman hırsızı bayrağı ─────────────────────────────────────
alter table public.age_attacks add column if not exists thief_remaining int not null default 0;

-- ─── Harita seed'i: 5 kale × 3 kule ─────────────────────────────────────────
create or replace function public._age_seed_map(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  castle_levels int[] := array[4, 4, 5, 5, 6];
  i int; cid uuid; tid uuid; j int;
begin
  for i in 1..5 loop
    insert into age_territories (match_id, kind, slot_index, level)
    values (p_match_id, 'castle', i - 1, castle_levels[i])
    returning id into cid;
    insert into age_secrets (territory_id, word) values (cid, _age_rand_word(castle_levels[i]));
    for j in 1..3 loop
      insert into age_territories (match_id, kind, slot_index, castle_id, level)
      values (p_match_id, 'tower', 100 + (i - 1) * 10 + j, cid, 0)
      returning id into tid;
      insert into age_secrets (territory_id, digits) values (tid, _age_rand_number());
    end loop;
  end loop;
end;
$$;
revoke execute on function public._age_seed_map(uuid) from public, anon, authenticated;

-- ─── Kapı: saldıran kalenin EN AZ BİR kulesine sahip mi ─────────────────────
create or replace function public._age_gate_open(p_castle_id uuid, p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from age_territories
     where castle_id = p_castle_id and kind = 'tower' and owner = p_player
  );
$$;
revoke execute on function public._age_gate_open(uuid, uuid) from public, anon, authenticated;

-- ─── Yardımcı: kalenin çağıranda olan kule sayısı (savunma hakkı) ───────────
create or replace function public._age_owned_towers(p_castle_id uuid, p_player uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from age_territories
   where castle_id = p_castle_id and kind = 'tower' and owner = p_player;
$$;
revoke execute on function public._age_owned_towers(uuid, uuid) from public, anon, authenticated;

-- ─── age_start_attack v2 ────────────────────────────────────────────────────
create or replace function public.age_start_attack(p_territory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.age_territories;
  m public.age_matches;
  a public.age_attacks;
  try_ms int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into t from age_territories where id = p_territory_id;
  if not found then raise exception 'territory_not_found'; end if;
  select * into m from age_matches where id = t.match_id;
  if uid not in (m.player1, m.player2, m.player3) then raise exception 'not_a_player'; end if;
  if m.phase not in ('prep', 'war') then raise exception 'wrong_phase'; end if;
  if exists (select 1 from age_players where match_id = m.id and player = uid and eliminated_at is not null) then
    raise exception 'eliminated';
  end if;
  if t.owner = uid then raise exception 'already_yours'; end if;
  if m.phase = 'prep' and t.owner is not null then raise exception 'already_conquered'; end if;

  -- Savaş sonu kilidi: son 10 sn'de yeni saldırı başlatılamaz.
  if m.phase = 'war' and m.war_ends_at is not null
     and now() > m.war_ends_at - (_age_const('war_lock_ms') || ' milliseconds')::interval then
    raise exception 'war_ending';
  end if;

  -- Kale kapısı: en az bir kule sende.
  if t.kind = 'castle' and not public._age_gate_open(t.id, uid) then
    raise exception 'gate_closed';
  end if;

  -- Savaşta tek aktif saldırgan: başka oyuncunun aktif saldırısı varsa reddet.
  if m.phase = 'war' and exists (
    select 1 from age_attacks
     where territory_id = t.id and attacker <> uid and status = 'active'
  ) then
    raise exception 'target_busy';
  end if;

  -- Kendi diğer aktif saldırılarını pasifle (oyuncu başına tek odak).
  update age_attacks set status = 'open', deadline = null
   where match_id = m.id and attacker = uid and status = 'active' and territory_id <> p_territory_id;

  -- Deneme süresi: prep → süresiz (deadline null); savaş → kule 90 / kale 120.
  try_ms := case
    when m.phase = 'prep' then null
    when t.kind = 'tower' then _age_const('war_tower_try')
    else _age_const('war_castle_try')
  end;

  select * into a from age_attacks where attacker = uid and territory_id = p_territory_id;
  if found then
    update age_attacks
       set status = 'active', kind = t.kind,
           deadline = case when try_ms is null then null else now() + (try_ms || ' milliseconds')::interval end
     where id = a.id returning * into a;
  else
    insert into age_attacks (match_id, attacker, territory_id, kind, status, deadline)
    values (m.id, uid, p_territory_id, t.kind, 'active',
            case when try_ms is null then null else now() + (try_ms || ' milliseconds')::interval end)
    returning * into a;
  end if;

  return jsonb_build_object('attack_id', a.id, 'deadline', a.deadline,
    'kind', t.kind, 'level', t.level, 'target_owner', t.owner);
end;
$$;
revoke execute on function public.age_start_attack(uuid) from public, anon;
grant execute on function public.age_start_attack(uuid) to authenticated;

-- ─── age_attack_guess v2 ────────────────────────────────────────────────────
create or replace function public.age_attack_guess(p_territory_id uuid, p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.age_territories;
  m public.age_matches;
  a public.age_attacks;
  s public.age_secrets;
  secret_val text;
  feedback text;
  real_marks text;
  disp_marks text;
  hits int;
  gray int;
  remaining int;
  code_ms int;
  v_win boolean := false;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into a from age_attacks where attacker = uid and territory_id = p_territory_id;
  if not found then raise exception 'no_active_attack'; end if;
  select * into t from age_territories where id = p_territory_id;
  select * into m from age_matches where id = t.match_id;
  if m.phase not in ('prep', 'war') then raise exception 'wrong_phase'; end if;

  if t.owner = uid then raise exception 'already_yours'; end if;
  if t.owner is not null and m.phase = 'prep' then
    update age_attacks set status = 'lost' where id = a.id;
    return jsonb_build_object('status', 'lost_race');
  end if;
  if a.status <> 'active' then raise exception 'no_active_attack'; end if;

  -- Süre (yalnız savaşta; prep'te deadline null).
  if a.deadline is not null and now() > a.deadline then
    update age_attacks set status = 'open', deadline = null where id = a.id;
    return jsonb_build_object('status', 'expired');
  end if;

  select * into s from age_secrets where territory_id = t.id;

  -- SAVUNMASIZ KALE (kelime girilmemiş, word null) → tek hamlede fetih.
  if t.kind = 'castle' and s.word is null then
    v_win := true; real_marks := repeat('G', greatest(t.level, 1));
  else
    secret_val := coalesce(s.digits, s.word);
    if not public._age_valid_guess(t.kind, t.level, p_guess) then
      raise exception 'invalid_guess';
    end if;
    if p_guess = secret_val then
      v_win := true;
      real_marks := case when t.kind = 'tower' then null else repeat('G', t.level) end;
    end if;
  end if;

  if v_win then
    insert into age_attack_guesses (attack_id, guess, feedback, marks)
    values (a.id, coalesce(p_guess, ''), 'win', real_marks);
    code_ms := _age_const('set_code_ms');
    update age_territories
       set owner = uid, conquer_count = conquer_count + 1,
           code_deadline = now() + (code_ms || ' milliseconds')::interval
     where id = t.id;
    -- Fetih sonrası şifre: kule → random; KALE → null (savunmasız, oyuncu girene dek).
    if t.kind = 'tower' then
      update age_secrets set digits = _age_rand_number(), word = null where territory_id = t.id;
    else
      update age_secrets set word = null, digits = null where territory_id = t.id;
    end if;
    -- Bu saldırı kazandı; aynı hedefe diğer saldırılar/savunmalar kapanır.
    update age_attacks set status = 'won' where id = a.id;
    update age_attacks set status = 'lost'
     where territory_id = t.id and attacker <> uid and status in ('open', 'active');
    delete from age_attack_guesses g using age_attacks aa
     where g.attack_id = aa.id and aa.territory_id = t.id and aa.attacker <> uid;
    delete from age_defenses d using age_attacks aa
     where d.attack_id = aa.id and aa.territory_id = t.id;
    if m.phase = 'war' then perform public._age_eliminate_check(m.id); end if;
    return jsonb_build_object('status', 'conquered', 'territory_id', t.id,
      'code_deadline', now() + (code_ms || ' milliseconds')::interval, 'kind', t.kind, 'level', t.level);
  end if;

  -- ── YANLIŞ: değerlendirme + sabotaj ──
  if t.kind = 'tower' then
    feedback := _evaluate_guess_number(secret_val, p_guess);
    real_marks := null; disp_marks := null;
    hits := case when feedback = 'digits_correct_wrong_order' then 3
                 when feedback like 'partial:%' then split_part(feedback, ':', 2)::int else 0 end;
    gray := 3 - hits;
  else
    real_marks := _word_marks(secret_val, p_guess);
    feedback := 'miss';
    hits := char_length(real_marks) - char_length(replace(real_marks, 'G', ''));
    gray := char_length(real_marks) - char_length(replace(real_marks, 'X', ''));
    if a.fog_remaining > 0 then
      disp_marks := translate(real_marks, 'GY', 'PP');
      update age_attacks set fog_remaining = fog_remaining - 1 where id = a.id;
    else
      disp_marks := real_marks;
    end if;
  end if;

  -- Zaman Hırsızı: aktifse yanlışta her gri hane -1sn (yalnız savaşta deadline var).
  if a.thief_remaining > 0 and a.deadline is not null and gray > 0 then
    update age_attacks
       set deadline = deadline - (_age_const('thief_penalty_ms') * gray || ' milliseconds')::interval,
           thief_remaining = thief_remaining - 1
     where id = a.id;
  elsif a.thief_remaining > 0 then
    update age_attacks set thief_remaining = thief_remaining - 1 where id = a.id;
  end if;

  insert into age_attack_guesses (attack_id, guess, feedback, marks)
  values (a.id, p_guess, feedback, real_marks);

  if m.phase = 'prep' then
    update age_players set prep_accuracy = prep_accuracy + hits where match_id = m.id and player = uid;
  end if;

  select case when deadline is null then 0
              else greatest(0, extract(epoch from (deadline - now()))::int * 1000) end
    into remaining from age_attacks where id = a.id;
  return jsonb_build_object('status', 'continue', 'feedback', feedback,
    'marks', disp_marks, 'remaining_ms', coalesce(remaining, 0));
end;
$$;
revoke execute on function public.age_attack_guess(uuid, text) from public, anon;
grant execute on function public.age_attack_guess(uuid, text) to authenticated;

-- ─── age_refresh_code: sahip Veri ödeyip şifreyi yeniler (kuşatmayı sıfırlar) ─
create or replace function public.age_refresh_code(p_territory_id uuid, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.age_territories;
  me public.profiles;
  cost int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into t from age_territories where id = p_territory_id;
  if not found then raise exception 'territory_not_found'; end if;
  if t.owner <> uid then raise exception 'not_owner'; end if;

  cost := case when t.kind = 'tower' then _age_const('cost_refresh_tower')
               else _age_const('cost_refresh_castle') end;
  select * into me from profiles where id = uid for update;
  if me.veri < cost then raise exception 'insufficient_veri'; end if;
  update profiles set veri = veri - cost where id = uid;

  -- Yeni şifre: kule → verilen/rasgele sayı; kale → verilen kelime ZORUNLU.
  if t.kind = 'tower' then
    if p_code is not null and public._age_valid_guess('tower', 0, p_code) then
      update age_secrets set digits = p_code, word = null where territory_id = t.id;
    else
      update age_secrets set digits = _age_rand_number(), word = null where territory_id = t.id;
    end if;
  else
    if p_code is null or not public._age_valid_guess('castle', t.level, p_code) then
      raise exception 'invalid_code';
    end if;
    update age_secrets set word = p_code, digits = null where territory_id = t.id;
  end if;

  -- Saldırganların biriken tahtası sıfırlanır; aktif saldırılar 'open'a düşer.
  delete from age_attack_guesses g using age_attacks aa
   where g.attack_id = aa.id and aa.territory_id = t.id;
  update age_attacks set status = 'open', deadline = null, fog_remaining = 0, thief_remaining = 0
   where territory_id = t.id and status in ('open', 'active');

  return jsonb_build_object('status', 'refreshed', 'veri', me.veri - cost);
end;
$$;
revoke execute on function public.age_refresh_code(uuid, text) from public, anon;
grant execute on function public.age_refresh_code(uuid, text) to authenticated;

-- ─── age_start_defense v2: hak = 1 (kale) + sahip olunan kule sayısı ────────
create or replace function public.age_start_defense(p_attack_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  a public.age_attacks;
  t public.age_territories;
  m public.age_matches;
  d public.age_defenses;
  slots int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into a from age_attacks where id = p_attack_id;
  if not found then raise exception 'attack_not_found'; end if;
  select * into t from age_territories where id = a.territory_id;
  if t.owner <> uid then raise exception 'not_your_territory'; end if;
  if t.kind <> 'castle' then raise exception 'only_castle_defense'; end if;
  select * into m from age_matches where id = a.match_id;
  if m.phase <> 'war' then raise exception 'wrong_phase'; end if;
  if a.status <> 'active' then raise exception 'attack_not_active'; end if;

  slots := 1 + public._age_owned_towers(t.id, uid);

  update age_attacks set status = 'open', deadline = null
   where match_id = m.id and attacker = uid and status = 'active';  -- feda: kendi saldırın düşer

  select * into d from age_defenses where attack_id = p_attack_id;
  if not found then
    insert into age_defenses (attack_id, defender, secret_digits, deadline)
    values (p_attack_id, uid, _age_rand_number(), now() + interval '90 seconds')
    returning * into d;
  end if;

  return jsonb_build_object('defense_id', d.id, 'solved_count', d.solved_count, 'slots', slots);
end;
$$;
revoke execute on function public.age_start_defense(uuid) from public, anon;
grant execute on function public.age_start_defense(uuid) to authenticated;

-- ─── age_defense_guess v2: çöz → dezavantaj seç (time/fog/thief) ────────────
create or replace function public.age_defense_guess(p_attack_id uuid, p_guess text, p_sabotage text default 'time')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  d public.age_defenses;
  a public.age_attacks;
  t public.age_territories;
  me public.profiles;
  slots int;
  cost int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into d from age_defenses where attack_id = p_attack_id;
  if not found then raise exception 'no_defense'; end if;
  if d.defender <> uid then raise exception 'not_defender'; end if;
  select * into a from age_attacks where id = p_attack_id;
  if a.status <> 'active' then return jsonb_build_object('status', 'attack_gone'); end if;
  select * into t from age_territories where id = a.territory_id;
  slots := 1 + public._age_owned_towers(t.id, uid);
  if d.solved_count >= slots then raise exception 'defense_slots_full'; end if;

  if not public._age_valid_guess('tower', 0, p_guess) then raise exception 'invalid_guess'; end if;

  if p_guess <> d.secret_digits then
    return jsonb_build_object('status', 'continue', 'feedback', _evaluate_guess_number(d.secret_digits, p_guess));
  end if;

  -- ÇÖZÜLDÜ → seçilen dezavantajı uygula.
  if p_sabotage = 'time' then
    update age_attacks
       set deadline = case when deadline is null then null
                           else deadline - (_age_const('defense_time_cut') || ' milliseconds')::interval end
     where id = p_attack_id;
  elsif p_sabotage = 'fog' then
    cost := _age_const('cost_fog');
    select * into me from profiles where id = uid for update;
    if me.veri < cost then raise exception 'insufficient_veri'; end if;
    update profiles set veri = veri - cost where id = uid;
    update age_attacks set fog_remaining = _age_const('fog_turns') where id = p_attack_id;
  elsif p_sabotage = 'thief' then
    cost := _age_const('cost_thief');
    select * into me from profiles where id = uid for update;
    if me.veri < cost then raise exception 'insufficient_veri'; end if;
    update profiles set veri = veri - cost where id = uid;
    update age_attacks set thief_remaining = _age_const('thief_turns') where id = p_attack_id;
  else
    raise exception 'unknown_sabotage';
  end if;

  update age_defenses
     set solved_count = solved_count + 1, secret_digits = _age_rand_number()
   where attack_id = p_attack_id
  returning * into d;

  return jsonb_build_object('status', 'solved', 'solved_count', d.solved_count, 'slots', slots,
    'veri', (select veri from profiles where id = uid));
end;
$$;
revoke execute on function public.age_defense_guess(uuid, text, text) from public, anon;
grant execute on function public.age_defense_guess(uuid, text, text) to authenticated;

-- ─── _age_finish v2: prestij puanıyla sıralama ──────────────────────────────
-- Puan: kule = 2 · kale = harf × 5. Toprağın yoksa 0. Ödül 1/2/3 → +25/+5/-15 kupa.
create or replace function public._age_finish(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rk jsonb := '[]'::jsonb; rec record; rnk int := 0; v_kupa int; v_veri int;
begin
  if (select phase from age_matches where id = p_match_id) = 'finished' then return; end if;

  for rec in
    select p.player, p.eliminated_at,
           coalesce((select sum(case when t.kind = 'castle' then t.level * 5 else 2 end)
                       from age_territories t
                      where t.match_id = p.match_id and t.owner = p.player), 0) as points
      from age_players p
     where p.match_id = p_match_id
     order by points desc, (p.eliminated_at is null) desc, p.eliminated_at desc nulls last,
              p.prep_accuracy desc
  loop
    rnk := rnk + 1;
    v_kupa := case rnk when 1 then 25 when 2 then 5 else -15 end;
    v_veri := case rnk when 1 then 60 when 2 then 20 else 0 end;
    update profiles set rating = greatest(0, rating + v_kupa), veri = greatest(0, veri + v_veri)
     where id = rec.player;
    rk := rk || jsonb_build_object('player', rec.player, 'rank', rnk,
                                   'points', rec.points, 'kupa_delta', v_kupa, 'veri_delta', v_veri);
  end loop;
  update age_matches set phase = 'finished', ranking = rk, war_ends_at = null
   where id = p_match_id and phase <> 'finished';
end;
$$;
revoke execute on function public._age_finish(uuid) from public, anon, authenticated;

-- ─── age_claim_phase v2: savaş sonu — devam eden ataklar bitene dek bekle ───
create or replace function public.age_claim_phase(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.age_matches; bot_left int; alive int; active_left int;
begin
  select * into m from age_matches where id = p_match_id for update;
  if not found then raise exception 'match_not_found'; end if;
  if auth.uid() not in (m.player1, m.player2, m.player3) then raise exception 'not_a_player'; end if;

  if m.phase = 'prep' then
    select count(*) into bot_left from age_territories where match_id = m.id and owner is null;
    if now() > m.prep_ends_at or bot_left = 0 then
      update age_players p set eliminated_at = now()
       where p.match_id = m.id and p.eliminated_at is null
         and public._age_territory_count(m.id, p.player) = 0;
      select count(*) into alive from age_players where match_id = m.id and eliminated_at is null;
      if alive <= 1 then perform public._age_finish(m.id);
      else update age_matches set phase = 'war',
                  war_ends_at = now() + (_age_const('war_ms') || ' milliseconds')::interval
             where id = m.id;
      end if;
    end if;
  elsif m.phase = 'war' then
    if now() > m.war_ends_at then
      -- Devam eden aktif saldırı varsa bekle; yoksa puanla bitir.
      select count(*) into active_left from age_attacks where match_id = m.id and status = 'active';
      if active_left = 0 then perform public._age_finish(m.id); end if;
    end if;
  end if;
end;
$$;
revoke execute on function public.age_claim_phase(uuid) from public, anon;
grant execute on function public.age_claim_phase(uuid) to authenticated;

-- ─── age_get_state v2: savunmasızlık + herkesin aktif saldırıları + zaman hırsızı ─
create or replace function public.age_get_state(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.age_matches;
  v_players jsonb; v_terr jsonb; v_attacks jsonb; v_incoming jsonb; v_public jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into m from age_matches where id = p_match_id;
  if not found then raise exception 'match_not_found'; end if;
  if uid not in (m.player1, m.player2, m.player3) then raise exception 'not_a_player'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'player', p.player, 'slot', p.slot, 'username', pr.username,
           'eliminated', p.eliminated_at is not null,
           'territories', public._age_territory_count(m.id, p.player)
         ) order by p.slot), '[]'::jsonb)
    into v_players from age_players p left join profiles pr on pr.id = p.player where p.match_id = m.id;

  -- Toprak: kale savunmasızsa (word null) 'defended'=false (savunmasız kale info'su).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'kind', t.kind, 'slot_index', t.slot_index, 'castle_id', t.castle_id,
           'level', t.level, 'owner', t.owner, 'conquer_count', t.conquer_count,
           'code_deadline', t.code_deadline,
           'defended', case when t.kind = 'castle'
                            then (select s.word is not null from age_secrets s where s.territory_id = t.id)
                            else true end
         ) order by t.slot_index), '[]'::jsonb)
    into v_terr from age_territories t where t.match_id = m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'territory_id', a.territory_id, 'kind', a.kind, 'status', a.status,
           'deadline', a.deadline, 'fog_remaining', a.fog_remaining, 'thief_remaining', a.thief_remaining,
           'guesses', (select coalesce(jsonb_agg(jsonb_build_object(
                          'guess', g.guess, 'feedback', g.feedback, 'marks', g.marks) order by g.id), '[]'::jsonb)
                       from age_attack_guesses g where g.attack_id = a.id)
         )), '[]'::jsonb)
    into v_attacks from age_attacks a
   where a.match_id = m.id and a.attacker = uid and a.status in ('open', 'active');

  select coalesce(jsonb_agg(jsonb_build_object(
           'attack_id', a.id, 'territory_id', a.territory_id, 'attacker', a.attacker,
           'guess_count', (select count(*) from age_attack_guesses g where g.attack_id = a.id),
           'last_marks_summary', (
             select case when g.marks is null then null
               else jsonb_build_object(
                 'green', char_length(g.marks) - char_length(replace(g.marks, 'G', '')),
                 'yellow', char_length(g.marks) - char_length(replace(g.marks, 'Y', ''))) end
             from age_attack_guesses g where g.attack_id = a.id order by g.id desc limit 1)
         )), '[]'::jsonb)
    into v_incoming from age_attacks a join age_territories t on t.id = a.territory_id
   where a.match_id = m.id and t.owner = uid and a.attacker <> uid and a.status = 'active';

  -- Herkesin aktif saldırıları (harita işareti — kim nereye): sadece hedef + saldıran.
  select coalesce(jsonb_agg(jsonb_build_object(
           'territory_id', a.territory_id, 'attacker', a.attacker)), '[]'::jsonb)
    into v_public from age_attacks a where a.match_id = m.id and a.status = 'active';

  return jsonb_build_object(
    'match_id', m.id, 'phase', m.phase,
    'prep_ends_at', m.prep_ends_at, 'war_ends_at', m.war_ends_at, 'ranking', m.ranking, 'me', uid,
    'players', v_players, 'territories', v_terr,
    'my_attacks', v_attacks, 'incoming', v_incoming, 'attacks_public', v_public);
end;
$$;
revoke execute on function public.age_get_state(uuid) from public, anon;
grant execute on function public.age_get_state(uuid) to authenticated;

notify pgrst, 'reload schema';
