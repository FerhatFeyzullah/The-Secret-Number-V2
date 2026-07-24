-- ══════════════════════════════════════════════════════════════════════════
-- GİZEM ÇAĞI · Faz 2: Maç yaşam döngüsü + PvE fetih RPC'leri
--
-- Bu dosya kuyruk→hazırlık→fetih→şifre→faz geçişi + savaşta NÖTR/DÜŞMAN toprak
-- fethini (PvE tarafı) içerir. Aktif savunma alt-oyunu (savunmaya koşma +
-- sabotaj) ..02'dedir; bu dosyadaki age_attack_guess sabotaj bayraklarını OKUR
-- ama onları YAZAN RPC'ler ..02'de tanımlanır (PL/pgSQL çağrı-anında çözülür).
--
-- TÜM RPC'ler security definer + idempotent + yarış-güvenli.
-- ══════════════════════════════════════════════════════════════════════════

-- ─── Harita seed'i: 5 kale + 10 kule + bot şifreleri ────────────────────────
-- Kale seviyeleri: slot 0,1 → 4 harf · 2,3 → 5 harf · 4 → 6 harf (taht).
-- Her kalenin 2 kulesi (kind=tower, castle_id=kale). Bot şifreleri age_secrets'e.
create or replace function public._age_seed_map(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  castle_levels int[] := array[4, 4, 5, 5, 6];
  i int;
  cid uuid;
  tid uuid;
  j int;
begin
  for i in 1..5 loop
    -- Kale
    insert into age_territories (match_id, kind, slot_index, level)
    values (p_match_id, 'castle', i - 1, castle_levels[i])
    returning id into cid;
    insert into age_secrets (territory_id, word)
    values (cid, _age_rand_word(castle_levels[i]));
    -- 2 nöbet kulesi (slot_index: kaleninkinden türet → 100 + kale*10 + kule)
    for j in 1..2 loop
      insert into age_territories (match_id, kind, slot_index, castle_id, level)
      values (p_match_id, 'tower', 100 + (i - 1) * 10 + j, cid, 0)
      returning id into tid;
      insert into age_secrets (territory_id, digits)
      values (tid, _age_rand_number());
    end loop;
  end loop;
end;
$$;
revoke execute on function public._age_seed_map(uuid) from public, anon, authenticated;

-- ─── age_find_match: 3'lü kuyruk ────────────────────────────────────────────
-- Bekleyen (phase='queue', <3 oyuncu) maça katıl; 3. oyuncuyla HAZIRLIK başlar
-- (harita seed + prep_ends_at). Yoksa yeni kuyruk maçı aç. find_or_create_quick
-- deseninde 'for update skip locked'.
create or replace function public.age_find_match()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.age_matches;
  n int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  -- Zaten aktif (bitmemiş) maçım varsa onu döndür (idempotent resume).
  select mm.* into m from age_matches mm
    join age_players p on p.match_id = mm.id and p.player = uid
   where mm.phase in ('queue', 'prep', 'war')
   order by mm.created_at desc limit 1;
  if found then
    return jsonb_build_object('match_id', m.id, 'phase', m.phase);
  end if;

  -- Bekleyen kuyruk maçına katıl (kilitli; çift katılım engellenir).
  select * into m from age_matches
   where phase = 'queue' and player3 is null
     and player1 <> uid and coalesce(player2, '00000000-0000-0000-0000-000000000000') <> uid
     and created_at >= now() - interval '2 minutes'
   order by created_at
   limit 1
   for update skip locked;

  if found then
    if m.player2 is null then
      update age_matches set player2 = uid where id = m.id;
      insert into age_players (match_id, player, slot) values (m.id, uid, 2);
      return jsonb_build_object('match_id', m.id, 'phase', 'queue');
    else
      -- 3. oyuncu → HAZIRLIK başlat.
      update age_matches
         set player3 = uid, phase = 'prep',
             prep_ends_at = now() + (_age_const('prep_ms') || ' milliseconds')::interval
       where id = m.id;
      insert into age_players (match_id, player, slot) values (m.id, uid, 3);
      perform _age_seed_map(m.id);
      return jsonb_build_object('match_id', m.id, 'phase', 'prep');
    end if;
  end if;

  -- Yeni kuyruk maçı.
  insert into age_matches (phase, player1) values ('queue', uid) returning * into m;
  insert into age_players (match_id, player, slot) values (m.id, uid, 1);
  return jsonb_build_object('match_id', m.id, 'phase', 'queue');
end;
$$;
revoke execute on function public.age_find_match() from public, anon;
grant execute on function public.age_find_match() to authenticated;

-- ─── Yardımcı: maçtaki oyuncunun toprak sayısı ──────────────────────────────
create or replace function public._age_territory_count(p_match_id uuid, p_player uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from age_territories
   where match_id = p_match_id and owner = p_player;
$$;
revoke execute on function public._age_territory_count(uuid, uuid) from public, anon, authenticated;

-- ─── Yardımcı: maçı bitir + sıralama + ödül ─────────────────────────────────
-- Sıralama: hayatta olanlar elenenlerin ÜSTÜNDE; elenenler geç elenen üstte;
-- hayatta olanlar arasında kale>kule>fetih. Ödül: 1→+25/+60, 2→+5/+20, 3→-15/0.
create or replace function public._age_finish(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rk jsonb := '[]'::jsonb;
  rec record;
  rnk int := 0;
  v_kupa int;
  v_veri int;
begin
  -- Zaten bittiyse tekrar ödül dağıtma (idempotent — çift claim koruması).
  if (select phase from age_matches where id = p_match_id) = 'finished' then
    return;
  end if;

  for rec in
    select p.player,
           p.eliminated_at,
           (select count(*) from age_territories t
             where t.match_id = p.match_id and t.owner = p.player and t.kind = 'castle') as castles,
           (select count(*) from age_territories t
             where t.match_id = p.match_id and t.owner = p.player and t.kind = 'tower') as towers,
           (select coalesce(sum(t.conquer_count), 0) from age_territories t
             where t.match_id = p.match_id and t.owner = p.player) as conquers
      from age_players p
     where p.match_id = p_match_id
     order by (p.eliminated_at is null) desc, p.eliminated_at desc nulls last,
              castles desc, towers desc, conquers desc, p.prep_accuracy desc
  loop
    rnk := rnk + 1;
    v_kupa := case rnk when 1 then 25 when 2 then 5 else -15 end;
    v_veri := case rnk when 1 then 60 when 2 then 20 else 0 end;
    update profiles
       set rating = greatest(0, rating + v_kupa),
           veri = greatest(0, veri + v_veri)
     where id = rec.player;
    rk := rk || jsonb_build_object('player', rec.player, 'rank', rnk,
                                   'kupa_delta', v_kupa, 'veri_delta', v_veri);
  end loop;
  update age_matches set phase = 'finished', ranking = rk, war_ends_at = null
   where id = p_match_id and phase <> 'finished';
end;
$$;
revoke execute on function public._age_finish(uuid) from public, anon, authenticated;

-- Fetih sonrası şifre belirleme penceresi için toprağa deadline kolonu.
alter table public.age_territories
  add column if not exists code_deadline timestamptz null;

-- ─── Eleme kontrolü (yalnız savaş): topraksız kalan elenir, ≤1 kalırsa biter ──
create or replace function public._age_eliminate_check(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ph text;
  alive int;
begin
  select phase into ph from age_matches where id = p_match_id;
  if ph <> 'war' then return; end if;
  -- Topraksız + hâlâ hayatta olanları ele.
  update age_players p
     set eliminated_at = now()
   where p.match_id = p_match_id and p.eliminated_at is null
     and public._age_territory_count(p_match_id, p.player) = 0;
  select count(*) into alive from age_players
   where match_id = p_match_id and eliminated_at is null;
  if alive <= 1 then
    perform public._age_finish(p_match_id);
  end if;
end;
$$;
revoke execute on function public._age_eliminate_check(uuid) from public, anon, authenticated;

-- ─── Yardımcı: tahmin geçerliliği (kule=sayı, kale=kelime) ──────────────────
create or replace function public._age_valid_guess(p_kind text, p_level int, p_guess text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_kind = 'tower' then
      p_guess ~ '^[1-9]{3}$'
      and substring(p_guess,1,1) <> substring(p_guess,2,1)
      and substring(p_guess,1,1) <> substring(p_guess,3,1)
      and substring(p_guess,2,1) <> substring(p_guess,3,1)
    else
      char_length(p_guess) = p_level
      and exists (select 1 from secret_words where word = p_guess)
  end;
$$;
revoke execute on function public._age_valid_guess(text, int, text) from public, anon, authenticated;

-- ─── Yardımcı: kalenin iki kulesi de çağıranda mı (kapı şartı) ──────────────
create or replace function public._age_gate_open(p_castle_id uuid, p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from age_territories
     where castle_id = p_castle_id and kind = 'tower'
       and (owner is distinct from p_player)
  );
$$;
revoke execute on function public._age_gate_open(uuid, uuid) from public, anon, authenticated;

-- ─── age_start_attack ───────────────────────────────────────────────────────
-- Hedef seçer/oturum açar. Kurallar: prep→yalnız bot toprağı; war→kendi hariç.
-- Kale için kapı şartı (2 kule sende). Çağıranın diğer aktif saldırısı 'open'a
-- döner (aynı anda tek hedef). Birikmiş saldırı varsa siege korunur.
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
  -- Kale kapısı: iki kule de çağıranda olmalı.
  if t.kind = 'castle' and not public._age_gate_open(t.id, uid) then
    raise exception 'gate_closed';
  end if;

  -- Diğer aktif saldırıları pasifle (aynı anda tek hedef; siege korunur).
  update age_attacks set status = 'open', deadline = null
   where match_id = m.id and attacker = uid and status = 'active' and territory_id <> p_territory_id;

  try_ms := case when t.kind = 'tower' then _age_const('tower_try_ms')
                 else _age_castle_try_ms(t.level) end;

  select * into a from age_attacks where attacker = uid and territory_id = p_territory_id;
  if found then
    update age_attacks
       set status = 'active', deadline = now() + (try_ms || ' milliseconds')::interval,
           kind = t.kind
     where id = a.id
    returning * into a;
  else
    insert into age_attacks (match_id, attacker, territory_id, kind, status, deadline)
    values (m.id, uid, p_territory_id, t.kind, 'active',
            now() + (try_ms || ' milliseconds')::interval)
    returning * into a;
  end if;

  return jsonb_build_object('attack_id', a.id, 'deadline', a.deadline,
    'kind', t.kind, 'level', t.level, 'target_owner', t.owner);
end;
$$;
revoke execute on function public.age_start_attack(uuid) from public, anon;
grant execute on function public.age_start_attack(uuid) to authenticated;

-- ─── age_attack_guess ───────────────────────────────────────────────────────
-- Tahmini değerlendirir. Süre dolduysa: bot toprağı→gizli YENİLENİR (temiz
-- sayfa); oyuncu toprağı→saldırı 'open' (siege korunur). WIN→toprak devri +
-- şifre penceresi + (savaşta) eleme kontrolü; yarışta İLK win tek kazanan
-- (diğer saldırılar 'lost'). Sabotaj bayrakları (..02) OKUNUR.
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
  cl text;
  occ int;
  remaining int;
  code_ms int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into a from age_attacks where attacker = uid and territory_id = p_territory_id;
  if not found then raise exception 'no_active_attack'; end if;
  select * into t from age_territories where id = p_territory_id;
  select * into m from age_matches where id = t.match_id;
  if m.phase not in ('prep', 'war') then raise exception 'wrong_phase'; end if;

  -- Yarış: hedef başkasınca alındıysa bu saldırı kaybetti.
  if t.owner = uid then raise exception 'already_yours'; end if;
  if t.owner is not null and m.phase = 'prep' then
    update age_attacks set status = 'lost' where id = a.id;
    return jsonb_build_object('status', 'lost_race');
  end if;

  -- Süre kontrolü.
  if a.status <> 'active' or a.deadline is null then
    raise exception 'no_active_attack';
  end if;
  if now() > a.deadline then
    if t.owner is null then
      -- Bot toprağı: gizli yenilenir, temiz sayfa.
      if t.kind = 'tower' then
        update age_secrets set digits = _age_rand_number() where territory_id = t.id;
      else
        update age_secrets set word = _age_rand_word(t.level) where territory_id = t.id;
      end if;
      delete from age_attack_guesses where attack_id = a.id;
      update age_attacks
         set deadline = now() + (case when t.kind='tower' then _age_const('tower_try_ms')
                                      else _age_castle_try_ms(t.level) end || ' milliseconds')::interval,
             fog_remaining = 0, cursed_letters = '{}', clock_penalty_ms = 0
       where id = a.id;
      return jsonb_build_object('status', 'expired_renewed');
    else
      -- Oyuncu toprağı: siege korunur, yeniden başlat gerek.
      update age_attacks set status = 'open', deadline = null where id = a.id;
      return jsonb_build_object('status', 'expired');
    end if;
  end if;

  -- Geçerlilik.
  if not public._age_valid_guess(t.kind, t.level, p_guess) then
    raise exception 'invalid_guess';
  end if;

  select * into s from age_secrets where territory_id = t.id;
  secret_val := coalesce(s.digits, s.word);

  -- ── KAZANMA: hiçbir sabotaj dokunamaz ──
  if p_guess = secret_val then
    if t.kind = 'tower' then feedback := 'win'; real_marks := null;
    else feedback := 'win'; real_marks := repeat('G', t.level); end if;
    insert into age_attack_guesses (attack_id, guess, feedback, marks)
    values (a.id, p_guess, feedback, real_marks);

    -- Toprak devri + fetih sayacı.
    code_ms := _age_const('set_code_ms');
    update age_territories
       set owner = uid, conquer_count = conquer_count + 1,
           code_deadline = now() + (code_ms || ' milliseconds')::interval
     where id = t.id;
    -- Fethedilen toprağa varsayılan (random) şifre — pencerede override edilebilir.
    if t.kind = 'tower' then
      update age_secrets set digits = _age_rand_number() where territory_id = t.id;
    else
      update age_secrets set word = _age_rand_word(t.level) where territory_id = t.id;
    end if;
    -- Bu saldırı kazandı; AYNI hedefe diğer tüm saldırılar kaybetti (yarış + siege).
    update age_attacks set status = 'won' where id = a.id;
    update age_attacks set status = 'lost'
     where territory_id = t.id and attacker <> uid and status in ('open', 'active');
    delete from age_attack_guesses g
     using age_attacks aa
     where g.attack_id = aa.id and aa.territory_id = t.id and aa.attacker <> uid;
    -- Bu toprağa bağlı savunma oturumları biter.
    delete from age_defenses d using age_attacks aa
     where d.attack_id = aa.id and aa.territory_id = t.id;

    -- Savaşta: eski sahibi topraksız kaldıysa ele; ≤1 kalırsa maç biter.
    if m.phase = 'war' then perform public._age_eliminate_check(m.id); end if;

    return jsonb_build_object('status', 'conquered', 'territory_id', t.id,
      'code_deadline', now() + (code_ms || ' milliseconds')::interval);
  end if;

  -- ── YANLIŞ: sabotaj + değerlendirme ──
  -- Lanetli harf (kale savunması): guess'teki her lanetli harf geçişi -3sn.
  if array_length(a.cursed_letters, 1) is not null then
    foreach cl in array a.cursed_letters loop
      occ := char_length(p_guess) - char_length(replace(p_guess, cl, ''));
      if occ > 0 then
        update age_attacks set deadline = deadline - (_age_const('sabotage_penalty') * occ || ' milliseconds')::interval
         where id = a.id;
      end if;
    end loop;
    select * into a from age_attacks where id = a.id;  -- güncel deadline
  end if;

  if t.kind = 'tower' then
    feedback := _evaluate_guess_number(secret_val, p_guess);
    real_marks := null;
    disp_marks := null;
    hits := case
      when feedback = 'digits_correct_wrong_order' then 3
      when feedback like 'partial:%' then split_part(feedback, ':', 2)::int
      else 0 end;
  else
    real_marks := _word_marks(secret_val, p_guess);
    feedback := 'miss';
    hits := char_length(real_marks) - char_length(replace(real_marks, 'G', ''));
    -- Sis: sonraki tahminlerde G/Y → 'P' maskeli (tower_guess deseni).
    if a.fog_remaining > 0 then
      disp_marks := translate(real_marks, 'GY', 'PP');
      update age_attacks set fog_remaining = fog_remaining - 1 where id = a.id;
    else
      disp_marks := real_marks;
    end if;
  end if;

  insert into age_attack_guesses (attack_id, guess, feedback, marks)
  values (a.id, p_guess, feedback, real_marks);

  -- Hazırlıkta isabet biriktir (topraksız-topraksız tiebreak).
  if m.phase = 'prep' then
    update age_players set prep_accuracy = prep_accuracy + hits
     where match_id = m.id and player = uid;
  end if;

  select extract(epoch from (deadline - now()))::int * 1000 into remaining
    from age_attacks where id = a.id;
  return jsonb_build_object('status', 'continue', 'feedback', feedback,
    'marks', disp_marks, 'remaining_ms', greatest(0, coalesce(remaining, 0)));
end;
$$;
revoke execute on function public.age_attack_guess(uuid, text) from public, anon;
grant execute on function public.age_attack_guess(uuid, text) to authenticated;

-- ─── age_abandon_attack: aktif saldırıyı bırak (siege korunur) ──────────────
create or replace function public.age_abandon_attack(p_territory_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  update age_attacks set status = 'open', deadline = null
   where attacker = uid and territory_id = p_territory_id and status = 'active';
end;
$$;
revoke execute on function public.age_abandon_attack(uuid) from public, anon;
grant execute on function public.age_abandon_attack(uuid) to authenticated;

-- ─── age_set_code: fetih sonrası kendi savunma şifreni belirle ──────────────
-- Pencere (30 sn) içinde; aşımda random şifre kalır (fetihte zaten atandı).
create or replace function public.age_set_code(p_territory_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.age_territories;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into t from age_territories where id = p_territory_id;
  if not found then raise exception 'territory_not_found'; end if;
  if t.owner <> uid then raise exception 'not_owner'; end if;
  if t.code_deadline is null or now() > t.code_deadline then
    raise exception 'code_window_closed';
  end if;
  if not public._age_valid_guess(t.kind, t.level, p_code) then
    raise exception 'invalid_code';
  end if;
  if t.kind = 'tower' then
    update age_secrets set digits = p_code where territory_id = t.id;
  else
    update age_secrets set word = p_code where territory_id = t.id;
  end if;
  update age_territories set code_deadline = null where id = t.id;  -- kilitle
  return jsonb_build_object('status', 'code_set');
end;
$$;
revoke execute on function public.age_set_code(uuid, text) from public, anon;
grant execute on function public.age_set_code(uuid, text) to authenticated;

-- ─── age_claim_phase: faz/süre geçişlerini çöz (idempotent, karar sunucuda) ──
-- prep bitti (süre VEYA harita doldu) → topraksızları ele, ≤1 kalırsa bitir,
-- yoksa savaşa geç. war süresi bitti → sıralama. İki istemci de tetikleyebilir.
create or replace function public.age_claim_phase(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.age_matches;
  bot_left int;
  alive int;
begin
  select * into m from age_matches where id = p_match_id for update;
  if not found then raise exception 'match_not_found'; end if;
  if auth.uid() not in (m.player1, m.player2, m.player3) then raise exception 'not_a_player'; end if;

  if m.phase = 'prep' then
    select count(*) into bot_left from age_territories where match_id = m.id and owner is null;
    if now() > m.prep_ends_at or bot_left = 0 then
      -- Topraksız oyuncuları ele (hazırlık sonu = anında 3.).
      update age_players p set eliminated_at = now()
       where p.match_id = m.id and p.eliminated_at is null
         and public._age_territory_count(m.id, p.player) = 0;
      select count(*) into alive from age_players where match_id = m.id and eliminated_at is null;
      if alive <= 1 then
        perform public._age_finish(m.id);
      else
        update age_matches
           set phase = 'war',
               war_ends_at = now() + (_age_const('war_ms') || ' milliseconds')::interval
         where id = m.id;
      end if;
    end if;
  elsif m.phase = 'war' then
    if now() > m.war_ends_at then
      perform public._age_finish(m.id);
    end if;
  end if;
end;
$$;
revoke execute on function public.age_claim_phase(uuid) from public, anon;
grant execute on function public.age_claim_phase(uuid) to authenticated;

-- ─── age_leave: maçtan çık (topraklar bota, oyuncu son sıraya) ──────────────
create or replace function public.age_leave(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.age_matches;
  t public.age_territories;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into m from age_matches where id = p_match_id;
  if not found then return; end if;
  if uid not in (m.player1, m.player2, m.player3) then raise exception 'not_a_player'; end if;

  -- Kuyrukta/hazırlıkta tek başına çıkış → maçı iptal (kimse başlamadı).
  if m.phase = 'queue' then
    update age_matches set phase = 'cancelled' where id = m.id;
    return;
  end if;

  -- Topraklarını bota devret + gizlilerini yenile.
  for t in select * from age_territories where match_id = m.id and owner = uid loop
    update age_territories set owner = null, code_deadline = null where id = t.id;
    if t.kind = 'tower' then
      update age_secrets set digits = _age_rand_number() where territory_id = t.id;
    else
      update age_secrets set word = _age_rand_word(t.level) where territory_id = t.id;
    end if;
  end loop;
  -- Aktif saldırı/savunmalarını kapat.
  update age_attacks set status = 'lost' where match_id = m.id and attacker = uid and status in ('open','active');
  -- Eleme + olası erken bitiş.
  update age_players set eliminated_at = coalesce(eliminated_at, now())
   where match_id = m.id and player = uid;
  if m.phase = 'war' then
    perform public._age_eliminate_check(m.id);
  end if;
end;
$$;
revoke execute on function public.age_leave(uuid) from public, anon;
grant execute on function public.age_leave(uuid) to authenticated;

-- ─── age_get_state: güvenli tam durum (şifre SIZDIRMAZ) ─────────────────────
-- Harita + oyuncular + çağıranın saldırıları (tahmin geçmişiyle) + çağıranın
-- topraklarına gelen saldırıların canlı raporu (savunma alarmı). Şifre YOK.
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

  -- Çağıranın saldırıları + tahmin geçmişi (marks: kelime kendi tahtası).
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

  -- Çağıranın topraklarına gelen saldırılar (savunma raporu): saldıran +
  -- tahmin sayısı + son yeşil/sarı. Şifre/tahmin İÇERİĞİ sızmaz.
  select coalesce(jsonb_agg(jsonb_build_object(
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
