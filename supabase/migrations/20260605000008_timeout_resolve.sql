-- Online 1v1: süre bitince maç anında bitsin — claim_timeout yeniden yazımı
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Hata: aktif oyuncunun saati dolsa bile maç onun tahmin yapmasını bekliyordu;
-- yalnızca rakibin istemcisi (claim_timeout) tetikleyebiliyordu ve kazanan =
-- çağıran varsayılıyordu.
--
-- Çözüm: claim_timeout artık HER iki oyuncu tarafından da çağrılabilir.
--   * Kaybeden = current_turn (saati akıp dolan), kazanan = diğeri — çağıran
--     kim olursa olsun (timeout'a düşen kendi istemcisi tetiklese bile).
--   * clock_not_expired korunur: sunucu now() ile gerçekten dolmuş mu doğrular
--     (istemci görsel saatindeki drift'e güvenilmez).
--   * Idempotent: maç zaten aktif değilse hata fırlatmaz, mevcut sonucu döndürür
--     (iki istemcinin eşzamanlı / tekrar çağrısı güvenli).

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
  elapsed_ms int;
  remaining int;
begin
  m := _match_for_player(p_match_id);

  -- Idempotent: aktif değilse (zaten bitmiş/iptal) mevcut durumu döndür.
  if m.status <> 'active' then
    return jsonb_build_object(
      'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
      'current_turn', m.current_turn, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
  end if;

  -- Süresi akan taraf = current_turn. Gerçekten dolmuş mu sunucu zamanıyla kontrol.
  elapsed_ms := floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  remaining := (case when m.current_turn = m.player1 then m.clock1_ms else m.clock2_ms end)
               - elapsed_ms;
  if remaining > 0 then
    raise exception 'clock_not_expired';
  end if;

  -- Kaybeden = saati dolan (current_turn), kazanan = diğeri. Çağırandan BAĞIMSIZ.
  loser := m.current_turn;
  win := case when loser = m.player1 then m.player2 else m.player1 end;

  update matches
     set status = 'finished',
         result = 'timeout',
         winner = win,
         clock1_ms = case when loser = player1 then 0 else clock1_ms end,
         clock2_ms = case when loser = player2 then 0 else clock2_ms end,
         current_turn = null,
         turn_started_at = null
   where id = m.id
   returning * into m;

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'current_turn', null, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;

-- Grant migration 2'de verildi; create or replace bunu korur.

-- Doğrulama (panelde elle denenebilir) ------------------------------------------
--   -- Sıradaki oyuncunun süresini geriye çek (postgres rolüyle, test amaçlı):
--   update public.matches set turn_started_at = now() - interval '2 minutes'
--     where id = 'MATCH_ID';
--   -- Saati DOLAN oyuncunun KENDİ istemcisi çağırsa bile kazanan diğeri olmalı:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"SIRASI_GELEN_USER"}';
--   select claim_timeout('MATCH_ID');   -- finished, result=timeout, winner=DİĞERİ
--   select claim_timeout('MATCH_ID');   -- idempotent: aynı sonucu döndürür (hata yok)
