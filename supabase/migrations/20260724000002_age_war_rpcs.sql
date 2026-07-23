-- ══════════════════════════════════════════════════════════════════════════
-- GİZEM ÇAĞI · Faz 3: Aktif savunma alt-oyunu (savaş fazı)
--
-- Kalesine saldırı gelen oyuncu "savunmaya koşar": botun ÜRETTİĞİ sayıları
-- çözer (saldırı başına 3 hak). Her çözüm SALDIRANA sabotaj uygular:
--   • BEDAVA: saldıranın deneme süresi -15 sn (age_attacks.deadline).
--   • İSTEĞE BAĞLI (Veri ile): Sis (sonraki 3 tahmin GY→maskeli) ya da Lanetli
--     Harf (2 harf; saldıranın tahmininde geçişte -3 sn). Bu bayraklar
--     age_attacks üzerinde tutulur; age_attack_guess (..01) OKUR.
-- Savunmaya koşan oyuncunun KENDİ aktif saldırısı DÜŞER (feda gerçek).
--
-- Savunma sayısı da GİZLİDİR (age_defenses.secret_digits, kapalı tablo);
-- değerlendirme sunucuda (_evaluate_guess_number), cevap dönmez.
-- ══════════════════════════════════════════════════════════════════════════

-- ─── age_start_defense: kalene gelen saldırıya karşı savunmaya koş ──────────
-- Saldırı 'active' olmalı ve hedef çağıranın kalesi. Çağıranın KENDİ aktif
-- saldırısı düşer. Bot bir sayı üretir; savunan onu çözmeye çalışır.
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

  -- Feda: savunanın kendi aktif saldırısı düşer (siege korunur, 'open').
  update age_attacks set status = 'open', deadline = null
   where match_id = m.id and attacker = uid and status = 'active';

  -- Savunma oturumu (saldırı başına tek; varsa devam et).
  select * into d from age_defenses where attack_id = p_attack_id;
  if not found then
    insert into age_defenses (attack_id, defender, secret_digits, deadline)
    values (p_attack_id, uid, _age_rand_number(),
            now() + (_age_const('tower_try_ms') || ' milliseconds')::interval)
    returning * into d;
  end if;

  return jsonb_build_object('defense_id', d.id, 'solved_count', d.solved_count,
    'slots', _age_const('defense_slots'), 'deadline', d.deadline);
end;
$$;
revoke execute on function public.age_start_defense(uuid) from public, anon;
grant execute on function public.age_start_defense(uuid) to authenticated;

-- ─── age_defense_guess: savunma sayısını çöz → saldırana -15 sn + hak +1 ────
-- WIN → solved_count++ (max 3), saldıranın deadline'ı -15 sn, yeni bot sayısı.
-- solved_count 3'e ulaşınca daha fazla çözüm yok (premium sabotaj hâlâ alınır).
create or replace function public.age_defense_guess(p_attack_id uuid, p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  d public.age_defenses;
  a public.age_attacks;
  feedback text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into d from age_defenses where attack_id = p_attack_id;
  if not found then raise exception 'no_defense'; end if;
  if d.defender <> uid then raise exception 'not_defender'; end if;
  select * into a from age_attacks where id = p_attack_id;
  if a.status <> 'active' then
    -- Saldırı bitti/bırakıldı → savunma anlamsız.
    return jsonb_build_object('status', 'attack_gone');
  end if;
  if d.solved_count >= _age_const('defense_slots') then
    raise exception 'defense_slots_full';
  end if;

  -- Geçerlilik (3 hane, tekrarsız).
  if not public._age_valid_guess('tower', 0, p_guess) then
    raise exception 'invalid_guess';
  end if;

  feedback := _evaluate_guess_number(d.secret_digits, p_guess);
  if feedback = 'win' then
    -- Saldırana bedava sabotaj: deneme süresi -15 sn.
    update age_attacks
       set deadline = deadline - (_age_const('defense_time_cut') || ' milliseconds')::interval
     where id = p_attack_id;
    -- Hak +1, yeni bot sayısı, saat yenile.
    update age_defenses
       set solved_count = solved_count + 1,
           secret_digits = _age_rand_number(),
           deadline = now() + (_age_const('tower_try_ms') || ' milliseconds')::interval
     where attack_id = p_attack_id
    returning * into d;
    return jsonb_build_object('status', 'solved', 'solved_count', d.solved_count,
      'time_cut_ms', _age_const('defense_time_cut'),
      'can_buy', d.solved_count <= _age_const('defense_slots'));
  end if;

  return jsonb_build_object('status', 'continue', 'feedback', feedback);
end;
$$;
revoke execute on function public.age_defense_guess(uuid, text) from public, anon;
grant execute on function public.age_defense_guess(uuid, text) to authenticated;

-- ─── age_buy_sabotage: Veri ödeyip saldırana premium dezavantaj uygula ──────
-- 'fog' (50 Veri; sonraki 3 tahmin GY→'P') ya da 'cursed' (75 Veri; gizlide
-- OLMAYAN 2 harf; saldıranın tahmininde geçişte -3 sn). En az 1 savunma çözümü
-- yapılmış olmalı (bedava süre-kesme kazanılmadan premium yok). Veri sunucuda
-- düşer (unlock_signal deseni: profil satırı 'for update').
create or replace function public.age_buy_sabotage(p_attack_id uuid, p_kind text)
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
  cost int;
  target_secret text;
  cursed text[];
  pool text[];
  ch text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into d from age_defenses where attack_id = p_attack_id;
  if not found then raise exception 'no_defense'; end if;
  if d.defender <> uid then raise exception 'not_defender'; end if;
  if d.solved_count < 1 then raise exception 'solve_first'; end if;
  select * into a from age_attacks where id = p_attack_id;
  if a.status <> 'active' then return jsonb_build_object('status', 'attack_gone'); end if;

  cost := case p_kind when 'fog' then _age_const('cost_fog')
                      when 'cursed' then _age_const('cost_cursed')
                      else null end;
  if cost is null then raise exception 'unknown_sabotage'; end if;

  -- Veri düş (profil kilidi → çifte satın almada seri).
  select * into me from profiles where id = uid for update;
  if me.veri < cost then raise exception 'insufficient_veri'; end if;
  update profiles set veri = veri - cost where id = uid;

  if p_kind = 'fog' then
    update age_attacks set fog_remaining = _age_const('fog_turns') where id = p_attack_id;
  else
    -- Lanetli harf: SALDIRANIN çözmeye çalıştığı KELİMEDE olmayan 2 harf.
    select * into t from age_territories where id = a.territory_id;
    select coalesce(word, digits) into target_secret from age_secrets where territory_id = t.id;
    -- Türkçe alfabe havuzundan gizlide olmayanlar.
    pool := array(select c from unnest(regexp_split_to_array('abcçdefgğhıijklmnoöprsştuüvyz', '')) c
                   where position(c in target_secret) = 0
                   order by random() limit 2);
    update age_attacks set cursed_letters = pool where id = p_attack_id;
  end if;

  return jsonb_build_object('status', 'bought', 'kind', p_kind,
    'veri', me.veri - cost);
end;
$$;
revoke execute on function public.age_buy_sabotage(uuid, text) from public, anon;
grant execute on function public.age_buy_sabotage(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════
-- Doğrulama notları (harness)
-- ══════════════════════════════════════════════════════════════════════════
--   - Savaşta A kalesine B saldırır (active). A savunmaya koşar → A'nın kendi
--     aktif saldırısı 'open'a döner. A savunma sayısını çözer → B'nin deadline'ı
--     -15 sn, solved_count 1. A 'fog' satın alır (Veri -50) → B'nin sonraki
--     tahmininde marks 'P' maskeli.
--   - age_defenses secret_digits istemciden okunamaz (revoke all).
--   - Eleme: B, A'nın SON toprağını fethederse A elenir; ≤1 kalınca _age_finish.
