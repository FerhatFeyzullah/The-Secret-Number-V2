-- Faz 3 / Adım 4c: Engel + Savunma protokolleri (4 etki + counter zinciri)
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- "ENGEL" sınıfı: rakibe uygulanan protokoller (disrupt_fog, disrupt_silence,
-- disrupt_waste — Susturma da bir engeldir). Savunmalar yalnız bu sınıfa tepki
-- verir. Hedefli engel akışı (TEK kapı: _apply_obstacle, deterministik):
--   1) Hedefin YANSITMASI aktifse → engel uygulanmaz, GÖNDERENE yansır;
--      Yansıtma + gelen engel tükenir. Yansıyan engel TEKRAR yansıtılamaz/
--      bloklanamaz (zincir BİR kez — gönderenin savunmaları atlanır).
--   2) değilse hedefin KALKANI aktifse → engel bloklanır (etki yok);
--      Kalkan + gelen engel tükenir.
--   3) değilse engel normal uygulanır.
--   İkisi de aktifse öncelik: YANSITMA (Kalkan armed kalır) — deterministik.
--
-- Etkiler: Sis Perdesi (hedefin SONRAKİ tahmininin feedback'i 4 sn gecikmeli
-- GÖSTERİLİR — değerlendirme sunucuda aynen; yalnız gösterim sinyali, tek
-- tahmin), Susturma (hedef, sıradaki turu BİTENE KADAR hiçbir protokol
-- kullanamaz; turu bitince kalkar), Zorla Harca (hedefin kullanılmamış
-- protokollerinden rastgele biri etkisiz "harcanmış" olur; hedefte
-- kullanılmamış protokol yoksa HAK İADE — consumed=false; YANSIMIŞ harca
-- hedefsizse sessizce söner, hak iade edilmez — gönderen zaten harcadı).
-- Kalkan/Yansıtma: kurulur (kullanım hakkı kurulumda işlenir), maç boyu ilk
-- engele kadar bekler, tetiklenince tükenir.
--
-- Bildirimler: match_protocol_uses.outcome ('applied'/'blocked'/'reflected')
-- + Zorla Harca kurbanı için outcome='wasted' satırı (player=kurban,
-- protocol_id=harcanan). Tablo sır içermez; iki oyuncu da okur.
-- Gizli sayı hiçbir akışta sızmaz.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ŞEMA
-- ════════════════════════════════════════════════════════════════════════════
-- Sis Perdesi: o oyuncunun SONRAKİ tahmini gecikmeli gösterilir.
alter table public.matches
  add column if not exists fog_p1 boolean not null default false;
alter table public.matches
  add column if not exists fog_p2 boolean not null default false;
-- Susturma: o oyuncu, sıradaki turu bitene kadar protokol kullanamaz.
alter table public.matches
  add column if not exists silenced_p1 boolean not null default false;
alter table public.matches
  add column if not exists silenced_p2 boolean not null default false;

-- Kurulu savunmalar (maç boyu ilk engele kadar bekler; RLS kendi satırı).
alter table public.protocol_hands
  add column if not exists shield_armed boolean not null default false;
alter table public.protocol_hands
  add column if not exists reflect_armed boolean not null default false;

-- Sisli tahmin işareti: istemci feedback'i 4 sn maskeleyerek gösterir
-- (değerlendirme aynı; yalnız gösterim gecikir).
alter table public.guesses
  add column if not exists fogged boolean not null default false;

-- Kullanım kaydı sonucu (bildirimler bunu okur).
alter table public.match_protocol_uses
  add column if not exists outcome text not null default 'applied';
alter table public.match_protocol_uses
  drop constraint if exists match_protocol_uses_outcome_check;
alter table public.match_protocol_uses
  add constraint match_protocol_uses_outcome_check
  check (outcome in ('applied', 'blocked', 'reflected', 'wasted'));

-- Katalog: engel + savunma protokolleri ANYTIME (sıra fark etmez; etkiyle
-- birlikte kesinleşti — catalog.ts ile bire bir).
update public.protocols set usage_timing = 'anytime'
 where id in ('disrupt_fog', 'disrupt_silence', 'disrupt_waste',
              'def_shield', 'def_reflect');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Engel etkileri (hedef parametreli — yansımada hedef gönderen olur)
-- ════════════════════════════════════════════════════════════════════════════
-- Sis Perdesi: hedefin sonraki tahmini gecikmeli gösterilir (tek tahmin).
create or replace function public._obstacle_fog(p_match public.matches, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update matches
     set fog_p1 = fog_p1 or (p_target = player1),
         fog_p2 = fog_p2 or (p_target = player2)
   where id = p_match.id;
  return '{}'::jsonb;
end;
$$;
revoke execute on function public._obstacle_fog(public.matches, uuid) from public, anon, authenticated;

-- Susturma: hedef, sıradaki turu bitene kadar hiçbir protokol kullanamaz.
-- (Hedefin turu sürüyorsa o turun kalanını kapsar; turu bitince kalkar.)
create or replace function public._obstacle_silence(p_match public.matches, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update matches
     set silenced_p1 = silenced_p1 or (p_target = player1),
         silenced_p2 = silenced_p2 or (p_target = player2)
   where id = p_match.id;
  return '{}'::jsonb;
end;
$$;
revoke execute on function public._obstacle_silence(public.matches, uuid) from public, anon, authenticated;

-- Zorla Harca: hedefin seçili-ama-kullanılmamış protokollerinden rastgele
-- birini etkisiz tüketir (outcome='wasted' kaydı → hedef artık kullanamaz,
-- iki istemci de realtime görür). Kullanılmamış yoksa consumed=false (HAK
-- İADE; yansımada çağıran bu anahtarı siler — bkz. _apply_obstacle).
create or replace function public._obstacle_waste(p_match public.matches, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  th public.protocol_hands;
  pool text[];
  pick text;
begin
  select * into th from protocol_hands where match_id = p_match.id and player = p_target;
  if not found then
    return jsonb_build_object('consumed', false, 'no_target_protocol', true);
  end if;
  select coalesce(array_agg(p order by random()), '{}') into pool
    from unnest(th.selected) p
   where p not in (
     select protocol_id from match_protocol_uses
      where match_id = p_match.id and player = p_target);
  if coalesce(array_length(pool, 1), 0) = 0 then
    return jsonb_build_object('consumed', false, 'no_target_protocol', true);
  end if;
  pick := pool[1];
  insert into match_protocol_uses (match_id, player, protocol_id, round, outcome)
  values (p_match.id, p_target, pick, p_match.current_round, 'wasted');
  return jsonb_build_object('wasted_protocol', pick);
end;
$$;
revoke execute on function public._obstacle_waste(public.matches, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) _apply_obstacle: counter zinciri (TEK kapı, deterministik, zincir 1 kez)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._apply_obstacle(
  p_match public.matches, p_uid uuid, p_protocol_id text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  opp uuid;
  oh public.protocol_hands;
  target uuid;
  reflected boolean := false;
  blocked boolean := false;
  detail jsonb := '{}'::jsonb;
begin
  opp := case when p_uid = p_match.player1 then p_match.player2 else p_match.player1 end;
  target := opp;

  -- Hedefin savunması (öncelik: YANSITMA; ikisi de aktifse Kalkan armed kalır).
  select * into oh from protocol_hands where match_id = p_match.id and player = opp;
  if found and oh.reflect_armed then
    update protocol_hands set reflect_armed = false
     where match_id = p_match.id and player = opp;
    target := p_uid; -- gönderene yansır; zincir BİR kez (yeni hedefin savunmaları ATLANIR)
    reflected := true;
  elsif found and oh.shield_armed then
    update protocol_hands set shield_armed = false
     where match_id = p_match.id and player = opp;
    blocked := true;
  end if;

  if not blocked then
    if p_protocol_id = 'disrupt_fog' then
      detail := _obstacle_fog(p_match, target);
    elsif p_protocol_id = 'disrupt_silence' then
      detail := _obstacle_silence(p_match, target);
    elsif p_protocol_id = 'disrupt_waste' then
      detail := _obstacle_waste(p_match, target);
    end if;
    -- Yansımış engel hedefsiz kalsa bile (örn. harca) hak iadesi YOK:
    -- gönderen engelini harcadı, yansıtma onu tüketti — sessizce söner.
    if reflected then
      detail := detail - 'consumed' - 'no_target_protocol';
    end if;
  end if;

  return jsonb_build_object(
    'outcome', case when blocked then 'blocked'
                    when reflected then 'reflected'
                    else 'applied' end,
    'blocked', blocked,
    'reflected', reflected) || detail;
end;
$$;
revoke execute on function public._apply_obstacle(public.matches, uuid, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Savunma kurulumları
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._protocol_def_shield(p_match public.matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update protocol_hands set shield_armed = true
   where match_id = p_match.id and player = p_uid;
  return jsonb_build_object('armed', 'shield');
end;
$$;
revoke execute on function public._protocol_def_shield(public.matches, uuid) from public, anon, authenticated;

create or replace function public._protocol_def_reflect(p_match public.matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update protocol_hands set reflect_armed = true
   where match_id = p_match.id and player = p_uid;
  return jsonb_build_object('armed', 'reflect');
end;
$$;
revoke execute on function public._protocol_def_reflect(public.matches, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) use_protocol: susturulma kontrolü + yeni dallar
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.use_protocol(
  p_match_id uuid,
  p_protocol_id text,
  p_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  proto public.protocols;
  h public.protocol_hands;
  my_clock int;
  use_count int;
  extra jsonb;
begin
  -- (1)+(2) çağıran oyuncu mu + maç satırı kilitli (yarışlar serileşir).
  m := _match_for_player(p_match_id);
  if m.mode <> 'protocol' then
    raise exception 'not_protocol_match';
  end if;

  select * into proto from protocols where id = p_protocol_id;
  if not found then
    raise exception 'protocol_not_found';
  end if;

  -- Susturulduysan (sıradaki turun bitene kadar) HİÇBİR protokol kullanamazsın.
  if (uid = m.player1 and m.silenced_p1) or (uid = m.player2 and m.silenced_p2) then
    raise exception 'silenced';
  end if;

  -- (5) kullanım zamanı kuralı (usage_timing → faz/sıra).
  if proto.usage_timing = 'setup' then
    if m.status <> 'setup' then
      raise exception 'not_in_setup';
    end if;
  else
    if m.status <> 'active' then
      raise exception 'match_not_active';
    end if;
  end if;
  if proto.usage_timing = 'own_turn' then
    if m.current_turn <> uid then
      raise exception 'not_your_turn';
    end if;
    -- Süresi (efektif: donma/yavaşlatma dahil) dolmuş sıra protokolle
    -- canlandırılamaz; turun kaderi claim_timeout / make_guess'e kalır.
    my_clock := (case when uid = m.player1 then m.clock1_ms else m.clock2_ms end)
                - _turn_elapsed_ms(m);
    if my_clock <= 0 then
      raise exception 'time_expired';
    end if;
  end if;

  -- (3) protokol bu oyuncunun maç başı seçtiklerinden mi (p1/p2_selected).
  select * into h from protocol_hands where match_id = m.id and player = uid;
  if not found or not (p_protocol_id = any(h.selected)) then
    raise exception 'protocol_not_selected';
  end if;

  -- (4)+(6) kullanım hakkı: one_shot ya da maç-başı (reset_per_round=false)
  -- → TÜM maç sayılır (turlar arası sıfırlanmaz); reset_per_round=true
  -- (gelecek) → yalnız bu turun kullanımı sayılır. Not: Zorla Harca'nın
  -- 'wasted' kayıtları da sayılır — harcanan protokol artık kullanılamaz.
  if proto.one_shot or not proto.reset_per_round then
    select count(*) into use_count
      from match_protocol_uses
     where match_id = m.id and player = uid and protocol_id = p_protocol_id;
  else
    select count(*) into use_count
      from match_protocol_uses
     where match_id = m.id and player = uid and protocol_id = p_protocol_id
       and round = m.current_round;
  end if;
  if use_count >= proto.uses_per_match then
    raise exception 'protocol_already_used';
  end if;

  -- ETKİ (sunucuda; 4d buraya yalnızca yeni dal ekler).
  if p_protocol_id = 'time_add' then
    extra := _protocol_time_add(m, uid);
  elsif p_protocol_id = 'info_eliminate' then
    extra := _protocol_info_eliminate(m, uid);
  elsif p_protocol_id = 'info_readlast' then
    extra := _protocol_info_readlast(m, uid);
  elsif p_protocol_id = 'info_postest' then
    extra := _protocol_info_postest(m, uid, p_payload);
  elsif p_protocol_id = 'info_reveal' then
    extra := _protocol_info_reveal(m, uid);
  elsif p_protocol_id = 'time_steal' then
    extra := _protocol_time_steal(m, uid);
  elsif p_protocol_id = 'time_freeze' then
    extra := _protocol_time_freeze(m, uid);
  elsif p_protocol_id = 'time_slow' then
    extra := _protocol_time_slow(m, uid);
  elsif p_protocol_id in ('disrupt_fog', 'disrupt_silence', 'disrupt_waste') then
    -- ENGEL sınıfı: counter zinciri tek kapıdan (yansıt > blokla > uygula).
    extra := _apply_obstacle(m, uid, p_protocol_id);
  elsif p_protocol_id = 'def_shield' then
    extra := _protocol_def_shield(m, uid);
  elsif p_protocol_id = 'def_reflect' then
    extra := _protocol_def_reflect(m, uid);
  else
    raise exception 'protocol_not_implemented';
  end if;

  -- Kullanımı kaydet (etkiyle aynı transaction). Etki "boşa gitti" derse
  -- (consumed=false — readlast'ta rakip tahminsiz / harcada hedef yok)
  -- hak HARCANMAZ: kayıt atılmaz, rakibe bildirim de gitmez.
  if coalesce((extra ->> 'consumed')::boolean, true) then
    insert into match_protocol_uses (match_id, player, protocol_id, round, outcome)
    values (m.id, uid, p_protocol_id, m.current_round,
            coalesce(extra ->> 'outcome', 'applied'));
  end if;

  return jsonb_build_object(
    'match_id', m.id,
    'protocol_id', p_protocol_id,
    'round', m.current_round) || coalesce(extra, '{}'::jsonb);
end;
$$;
revoke execute on function public.use_protocol(uuid, text, jsonb) from public, anon;
grant execute on function public.use_protocol(uuid, text, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) make_guess: sis tüketimi (tek tahmin) + tur bitiminde susturma temizliği
-- ════════════════════════════════════════════════════════════════════════════
-- (4b sürümü korunarak: tahmin satırına fogged işareti yazılır ve çağıranın
-- sis bayrağı söner; sıra rakibe geçerken çağıranın susturması da kalkar.)
create or replace function public.make_guess(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  opp uuid;
  my_clock int;
  my_fog boolean;
  opp_secret text;
  fb text;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'active' then
    raise exception 'match_not_active';
  end if;
  if m.current_turn <> uid then
    raise exception 'not_your_turn';
  end if;
  if not is_valid_secret(p_digits) then
    raise exception 'invalid_digits';
  end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;
  my_fog := case when uid = m.player1 then m.fog_p1 else m.fog_p2 end;

  my_clock := (case when uid = m.player1 then m.clock1_ms else m.clock2_ms end)
              - _turn_elapsed_ms(m);

  if my_clock <= 0 then
    -- Süre doldu: çağıran TURU kaybeder (round winner = rakip).
    perform 1 from matches where id = m.id for update;
    update matches
       set clock1_ms = case when uid = player1 then 0 else clock1_ms end,
           clock2_ms = case when uid = player2 then 0 else clock2_ms end
     where id = m.id;
    m := _advance_or_finish(m.id, opp, 'timeout');
    return jsonb_build_object(
      'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
      'feedback', null, 'current_turn', m.current_turn,
      'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
  end if;

  -- Rakibin O TURDAKİ gizli sayısı (yalnızca sunucuda).
  select digits into opp_secret
    from secrets where match_id = m.id and player = opp and round = m.current_round;
  if not found then
    raise exception 'opponent_secret_missing';
  end if;

  fb := evaluate_guess(opp_secret, p_digits);

  -- Sis Perdesi: bu tahmin gecikmeli GÖSTERİLİR (değerlendirme aynı; tek
  -- tahmin → bayrak söner).
  insert into guesses (match_id, guesser, digits, feedback, round, fogged)
  values (m.id, uid, p_digits, fb, m.current_round, my_fog);

  if fb = 'win' then
    -- Çağıran TURU kazandı; kalan süresini yaz (maç biterse anlamlı).
    perform 1 from matches where id = m.id for update;
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end
     where id = m.id;
    m := _advance_or_finish(m.id, uid, 'win');
  else
    -- Sıra rakibe geçer; çağıranın kalan süresi yazılır. Tur bitti: donma
    -- söner; çağıranın yavaşlatması, susturması ve sis bayrağı (tahmin
    -- tüketti) temizlenir.
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end,
           current_turn = opp,
           turn_started_at = now(),
           turn_frozen = false,
           turn_slow_p1 = case when uid = player1 then false else turn_slow_p1 end,
           turn_slow_p2 = case when uid = player2 then false else turn_slow_p2 end,
           silenced_p1 = case when uid = player1 then false else silenced_p1 end,
           silenced_p2 = case when uid = player2 then false else silenced_p2 end,
           fog_p1 = case when uid = player1 then false else fog_p1 end,
           fog_p2 = case when uid = player2 then false else fog_p2 end
     where id = m.id
     returning * into m;
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'feedback', fb, 'current_turn', m.current_turn,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms,
    'fogged', my_fog);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) _advance_or_finish: round/maç biterken TÜM etki bayrakları sıfırlanır
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._advance_or_finish(
  p_match_id uuid,
  p_round_winner uuid,
  p_result text
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  w1 int;
  w2 int;
  winner_wins int;
begin
  select * into m from matches where id = p_match_id;
  w1 := m.p1_round_wins + (case when p_round_winner = m.player1 then 1 else 0 end);
  w2 := m.p2_round_wins + (case when p_round_winner = m.player2 then 1 else 0 end);
  winner_wins := case when p_round_winner = m.player1 then w1 else w2 end;

  if winner_wins >= m.win_target then
    -- MAÇ bitti.
    update matches
       set status = 'finished',
           result = p_result,
           winner = p_round_winner,
           p1_round_wins = w1,
           p2_round_wins = w2,
           current_turn = null,
           turn_started_at = null,
           turn_frozen = false,
           turn_slow_p1 = false,
           turn_slow_p2 = false,
           silenced_p1 = false,
           silenced_p2 = false,
           fog_p1 = false,
           fog_p2 = false
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
  else
    -- Tur bitti, maç sürüyor: sonraki turun belirleme fazı. (Kurulu Kalkan/
    -- Yansıtma round'lar arası KORUNUR — maç boyu ilk engele kadar bekler.)
    update matches
       set p1_round_wins = w1,
           p2_round_wins = w2,
           current_round = current_round + 1,
           status = 'setup',
           setup_deadline = now() + interval '38 seconds',
           current_turn = null,
           turn_started_at = null,
           turn_frozen = false,
           turn_slow_p1 = false,
           turn_slow_p2 = false,
           silenced_p1 = false,
           silenced_p2 = false,
           fog_p1 = false,
           fog_p2 = false,
           player1_ready = false,
           player2_ready = false,
           clock1_ms = clock_ms,
           clock2_ms = clock_ms
     where id = m.id
     returning * into m;
  end if;
  return m;
end;
$$;
revoke execute on function public._advance_or_finish(uuid, uuid, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) get_my_hand: + kurulu savunmaların (yalnız kendi; şerit "AKTİF" durumu)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.get_my_hand(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  h public.protocol_hands;
  lvl int;
  has_hand boolean;
  my_uses jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Üyelik kontrolü KİLİTSİZ (salt okuma — read-only transaction'da güvenli).
  select * into m from matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if uid <> m.player1 and (m.player2 is null or uid <> m.player2) then
    raise exception 'not_a_player';
  end if;

  select level into lvl from profiles where id = uid;

  select * into h from protocol_hands where match_id = p_match_id and player = uid;
  has_hand := found; -- el satırı var mı (profil select'i değil)

  if not has_hand then
    return jsonb_build_object('hand', '[]'::jsonb, 'selected', '[]'::jsonb,
                              'slots', _protocol_slots(coalesce(lvl, 1)),
                              'uses', '[]'::jsonb, 'eliminations', '{}'::jsonb,
                              'hints', '{}'::jsonb,
                              'shield_armed', false, 'reflect_armed', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'protocol_id', u.protocol_id, 'round', u.round,
           'outcome', u.outcome) order by u.id), '[]'::jsonb)
    into my_uses
    from match_protocol_uses u
   where u.match_id = p_match_id and u.player = uid;

  return jsonb_build_object(
    'hand', coalesce(to_jsonb(h.hand), '[]'::jsonb),
    'selected', coalesce(to_jsonb(h.selected), '[]'::jsonb),
    'slots', _protocol_slots(coalesce(lvl, 1)),
    'uses', my_uses,
    'eliminations', coalesce(h.eliminations, '{}'::jsonb),
    'hints', coalesce(h.hints, '{}'::jsonb),
    'shield_armed', coalesce(h.shield_armed, false),
    'reflect_armed', coalesce(h.reflect_armed, false));
end;
$$;
revoke execute on function public.get_my_hand(uuid) from public, anon;
grant execute on function public.get_my_hand(uuid) to authenticated;

-- PostgREST şema önbelleğini tazele.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 9) Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - Kalkan: gelen engel bloklanır; Kalkan + engel TÜKENİR (hak harcanır);
--     outcome='blocked'.
--   - Yansıtma: engel gönderene döner; zincir BİR kez (gönderenin Kalkan/
--     Yansıtması yansıyana etki ETMEZ); outcome='reflected'. İkisi de
--     kuruluysa önce Yansıtma (Kalkan armed kalır).
--   - Susturma: hedef sıradaki turu bitene kadar use_protocol → 'silenced';
--     tur bitince kalkar. Susturma da engeldir → Kalkan/Yansıtma tepki verir.
--   - Zorla Harca: hedefin kullanılmamışlarından rastgele biri 'wasted'
--     (artık kullanılamaz); hedefsizse consumed=false (hak iade); YANSIMIŞ
--     harca hedefsizse iade YOK (sessizce söner).
--   - Sis: hedefin sonraki tahmini guesses.fogged=true ile işaretlenir,
--     bayrak söner; istemci 4 sn maskeleyerek gösterir (değerlendirme aynı).
--   - Tüm bayraklar tur/round/maç sınırında temizlenir; kurulu savunmalar
--     round'lar arası korunur.

