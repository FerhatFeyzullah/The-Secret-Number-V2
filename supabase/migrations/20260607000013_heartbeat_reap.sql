-- Faz 4 / Yaşam döngüsü Katman 2: heartbeat ile otomatik temizlik (reap)
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- SORUN: Uygulama çökmesi / telefon kapanması / internet kesilmesi durumunda
-- istemci leave_match'i HİÇ çağıramaz; sunucuda otomatik temizlik olmadığı için
-- karşı taraf ölü maçta bekler. ÇÖZÜM: hayatta olan oyuncunun periyodik
-- heartbeat'i, rakibin presence'ı 15 sn+ eskiyse maçı çağıran (hayatta olan)
-- LEHİNE kapatır. Cron yok — her ~5 sn'de hayatta olan, ölüyü reap eder.
--
-- False-positive koruması: reap YALNIZCA (rakip 15 sn+ sessiz) VE (çağıran az önce
-- kendi heartbeat'ini attı = canlı) iken. Karar kilitli helper'da yeniden doğrulanır
-- (_match_for_player deseni: FOR UPDATE → yarışsız; iki taraf aynı anda reap etmez).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) _reap_if_opponent_stale: rakip sessizse maçı çağıran lehine kapat (kilitli)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._reap_if_opponent_stale(p_match_id uuid, p_caller uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  opp uuid;
  opp_stale timestamptz;
begin
  -- Kilit + yeniden doğrula (yarışsız).
  select * into m from matches where id = p_match_id for update;
  if not found then
    return;
  end if;
  -- Yalnız CANLI maç reap edilir (bitmiş/iptal → no-op).
  if m.status not in ('protocol_select', 'setup', 'active') then
    return;
  end if;
  if p_caller <> m.player1 and (m.player2 is null or p_caller <> m.player2) then
    return;
  end if;
  opp := case when p_caller = m.player1 then m.player2 else m.player1 end;
  if opp is null then
    return;
  end if;

  -- Rakibin canlılığı: kopuş bildirildiyse o an, yoksa son heartbeat.
  select coalesce(disconnected_at, last_seen) into opp_stale
    from presence where match_id = p_match_id and player = opp;
  -- Presence yoksa (hiç heartbeat atmadı) reap ETME — belirsiz; deadline'lar halleder.
  if opp_stale is null or now() - opp_stale < interval '15 seconds' then
    return;
  end if;

  -- Rakip 15 sn+ sessiz → maçı ÇAĞIRAN (hayatta olan) lehine kapat.
  if m.status = 'active' or (m.status = 'setup' and m.current_round > 1) then
    -- Maç başladı / turlar arası: hükmen kayıp (forfeit), hayatta olan kazanır.
    update matches
       set status = 'finished', result = 'forfeit', winner = p_caller,
           current_turn = null, turn_started_at = null
     where id = m.id
     returning * into m;
    perform _apply_rating(m);
  else
    -- Ön-oyun (protocol_select / setup tur 1): iptal (kazanan yok).
    update matches
       set status = 'cancelled', result = 'cancelled',
           current_turn = null, turn_started_at = null
     where id = m.id;
  end if;
end;
$$;
revoke execute on function public._reap_if_opponent_stale(uuid, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) heartbeat: kendi presence'ını güncelle + rakip eskiyse reap (piggyback)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.heartbeat(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m_status text;
  m_p1 uuid;
  m_p2 uuid;
  opp uuid;
  opp_stale timestamptz;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if not is_match_player(p_match_id) then
    raise exception 'not_a_player';
  end if;

  -- Kendi canlılığını bildir (çağıran artık KESİN canlı).
  insert into presence (match_id, player, last_seen, disconnected_at)
  values (p_match_id, uid, now(), null)
  on conflict (match_id, player)
    do update set last_seen = now(), disconnected_at = null;

  -- Reap ön-kontrolü (kilitsiz, ucuz): maç canlı + rakip 15 sn+ sessiz mi?
  -- Öyleyse kilitli helper'da yeniden doğrulanıp maç hayatta olan lehine kapatılır.
  select status, player1, player2 into m_status, m_p1, m_p2
    from matches where id = p_match_id;
  if found and m_status in ('protocol_select', 'setup', 'active') then
    opp := case when uid = m_p1 then m_p2 else m_p1 end;
    if opp is not null then
      select coalesce(disconnected_at, last_seen) into opp_stale
        from presence where match_id = p_match_id and player = opp;
      if opp_stale is not null and now() - opp_stale >= interval '15 seconds' then
        perform _reap_if_opponent_stale(p_match_id, uid);
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.heartbeat(uuid) from public, anon;
grant execute on function public.heartbeat(uuid) to authenticated;

-- PostgREST şema önbelleğini tazele.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Doğrulama (docker/panel)
-- ════════════════════════════════════════════════════════════════════════════
--   - active maçta rakibin presence.last_seen 15 sn+ eski → hayatta olanın
--     heartbeat'i → status=finished, result=forfeit, winner=hayatta olan.
--   - protocol_select/setup(tur1) → status=cancelled.
--   - rakip 15 sn içinde heartbeat attıysa reap YOK (false-positive yok).
--   - presence satırı yoksa reap YOK.
