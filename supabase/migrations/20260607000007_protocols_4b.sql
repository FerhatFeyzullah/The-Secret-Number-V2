-- Faz 3 / Adım 4b: Bilgi + Zaman protokolleri (6 etki)
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- 4a'daki use_protocol iskeletine 6 etki bağlanır:
--   Bilgi: info_readlast (rakibin son tahmini+feedback'i), info_postest
--          (rakam+pozisyon evet/hayır), info_reveal (sayıdaki bir rakam; oneShot)
--   Zaman: time_steal (rakipten 10sn al; rakip 5sn altına İNEMEZ),
--          time_freeze (bu turda KENDİ saatin durur), time_slow (rakibin
--          sonraki turu 1.5× akar; TEK tur)
-- Tüm doğrulama + etki + hak + floor sunucuda; istemci yalnız tetikler.
--
-- Gizlilik: bilgi protokolleri yalnız izin verilen kısmı döndürür — gizli
-- sayının tamamı HİÇBİR alanda dönmez; pozisyon sızdırma kuralları korunur
-- (readlast feedback'i rakibin zaten aldığı feedback'tir; postest tek
-- pozisyon için evet/hayır; reveal pozisyonsuz tek rakam). Sonuçlar yalnız
-- çağıranın protocol_hands.hints satırına yazılır (RLS kendi satırı).
--
-- Saat modeli: turn_frozen (mevcut turun oyuncusunun saati işlemez) +
-- turn_slow_p1/p2 (o oyuncunun SIRADAKİ/mevcut turu 1.5× akar; turu bitince
-- söner). Efektif geçen süre TEK yerden: _turn_elapsed_ms — make_guess,
-- claim_timeout ve use_protocol aynı hesabı kullanır. Tur/round geçişlerinde
-- bayraklar sıfırlanır (kalıcılaşamaz). Kolonlar sır içermez; istemci görsel
-- saat için okur (matches realtime'ı zaten oyunculara açık).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ŞEMA: saat bayrakları + ipuçları
-- ════════════════════════════════════════════════════════════════════════════
alter table public.matches
  add column if not exists turn_frozen boolean not null default false;
alter table public.matches
  add column if not exists turn_slow_p1 boolean not null default false;
alter table public.matches
  add column if not exists turn_slow_p2 boolean not null default false;

-- Bilgi protokolü sonuçları (tur → ipucu listesi); yalnız çağıranın satırı.
-- Örn: {"1": [{"t":"reveal","digit":4}, {"t":"postest","digit":5,"pos":2,"match":false}]}
alter table public.protocol_hands
  add column if not exists hints jsonb not null default '{}';

-- Katalog: time_freeze kendi sıranda kullanılır (4a'daki geçici 'anytime'
-- değeri etkiyle birlikte kesinleşti — catalog.ts ile bire bir).
update public.protocols set usage_timing = 'own_turn' where id = 'time_freeze';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) _turn_elapsed_ms: efektif geçen süre (donma + yavaşlatma TEK yerden)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._turn_elapsed_ms(m public.matches)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base int;
  slowed boolean;
begin
  if m.turn_started_at is null or m.current_turn is null then
    return 0;
  end if;
  -- Dondurulmuş tur: turn_started_at donma anına çekilmiştir; o andan beri
  -- süre İŞLEMEZ (öncesi donma anında saatten düşüldü).
  if m.turn_frozen then
    return 0;
  end if;
  base := floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  slowed := case when m.current_turn = m.player1 then m.turn_slow_p1 else m.turn_slow_p2 end;
  if slowed then
    base := floor(base * 1.5)::int;
  end if;
  return greatest(0, base);
end;
$$;
revoke execute on function public._turn_elapsed_ms(public.matches) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) İpucu kaydı yardımcısı (yalnız çağıranın satırına; RLS rakibe kapalı)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._add_hint(
  p_match_id uuid, p_player uuid, p_round int, p_hint jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  update protocol_hands
     set hints = jsonb_set(
           hints, array[p_round::text],
           coalesce(hints -> p_round::text, '[]'::jsonb) || p_hint, true)
   where match_id = p_match_id and player = p_player;
end;
$$;
revoke execute on function public._add_hint(uuid, uuid, int, jsonb) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) BİLGİ etkileri
-- ════════════════════════════════════════════════════════════════════════════
-- Rakip Okuması: rakibin BU TURDAKİ son tahmini + aldığı feedback (rakibin
-- zaten gördüğü bilgi — ekstra sızdırma yok). Rakip henüz tahmin yapmadıysa
-- hak HARCANMAZ (consumed=false; use_protocol kayıt atmaz).
create or replace function public._protocol_info_readlast(p_match public.matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  opp uuid;
  g record;
begin
  opp := case when p_uid = p_match.player1 then p_match.player2 else p_match.player1 end;
  select digits, feedback into g
    from guesses
   where match_id = p_match.id and guesser = opp and round = p_match.current_round
   order by id desc
   limit 1;
  if not found then
    return jsonb_build_object('consumed', false, 'no_guess', true);
  end if;
  perform _add_hint(p_match.id, p_uid, p_match.current_round,
    jsonb_build_object('t', 'readlast', 'digits', g.digits, 'feedback', g.feedback));
  return jsonb_build_object('digits', g.digits, 'feedback', g.feedback);
end;
$$;
revoke execute on function public._protocol_info_readlast(public.matches, uuid) from public, anon, authenticated;

-- Konum Testi: payload {digit, position} — rakibin BU TURDAKİ sayısında o
-- rakam o pozisyonda mı, YALNIZ evet/hayır. Tahmin hakkı harcanmaz (guesses'a
-- yazılmaz). Payload doğrulaması sunucuda (rakam 1-9, pozisyon 1-3).
create or replace function public._protocol_info_postest(
  p_match public.matches, p_uid uuid, p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d text;
  pos text;
  opp uuid;
  opp_secret text;
  hit boolean;
begin
  d := p_payload ->> 'digit';
  pos := p_payload ->> 'position';
  if p_payload is null or d is null or pos is null
     or d !~ '^[1-9]$' or pos !~ '^[1-3]$' then
    raise exception 'invalid_payload';
  end if;

  opp := case when p_uid = p_match.player1 then p_match.player2 else p_match.player1 end;
  select digits into opp_secret
    from secrets
   where match_id = p_match.id and player = opp and round = p_match.current_round;
  if not found then
    raise exception 'opponent_secret_missing';
  end if;

  hit := substring(opp_secret, pos::int, 1) = d;
  perform _add_hint(p_match.id, p_uid, p_match.current_round,
    jsonb_build_object('t', 'postest', 'digit', d::int, 'pos', pos::int, 'match', hit));
  return jsonb_build_object('digit', d::int, 'position', pos::int, 'match', hit);
end;
$$;
revoke execute on function public._protocol_info_postest(public.matches, uuid, jsonb) from public, anon, authenticated;

-- Sayı İşareti (oneShot): rakibin BU TURDAKİ sayısındaki rakamlardan birini
-- rastgele açar — POZİSYONSUZ tek rakam; sayının tamamı asla dönmez.
create or replace function public._protocol_info_reveal(p_match public.matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  opp uuid;
  opp_secret text;
  pick int;
begin
  opp := case when p_uid = p_match.player1 then p_match.player2 else p_match.player1 end;
  select digits into opp_secret
    from secrets
   where match_id = p_match.id and player = opp and round = p_match.current_round;
  if not found then
    raise exception 'opponent_secret_missing';
  end if;

  pick := substring(opp_secret, 1 + floor(random() * 3)::int, 1)::int;
  perform _add_hint(p_match.id, p_uid, p_match.current_round,
    jsonb_build_object('t', 'reveal', 'digit', pick));
  return jsonb_build_object('revealed_digit', pick);
end;
$$;
revoke execute on function public._protocol_info_reveal(public.matches, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) ZAMAN etkileri
-- ════════════════════════════════════════════════════════════════════════════
-- Saat Çalma: rakipten 10sn al, kendine ekle. FLOOR: rakip 5000 ms altına
-- İNEMEZ — eksiği kadar az çalınır (aldığın kadar eklenir). Maç bitiremez.
create or replace function public._protocol_time_steal(p_match public.matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  opp uuid;
  opp_clock int;
  steal int;
  m public.matches;
begin
  opp := case when p_uid = p_match.player1 then p_match.player2 else p_match.player1 end;
  -- Rakibin saati kendi sıranda AKMAZ → saklı değer günceldir.
  opp_clock := case when opp = p_match.player1 then p_match.clock1_ms else p_match.clock2_ms end;
  steal := least(10000, greatest(0, opp_clock - 5000));

  update matches
     set clock1_ms = clock1_ms
           + case when p_uid = player1 then steal when opp = player1 then -steal else 0 end,
         clock2_ms = clock2_ms
           + case when p_uid = player2 then steal when opp = player2 then -steal else 0 end
   where id = p_match.id
   returning * into m;

  return jsonb_build_object(
    'stolen_ms', steal, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;
revoke execute on function public._protocol_time_steal(public.matches, uuid) from public, anon, authenticated;

-- Dondur: İÇİNDE BULUNDUĞUN turda kendi saatin işlemez. O ana kadar akan
-- süre (yavaşlatma çarpanı dahil) saatten düşülür, sayaç şimdiye çekilir ve
-- tur dondurulur; tur bitince normale döner (make_guess/_advance temizler).
create or replace function public._protocol_time_freeze(p_match public.matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  elapsed int;
  m public.matches;
begin
  elapsed := _turn_elapsed_ms(p_match);
  update matches
     set clock1_ms = clock1_ms - case when p_uid = player1 then elapsed else 0 end,
         clock2_ms = clock2_ms - case when p_uid = player2 then elapsed else 0 end,
         turn_started_at = now(),
         turn_frozen = true
   where id = p_match.id
   returning * into m;
  return jsonb_build_object(
    'frozen', true, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;
revoke execute on function public._protocol_time_freeze(public.matches, uuid) from public, anon, authenticated;

-- Yavaşlat: rakibin SIRADAKİ turunda saati 1.5× akar; o tur bitince söner
-- (TEK tur — make_guess turu bitirirken, round geçişi _advance'te temizler).
create or replace function public._protocol_time_slow(p_match public.matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  opp uuid;
begin
  opp := case when p_uid = p_match.player1 then p_match.player2 else p_match.player1 end;
  update matches
     set turn_slow_p1 = turn_slow_p1 or (opp = player1),
         turn_slow_p2 = turn_slow_p2 or (opp = player2)
   where id = p_match.id;
  return jsonb_build_object('slowed', true);
end;
$$;
revoke execute on function public._protocol_time_slow(public.matches, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) use_protocol: yeni dallar + efektif süre + "hak iadesi" (consumed=false)
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
  -- (gelecek) → yalnız bu turun kullanımı sayılır.
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

  -- ETKİ (sunucuda; 4c/4d buraya yalnızca yeni dal ekler).
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
  else
    raise exception 'protocol_not_implemented';
  end if;

  -- Kullanımı kaydet (etkiyle aynı transaction). Etki "boşa gitti" derse
  -- (consumed=false — örn. Rakip Okuması'nda rakip henüz tahmin yapmadı)
  -- hak HARCANMAZ: kayıt atılmaz, rakibe bildirim de gitmez.
  if coalesce((extra ->> 'consumed')::boolean, true) then
    insert into match_protocol_uses (match_id, player, protocol_id, round)
    values (m.id, uid, p_protocol_id, m.current_round);
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
-- 7) make_guess: efektif süre + tur bitiminde donma/yavaşlatma temizliği
-- ════════════════════════════════════════════════════════════════════════════
-- (20260607000003 sürümü korunarak: elapsed artık _turn_elapsed_ms'ten gelir;
-- sıra rakibe geçerken turn_frozen söner ve TURU BİTEN oyuncunun yavaşlatması
-- temizlenir — rakip için bekleyen yavaşlatma korunur.)
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

  insert into guesses (match_id, guesser, digits, feedback, round)
  values (m.id, uid, p_digits, fb, m.current_round);

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
    -- söner; çağıranın (turu bitenin) yavaşlatması temizlenir.
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end,
           current_turn = opp,
           turn_started_at = now(),
           turn_frozen = false,
           turn_slow_p1 = case when uid = player1 then false else turn_slow_p1 end,
           turn_slow_p2 = case when uid = player2 then false else turn_slow_p2 end
     where id = m.id
     returning * into m;
  end if;

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'feedback', fb, 'current_turn', m.current_turn,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) claim_timeout: efektif süre (donmuş tur ASLA timeout olmaz)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.claim_timeout(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  loser uuid;
  win uuid;
  remaining int;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'active' then
    return jsonb_build_object(
      'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
      'current_turn', m.current_turn, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
  end if;

  remaining := (case when m.current_turn = m.player1 then m.clock1_ms else m.clock2_ms end)
               - _turn_elapsed_ms(m);
  if remaining > 0 then
    raise exception 'clock_not_expired';
  end if;

  loser := m.current_turn;
  win := case when loser = m.player1 then m.player2 else m.player1 end;

  perform 1 from matches where id = m.id for update;
  update matches
     set clock1_ms = case when loser = player1 then 0 else clock1_ms end,
         clock2_ms = case when loser = player2 then 0 else clock2_ms end
   where id = m.id;
  m := _advance_or_finish(m.id, win, 'timeout');

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'current_turn', m.current_turn, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) _advance_or_finish: tur/maç biterken saat bayrakları sıfırlanır
-- ════════════════════════════════════════════════════════════════════════════
-- (20260607000003 sürümü korunarak yalnızca turn_frozen/turn_slow_* sıfırlama
-- eklendi — etkiler round/maç sınırını ASLA aşamaz.)
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
           turn_slow_p2 = false
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
  else
    -- Tur bitti, maç sürüyor: sonraki turun belirleme fazı.
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
-- 10) get_my_hand: + hints (yalnız çağıranın; rakibinki RLS ile zaten kapalı)
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
                              'hints', '{}'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'protocol_id', u.protocol_id, 'round', u.round) order by u.id), '[]'::jsonb)
    into my_uses
    from match_protocol_uses u
   where u.match_id = p_match_id and u.player = uid;

  return jsonb_build_object(
    'hand', coalesce(to_jsonb(h.hand), '[]'::jsonb),
    'selected', coalesce(to_jsonb(h.selected), '[]'::jsonb),
    'slots', _protocol_slots(coalesce(lvl, 1)),
    'uses', my_uses,
    'eliminations', coalesce(h.eliminations, '{}'::jsonb),
    'hints', coalesce(h.hints, '{}'::jsonb));
end;
$$;
revoke execute on function public.get_my_hand(uuid) from public, anon;
grant execute on function public.get_my_hand(uuid) to authenticated;

-- PostgREST şema önbelleğini tazele.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 11) Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - info_readlast: rakip tahminsizken consumed=false → hak harcanmaz, kayıt
--     atılmaz; tahmin varken son tahmin+feedback (yalnız çağırana).
--   - info_postest: invalid payload reddi; tek pozisyon evet/hayır; tahmin
--     hakkı harcanmaz (guesses'a yazılmaz).
--   - info_reveal: dönen rakam gizli sayıda VAR; sayının tamamı dönmez.
--   - time_steal: rakip 5000 ms altına inemez (7sn → 2sn çalınır; ≤5sn → 0).
--   - time_freeze: o ana dek akan süre düşülür, kalan tur boyunca saat
--     işlemez (claim_timeout da işletemez); tur bitince söner.
--   - time_slow: rakibin SIRADAKİ turunda elapsed ×1.5; o tur bitince söner;
--     round geçişinde tüm bayraklar sıfırlanır.
--   - Hepsi maç başına 1; turlar arası sıfırlanmaz.
