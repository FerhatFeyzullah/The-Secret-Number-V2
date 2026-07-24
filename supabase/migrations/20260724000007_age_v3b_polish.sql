-- Gizem Çağı v3b (test geri bildirimi düzeltmeleri — backend kısmı)
--
--   1) age_attack_guess: bir KALE'ye biçim olarak geçerli ama HAVUZDA olmayan
--      bir kelimeyle saldırınca artık `word_not_in_pool` hatası döner (istemci
--      "Bu kelime sözlükte yok." uyarısı gösterir). Eskiden genel `invalid_guess`
--      dönüyordu. Kule (sayı) davranışı değişmedi.
--
--   2) _age_finish: kupa ödülleri 1./2./3. → +60 / +40 / +15 (eskiden 25/5/-15).
--      Son sıra artık kupa KAYBETMEZ. Veri ödülü aynı (60/20/0). Ayrıca bitiş
--      anında "Son Maçlar" için age_match_history'ye 3 oyunculu özet yazar
--      (isim + kale/kule + puan + kupa/veri delta).
--
--   3) age_match_history + get_recent_age_matches: Gizem Çağı maçları da "Son
--      Maçlar" sekmesinde listelensin (match_history 1v1-özel olduğu için AYRI).
--
-- v2'deki fonksiyonların birebir kopyası + yalnız ilgili satırların değişimi.
-- age_defense_guess / age_refresh_code / age_get_state (v3, match_veri) DOKUNULMADI.

-- ─── age_match_history: bitmiş Gizem Çağı maçlarının kalıcı 3 oyunculu özeti ──
-- match_id UNIQUE ama FK DEĞİL → reap silmez. Rolling-30 (_age_finish içinde budanır).
create table if not exists public.age_match_history (
  id bigint generated always as identity primary key,
  match_id uuid not null unique,
  ended_at timestamptz not null default now(),
  -- [{name, rank, points, towers, castles, kupa_delta, veri_delta}] (rank sırası).
  standings jsonb not null default '[]'::jsonb
);
create index if not exists age_match_history_ended_idx on public.age_match_history (ended_at desc);
alter table public.age_match_history enable row level security;
revoke all on public.age_match_history from anon, authenticated;

-- ─── age_attack_guess: kale kelimesi havuzda yoksa ayrı hata ─────────────────
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
    -- Kelime: uzunluk tut ama HAVUZDA yoksa AYRI hata → "sözlükte yok" uyarısı.
    if t.kind = 'castle' then
      if char_length(p_guess) <> t.level then
        raise exception 'invalid_guess';
      elsif not exists (select 1 from secret_words where word = p_guess) then
        raise exception 'word_not_in_pool';
      end if;
    else
      if not public._age_valid_guess('tower', t.level, p_guess) then
        raise exception 'invalid_guess';
      end if;
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

-- ─── _age_finish: kupa ödülleri 1./2./3. → +60 / +40 / +15 + Son Maçlar özeti ─
-- Puan: kule = 2 · kale = harf × 5. Toprağın yoksa 0. Veri ödülü aynı (60/20/0).
create or replace function public._age_finish(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rk jsonb := '[]'::jsonb; hist jsonb := '[]'::jsonb;
  rec record; rnk int := 0; v_kupa int; v_veri int; v_name text;
begin
  if (select phase from age_matches where id = p_match_id) = 'finished' then return; end if;

  for rec in
    select p.player, p.eliminated_at,
           coalesce((select sum(case when t.kind = 'castle' then t.level * 5 else 2 end)
                       from age_territories t
                      where t.match_id = p.match_id and t.owner = p.player), 0) as points,
           coalesce((select count(*) from age_territories t
                      where t.match_id = p.match_id and t.owner = p.player and t.kind = 'tower'), 0) as towers,
           coalesce((select count(*) from age_territories t
                      where t.match_id = p.match_id and t.owner = p.player and t.kind = 'castle'), 0) as castles
      from age_players p
     where p.match_id = p_match_id
     order by points desc, (p.eliminated_at is null) desc, p.eliminated_at desc nulls last,
              p.prep_accuracy desc
  loop
    rnk := rnk + 1;
    v_kupa := case rnk when 1 then 60 when 2 then 40 else 15 end;
    v_veri := case rnk when 1 then 60 when 2 then 20 else 0 end;
    update profiles set rating = greatest(0, rating + v_kupa), veri = greatest(0, veri + v_veri)
     where id = rec.player;
    select username into v_name from profiles where id = rec.player;
    rk := rk || jsonb_build_object('player', rec.player, 'rank', rnk,
                                   'points', rec.points, 'kupa_delta', v_kupa, 'veri_delta', v_veri);
    hist := hist || jsonb_build_object('name', v_name, 'rank', rnk, 'points', rec.points,
                                       'towers', rec.towers, 'castles', rec.castles,
                                       'kupa_delta', v_kupa, 'veri_delta', v_veri);
  end loop;
  update age_matches set phase = 'finished', ranking = rk, war_ends_at = null
   where id = p_match_id and phase <> 'finished';

  -- Son Maçlar akışı (public-safe: yalnız isim + istatistik, ham uuid yok).
  insert into age_match_history (match_id, standings) values (p_match_id, hist)
    on conflict (match_id) do nothing;
  delete from age_match_history
   where id not in (select id from age_match_history order by ended_at desc, id desc limit 30);
end;
$$;
revoke execute on function public._age_finish(uuid) from public, anon, authenticated;

-- ─── get_recent_age_matches: son 30 Gizem Çağı maçı (giriş yapan herkese) ─────
create or replace function public.get_recent_age_matches()
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(to_jsonb(h) order by h.ended_at desc), '[]'::jsonb)
  from (
    select match_id, ended_at, standings
    from age_match_history
    order by ended_at desc
    limit 30
  ) h;
$$;
revoke execute on function public.get_recent_age_matches() from public, anon;
grant execute on function public.get_recent_age_matches() to authenticated;

notify pgrst, 'reload schema';
