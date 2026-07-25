-- ═══════════════════════════════════════════════════════════════════════════
-- Gizem Çağı — KALE kelimesi değiştirme kuralı
-- ═══════════════════════════════════════════════════════════════════════════
-- Yeni kural (yalnız KALELER; kuleler eski "her an 40 Veri" davranışında kalır):
--   • İlk fetih → ücretsiz belirleme (age_set_code, değişmez).
--   • Sahip kelimeyi İSTEDİĞİ AN değiştiremez (Veri ödese bile).
--   • Yalnızca kalede BAŞARISIZ (kuşatmalı, 'open') bir saldırı varken VE aktif
--     saldırı YOKken değiştirebilir; yine 60 Veri. (Başarısız = süre dolması /
--     abandon / modal kapatma / savunmaya koşma / hedef değiştirme — hepsi zaten
--     saldırıyı 'active'→'open' yapıp kuşatmayı korur.)
--   • Değiştirince kuşatmalar sıfırlanır → kilit yeniden kapanır (yeni bir
--     başarısız saldırıya kadar tekrar değiştirilemez).
-- Ayrıca age_get_state her kaleye `can_change_word` bayrağı ekler (istemci butonu).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── age_refresh_code: KALE için kilit (kule aynı kalır) ─────────────────────
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

  -- KALE kilidi: aktif saldırı varken değiştirilemez; ayrıca en az bir kuşatmalı
  -- başarısız ('open' + tahminli) saldırı olmalı. (Kuleler bu kuraldan muaf.)
  if t.kind = 'castle' then
    if exists (select 1 from age_attacks where territory_id = t.id and status = 'active') then
      raise exception 'under_attack';
    end if;
    if not exists (
      select 1 from age_attacks a
       where a.territory_id = t.id and a.status = 'open'
         and exists (select 1 from age_attack_guesses g where g.attack_id = a.id)
    ) then
      raise exception 'no_failed_attack';
    end if;
  end if;

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
  -- (Kalede kilit gereği aktif saldırı zaten yok; kuşatmalar temizlenince kilit
  --  yeniden kapanır — yeni başarısız saldırıya dek tekrar değiştirilemez.)
  delete from age_attack_guesses g using age_attacks aa
   where g.attack_id = aa.id and aa.territory_id = t.id;
  update age_attacks set status = 'open', deadline = null, fog_remaining = 0, thief_remaining = 0
   where territory_id = t.id and status in ('open', 'active');

  return jsonb_build_object('status', 'refreshed', 'veri', v_veri);
end;
$$;
revoke execute on function public.age_refresh_code(uuid, text) from public, anon;
grant execute on function public.age_refresh_code(uuid, text) to authenticated;

-- ─── age_get_state: her kaleye can_change_word bayrağı (20260725000002 + ek) ─
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

  -- Toprak: kale savunmasızsa (word null) 'defended'=false. can_change_word: sahip
  -- kaleyi ancak kuşatmalı başarısız ('open'+tahminli) saldırı varken VE aktif
  -- saldırı yokken değiştirebilir (istemci "Kelimeyi Değiştir" butonu bununla açılır).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'kind', t.kind, 'slot_index', t.slot_index, 'castle_id', t.castle_id,
           'level', t.level, 'owner', t.owner, 'conquer_count', t.conquer_count,
           'code_deadline', t.code_deadline,
           'defended', case when t.kind = 'castle'
                            then (select s.word is not null from age_secrets s where s.territory_id = t.id)
                            else true end,
           'can_change_word', (
             t.kind = 'castle' and t.owner = uid
             and not exists (select 1 from age_attacks aa where aa.territory_id = t.id and aa.status = 'active')
             and exists (select 1 from age_attacks aa
                          where aa.territory_id = t.id and aa.status = 'open'
                            and exists (select 1 from age_attack_guesses g where g.attack_id = aa.id))
           )
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
           'word_length', t.level,
           'guess_count', (select count(*) from age_attack_guesses g where g.attack_id = a.id),
           'last_marks_summary', (
             select case when g.marks is null then null
               else jsonb_build_object(
                 'green', char_length(g.marks) - char_length(replace(g.marks, 'G', '')),
                 'yellow', char_length(g.marks) - char_length(replace(g.marks, 'Y', ''))) end
             from age_attack_guesses g where g.attack_id = a.id order by g.id desc limit 1),
           'best_marks_summary', (
             select jsonb_build_object('green', b.gr, 'yellow', b.yl)
             from (
               select char_length(g.marks) - char_length(replace(g.marks, 'G', '')) as gr,
                      char_length(g.marks) - char_length(replace(g.marks, 'Y', '')) as yl
               from age_attack_guesses g
               where g.attack_id = a.id and g.marks is not null
               order by gr desc, yl desc
               limit 1
             ) b)
         )), '[]'::jsonb)
    into v_incoming from age_attacks a join age_territories t on t.id = a.territory_id
   where a.match_id = m.id and t.owner = uid and a.attacker <> uid and a.status = 'active';

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
