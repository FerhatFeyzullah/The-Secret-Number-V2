-- Gizem Çağı v3 — Maç‑içi kese ("Sefer Verisi").
-- Rekabetçi PvP simetrik olsun diye sabotaj/şifre‑yenileme artık oyuncunun
-- global profiles.veri'sinden DEĞİL, maça özel eşit başlayan bir keseden
-- (age_players.match_veri) düşer. Global Veri yalnız _age_finish ÖDÜLÜ olarak
-- akar (değişmedi). age_get_state kalan keseyi (my_veri) döner.
--
-- Değişen fonksiyonlar: age_defense_guess (fog/thief), age_refresh_code, age_get_state.

-- ─── Maç kesesi kolonu (herkes eşit; yeni age_players satırları 200 ile açılır) ─
alter table public.age_players add column if not exists match_veri int not null default 200;

-- ─── age_defense_guess v3: sabotaj ücreti maç kesesinden ────────────────────
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
  v_veri int;
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

  -- ÇÖZÜLDÜ → seçilen dezavantajı uygula. Ücret MAÇ KESESİNDEN (age_players.match_veri).
  if p_sabotage = 'time' then
    update age_attacks
       set deadline = case when deadline is null then null
                           else deadline - (_age_const('defense_time_cut') || ' milliseconds')::interval end
     where id = p_attack_id;
  elsif p_sabotage = 'fog' then
    cost := _age_const('cost_fog');
    select match_veri into v_veri from age_players where match_id = a.match_id and player = uid for update;
    if coalesce(v_veri, 0) < cost then raise exception 'insufficient_veri'; end if;
    update age_players set match_veri = match_veri - cost where match_id = a.match_id and player = uid;
    update age_attacks set fog_remaining = _age_const('fog_turns') where id = p_attack_id;
  elsif p_sabotage = 'thief' then
    cost := _age_const('cost_thief');
    select match_veri into v_veri from age_players where match_id = a.match_id and player = uid for update;
    if coalesce(v_veri, 0) < cost then raise exception 'insufficient_veri'; end if;
    update age_players set match_veri = match_veri - cost where match_id = a.match_id and player = uid;
    update age_attacks set thief_remaining = _age_const('thief_turns') where id = p_attack_id;
  else
    raise exception 'unknown_sabotage';
  end if;

  update age_defenses
     set solved_count = solved_count + 1, secret_digits = _age_rand_number()
   where attack_id = p_attack_id
  returning * into d;

  return jsonb_build_object('status', 'solved', 'solved_count', d.solved_count, 'slots', slots,
    'veri', (select match_veri from age_players where match_id = a.match_id and player = uid));
end;
$$;
revoke execute on function public.age_defense_guess(uuid, text, text) from public, anon;
grant execute on function public.age_defense_guess(uuid, text, text) to authenticated;

-- ─── age_refresh_code v3: yenileme ücreti maç kesesinden ────────────────────
create or replace function public.age_refresh_code(p_territory_id uuid, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.age_territories;
  v_veri int;
  cost int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into t from age_territories where id = p_territory_id;
  if not found then raise exception 'territory_not_found'; end if;
  if t.owner <> uid then raise exception 'not_owner'; end if;

  cost := case when t.kind = 'tower' then _age_const('cost_refresh_tower')
               else _age_const('cost_refresh_castle') end;
  select match_veri into v_veri from age_players where match_id = t.match_id and player = uid for update;
  if coalesce(v_veri, 0) < cost then raise exception 'insufficient_veri'; end if;
  update age_players set match_veri = match_veri - cost where match_id = t.match_id and player = uid
    returning match_veri into v_veri;

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

  return jsonb_build_object('status', 'refreshed', 'veri', v_veri);
end;
$$;
revoke execute on function public.age_refresh_code(uuid, text) from public, anon;
grant execute on function public.age_refresh_code(uuid, text) to authenticated;

-- ─── age_get_state v3: my_veri (çağıranın kalan maç kesesi) eklenir ─────────
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
  v_veri int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into m from age_matches where id = p_match_id;
  if not found then raise exception 'match_not_found'; end if;
  if uid not in (m.player1, m.player2, m.player3) then raise exception 'not_a_player'; end if;

  select match_veri into v_veri from age_players where match_id = m.id and player = uid;

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
    'my_veri', coalesce(v_veri, 0),
    'players', v_players, 'territories', v_terr,
    'my_attacks', v_attacks, 'incoming', v_incoming, 'attacks_public', v_public);
end;
$$;
revoke execute on function public.age_get_state(uuid) from public, anon;
grant execute on function public.age_get_state(uuid) to authenticated;

notify pgrst, 'reload schema';
