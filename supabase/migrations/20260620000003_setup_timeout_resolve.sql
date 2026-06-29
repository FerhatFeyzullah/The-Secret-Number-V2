-- Tur-arası (Bo3, round ≥ 2) belirleme zaman aşımının ADİL ve OTORİTELİ çözümü.
--
-- AÇIK (RAPOR-kelime-modu-mac-yasam-dongusu.md): 1. tur belirleme idle'ını
-- istemci cancel_setup_timeout ile iptal ediyordu; ama 2./3. tur belirleme
-- (status='setup', current_round > 1) zaman aşımını çözen TARAF YOKTU:
--   • cancel_setup_timeout round ayrımı yapmadan TÜM maçı iptal eder ve yalnız
--     1. tur route ekranından çağrılır; düello-içi tur geçişinde çağıran yok.
--   • _advance_or_finish tur arası setup_deadline = now()+68/38 sn verir ama
--     süresi dolunca bunu çözecek bir mekanizma yoktur.
--   • Sonuç: skor 1-0 iken geride olan oyuncu sırrını GİRMEYİP uygulamayı
--     ÖNDE tutarsa (heartbeat atıp set_secret yapmazsa) maç setup'ta KİLİTLENİR;
--     lider ya sonsuza dek bekler ya da çıkmak (leave_match → forfeit) zorunda
--     kalır → OYALAYAN (geride olan) taraf hükmen kazanır. İstismara açık.
--
-- ÇÖZÜM: claim_timeout / resolve_protocol_select gibi İDEMPOTENT bir sunucu
-- kararı. Her iki istemci de yerel setup sayacı 0'a inince çağırır; karar
-- sunucuda now() ile doğrulanır (çağıran kim olursa olsun aynı sonuç):
--   • Tek taraf sırrını girdiyse → O OYUNCU TURU KAZANIR (_advance_or_finish;
--     oyalama ÖDÜLLENMEZ). Maç biterse result='timeout' (mevcut CHECK'e uyar).
--   • İki taraf da girmediyse → maç İPTAL (kazanan yok) — adil.
--   (İki taraf da girdiyse set_secret zaten 'active'e geçirdiğinden buraya
--    düşülmez.)
--
-- KAPSAM: word Bo3 + number/protokol Bo3 (mod'dan bağımsız; win_target/round
-- üzerinden dallanır). Tek-tur number quick'te current_round hep 1 → no-op
-- (not_inter_round). 1. tur setup (current_round = 1) DEĞİŞMEZ: route ekranı
-- cancel_setup_timeout ile iptal etmeye devam eder (maç henüz başlamadı;
-- kazanan yok adildir, lider yok → istismar yok).

create or replace function public.resolve_setup_timeout(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  p1_has boolean;
  p2_has boolean;
  win uuid;
begin
  m := _match_for_player(p_match_id);

  -- Yalnız tur-arası (round > 1) belirleme; 1. tur cancel_setup_timeout'a ait.
  if m.status <> 'setup' then
    return jsonb_build_object('match_id', m.id, 'status', m.status,
                              'result', m.result, 'winner', m.winner);
  end if;
  if m.current_round <= 1 then
    raise exception 'not_inter_round';
  end if;
  if m.setup_deadline is null or now() <= m.setup_deadline then
    raise exception 'setup_not_expired';
  end if;

  -- Maç satırını kilitle ve KİLİT ALTINDA durumu yeniden oku: iki istemcinin
  -- yarışı serileşir → ikinci çağrı çift _advance_or_finish yapmaz (idempotent).
  perform 1 from matches where id = m.id for update;
  select * into m from matches where id = m.id;
  if m.status <> 'setup' or m.current_round <= 1 then
    return jsonb_build_object('match_id', m.id, 'status', m.status,
                              'result', m.result, 'winner', m.winner);
  end if;
  if m.setup_deadline is null or now() <= m.setup_deadline then
    -- Başka istemci yeni turu açtı (taze deadline) → bu çağrı erken; istemci
    -- yeni deadline'da tekrar dener.
    raise exception 'setup_not_expired';
  end if;

  -- Bu turda kim sırrını girdi? set_secret deadline sonrası INSERT'i reddeder,
  -- bu yüzden sayım deadline'da donmuştur → karar deterministik.
  select bool_or(player = m.player1), bool_or(player = m.player2)
    into p1_has, p2_has
    from secrets where match_id = m.id and round = m.current_round;
  p1_has := coalesce(p1_has, false);
  p2_has := coalesce(p2_has, false);

  if p1_has and not p2_has then
    win := m.player1;
  elsif p2_has and not p1_has then
    win := m.player2;
  else
    -- İki taraf da girmedi → adil iptal (kazanan yok). (İkisi de girseydi
    -- set_secret zaten active'e geçirmiş olurdu; buraya düşmez.)
    update matches
       set status = 'cancelled', result = 'cancelled',
           current_turn = null, turn_started_at = null
     where id = m.id
     returning * into m;
    return jsonb_build_object('match_id', m.id, 'status', m.status,
                              'result', m.result, 'winner', m.winner);
  end if;

  -- Sırrını giren oyuncu TURU kazanır; _advance_or_finish skoru ilerletir ve
  -- maç bittiyse result='timeout' + rating uygular (oyalama ödüllenmez).
  m := _advance_or_finish(m.id, win, 'timeout');
  return jsonb_build_object('match_id', m.id, 'status', m.status,
                            'result', m.result, 'winner', m.winner);
end;
$$;

revoke execute on function public.resolve_setup_timeout(uuid) from public, anon;
grant execute on function public.resolve_setup_timeout(uuid) to authenticated;

-- PostgREST şema önbelleğini tazele.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - round 1 setup → not_inter_round (eski cancel_setup_timeout korunur).
--   - round > 1, deadline dolmadan → setup_not_expired (drift → istemci tekrar).
--   - round > 1, deadline doldu, yalnız P1 secret → P1 turu kazanır (skor +1).
--   - round > 1, deadline doldu, hiç secret yok → maç cancelled.
--   - İki istemci aynı anda çağırırsa: kilit + kilit-altı yeniden okuma →
--     yalnız ilki ilerletir, ikincisi güncel state'i döner (çift sayım yok).
--   - Single-tur number quick (current_round=1) → no-op.
