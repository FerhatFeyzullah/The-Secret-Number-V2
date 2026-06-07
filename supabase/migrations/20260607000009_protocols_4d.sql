-- Faz 3 / Adım 4d: Yanıltma (disrupt_deceive) — sahte geri bildirim
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Son protokol: hedefin BİR SONRAKİ tahmininin geri bildirimi +1 şişirilir
-- (yalnız GÖSTERİM). Tek tahmin etkili. Engel sınıfındandır → 4c counter
-- zincirine tabidir (Kalkan bloklar, Yansıtma gönderene çevirir — yansıyan
-- Yanıltma artık GÖNDERENİN sonraki tahminini şişirir; zincir BİR kez).
--
-- GÜVENLİK (kritik):
--   * Değerlendirme SUNUCU-OTORİTELİ kalır: make_guess GERÇEK sonucu hesaplar;
--     kazanma/tur kararı GERÇEK değere göre verilir. Gizli sayı ve gerçek
--     değerlendirme ASLA istemciye inmez.
--   * Şişirme YALNIZCA partial fazında: partial:0→partial:1, partial:1→partial:2.
--     Gerçek sonuç win / digits_correct_wrong_order / partial:2 ise şişirme
--     YAPILMAZ (kazanma ve kırılma eşiği sahtelenmez; partial:2+1 = "3 doğru"
--     eşiğe ulaşırdı) → gerçek gösterilir.
--   * guesses.feedback'e GÖSTERİLEN değer yazılır: kurbanın istemcisine
--     (RPC dönüşü + realtime satırı + refresh) gerçek değer hiçbir kanaldan
--     gitmez. Tur kararını etkileyen durumlarda (win/dcwo/partial:2) gösterilen
--     = gerçek olduğundan oyun kaydı tutarlıdır; Rakip Okuması da "rakibin
--     GÖRDÜĞÜ feedback'i" döndürmeye devam eder (tutarlı yanıltma).
--   * Satırda "şişirildi" işareti YOK — kurban hangi geri bildirimin sahte
--     olduğunu veriden okuyamaz ("Yanıltma kullanıldı" bildirimi yeterli
--     belirsizliği bırakır: gösterilen partial:N gerçek N ya da N-1 olabilir).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ŞEMA + KATALOG
-- ════════════════════════════════════════════════════════════════════════════
-- Yanıltma bekliyor: o oyuncunun SONRAKİ tahmini +1 şişirilerek gösterilir.
alter table public.matches
  add column if not exists deceived_p1 boolean not null default false;
alter table public.matches
  add column if not exists deceived_p2 boolean not null default false;

-- Katalog: Yanıltma anytime engel (etkiyle birlikte kesinleşti — catalog.ts
-- ile bire bir; 14 protokolün tamamı artık uygulanmış durumda).
update public.protocols set usage_timing = 'anytime' where id = 'disrupt_deceive';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Yanıltma etkisi (hedef parametreli — yansımada hedef gönderen olur)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._obstacle_deceive(p_match public.matches, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update matches
     set deceived_p1 = deceived_p1 or (p_target = player1),
         deceived_p2 = deceived_p2 or (p_target = player2)
   where id = p_match.id;
  return '{}'::jsonb;
end;
$$;
revoke execute on function public._obstacle_deceive(public.matches, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) _apply_obstacle: Yanıltma dalı eklendi (counter zinciri AYNEN — 4c)
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
    elsif p_protocol_id = 'disrupt_deceive' then
      detail := _obstacle_deceive(p_match, target);
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
-- 4) use_protocol: disrupt_deceive engel kapısına yönlendirilir
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

  -- ETKİ (sunucuda) — 14 protokolün tamamı bağlı.
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
  elsif p_protocol_id in ('disrupt_fog', 'disrupt_silence', 'disrupt_waste', 'disrupt_deceive') then
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
-- 5) make_guess: Yanıltma gösterimi (GERÇEK değerle ilerleme) + bayrak tüketimi
-- ════════════════════════════════════════════════════════════════════════════
-- (4c sürümü korunarak: fb GERÇEK hesaplanır; kazanma kararı GERÇEK fb ile;
-- yanıltılmış çağıranın partial:0/1 sonucu +1 gösterilir ve guesses'a
-- GÖSTERİLEN değer yazılır — kurbanın istemcisine gerçek değer inmez. Bayrak
-- tahminle tüketilir; tur bitiminde diğer bayraklarla birlikte de temizlenir.)
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
  my_deceive boolean;
  opp_secret text;
  fb text;
  display_fb text;
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
  my_deceive := case when uid = m.player1 then m.deceived_p1 else m.deceived_p2 end;

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

  fb := evaluate_guess(opp_secret, p_digits); -- GERÇEK (otorite)

  -- Yanıltma: YALNIZ partial:0/1 bir kademe şişirilir; win / dcwo / partial:2
  -- sahtelenmez (kazanma ve kırılma eşiği gerçek kalır). Tek tahmin: bayrak
  -- şişirme yapılmasa bile tüketilir.
  display_fb := fb;
  if my_deceive then
    if fb = 'partial:0' then
      display_fb := 'partial:1';
    elsif fb = 'partial:1' then
      display_fb := 'partial:2';
    end if;
  end if;

  -- Satıra GÖSTERİLEN değer yazılır (kurbanın istemcisine gerçek inmez;
  -- şişirme işareti de yok — hangi feedback'in sahte olduğu okunamaz).
  insert into guesses (match_id, guesser, digits, feedback, round, fogged)
  values (m.id, uid, p_digits, display_fb, m.current_round, my_fog);

  if fb = 'win' then
    -- Çağıran TURU kazandı (GERÇEK değere göre); kalan süresini yaz.
    perform 1 from matches where id = m.id for update;
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end
     where id = m.id;
    m := _advance_or_finish(m.id, uid, 'win');
  else
    -- Sıra rakibe geçer; çağıranın kalan süresi yazılır. Tur bitti: donma
    -- söner; çağıranın yavaşlatması/susturması temizlenir; sis ve yanıltma
    -- bu tahminle tüketildi.
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
           fog_p2 = case when uid = player2 then false else fog_p2 end,
           deceived_p1 = case when uid = player1 then false else deceived_p1 end,
           deceived_p2 = case when uid = player2 then false else deceived_p2 end
     where id = m.id
     returning * into m;
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'feedback', display_fb, 'current_turn', m.current_turn,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms,
    'fogged', my_fog);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) _advance_or_finish: yanıltma bayrakları da round/maç sınırında temizlenir
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
           fog_p2 = false,
           deceived_p1 = false,
           deceived_p2 = false
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
           deceived_p1 = false,
           deceived_p2 = false,
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

-- PostgREST şema önbelleğini tazele.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - Yanıltılmış tahmin: gerçek partial:0 → partial:1 gösterilir; gerçek
--     partial:1 → partial:2. Gerçek win / dcwo / partial:2 → AYNEN (eşik/
--     kazanma sahtelenmez). Bayrak şişirilmese de tahminle tükenir.
--   - Oyun GERÇEK değere göre ilerler: yanıltılmış 'win' yine turu bitirir;
--     şişirilmiş partial maç durumunu değiştirmez.
--   - Counter: Kalkan Yanıltma'yı bloklar (şişirme yok, ikisi tükenir);
--     Yansıtma gönderene çevirir (GÖNDERENİN sonraki tahmini şişer; zincir
--     bir kez); susturulmuş oyuncu Yanıltma kullanamaz.
--   - guesses satırında ve hiçbir RPC dönüşünde gerçek değerlendirme ya da
--     "şişirildi" işareti yoktur.
