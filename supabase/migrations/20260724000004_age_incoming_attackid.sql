-- ══════════════════════════════════════════════════════════════════════════
-- GİZEM ÇAĞI · Ek: age_get_state.incoming → attack_id ekle
--
-- Savunmaya koşmak (age_start_defense) attack_id ister; savunan saldırının
-- id'sini bilmeli. incoming raporuna attack_id eklenir (age_attacks tüm maç
-- oyuncularına okunur → sızıntı değil, yalnız kolaylık). Diğer her şey aynı.
-- ══════════════════════════════════════════════════════════════════════════
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
  v_players jsonb;
  v_terr jsonb;
  v_attacks jsonb;
  v_incoming jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into m from age_matches where id = p_match_id;
  if not found then raise exception 'match_not_found'; end if;
  if uid not in (m.player1, m.player2, m.player3) then raise exception 'not_a_player'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'player', p.player, 'slot', p.slot,
           'username', pr.username,
           'eliminated', p.eliminated_at is not null,
           'territories', public._age_territory_count(m.id, p.player)
         ) order by p.slot), '[]'::jsonb)
    into v_players
    from age_players p left join profiles pr on pr.id = p.player
   where p.match_id = m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'kind', t.kind, 'slot_index', t.slot_index,
           'castle_id', t.castle_id, 'level', t.level, 'owner', t.owner,
           'conquer_count', t.conquer_count,
           'code_deadline', t.code_deadline
         ) order by t.slot_index), '[]'::jsonb)
    into v_terr
    from age_territories t where t.match_id = m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'territory_id', a.territory_id, 'kind', a.kind, 'status', a.status,
           'deadline', a.deadline, 'fog_remaining', a.fog_remaining,
           'cursed_letters', to_jsonb(a.cursed_letters),
           'guesses', (select coalesce(jsonb_agg(jsonb_build_object(
                          'guess', g.guess, 'feedback', g.feedback, 'marks', g.marks
                        ) order by g.id), '[]'::jsonb)
                       from age_attack_guesses g where g.attack_id = a.id)
         )), '[]'::jsonb)
    into v_attacks
    from age_attacks a
   where a.match_id = m.id and a.attacker = uid and a.status in ('open', 'active');

  select coalesce(jsonb_agg(jsonb_build_object(
           'attack_id', a.id,                       -- ★ EKLENDİ (savunma için)
           'territory_id', a.territory_id, 'attacker', a.attacker,
           'guess_count', (select count(*) from age_attack_guesses g where g.attack_id = a.id),
           'last_marks_summary', (
             select case when g.marks is null then null
               else jsonb_build_object(
                 'green', char_length(g.marks) - char_length(replace(g.marks, 'G', '')),
                 'yellow', char_length(g.marks) - char_length(replace(g.marks, 'Y', '')))
             end
             from age_attack_guesses g where g.attack_id = a.id order by g.id desc limit 1)
         )), '[]'::jsonb)
    into v_incoming
    from age_attacks a
    join age_territories t on t.id = a.territory_id
   where a.match_id = m.id and t.owner = uid and a.attacker <> uid and a.status = 'active';

  return jsonb_build_object(
    'match_id', m.id, 'phase', m.phase,
    'prep_ends_at', m.prep_ends_at, 'war_ends_at', m.war_ends_at,
    'ranking', m.ranking,
    'me', uid,
    'players', v_players, 'territories', v_terr,
    'my_attacks', v_attacks, 'incoming', v_incoming);
end;
$$;
revoke execute on function public.age_get_state(uuid) from public, anon;
grant execute on function public.age_get_state(uuid) to authenticated;

notify pgrst, 'reload schema';
