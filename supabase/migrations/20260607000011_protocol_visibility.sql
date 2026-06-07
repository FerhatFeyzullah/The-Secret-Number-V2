-- Faz 3 / Düzeltme: protokol bildirimlerinde "gözlemlenebilir etki" kuralı
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- KURAL: Bir protokolün kullanımı rakibe YALNIZCA rakipte o an somut/gözlemlenebilir
-- bir etki yaratıyorsa bildirilir. Gizli/gecikmeli/yalnız-kullanana etki eden
-- protokoller rakibe HİÇBİR kanaldan (realtime payload + state + refresh) gitmez.
--
-- Gözlemlenebilir (rakip görür): Saat Çalma, Yavaşlat, Sis Perdesi, Susturma,
--   Zorla Harca. (Saat görünür değişir / geri bildirim gecikir / protokol pasifleşir
--   / bir protokol gider.)
-- Gizli (rakip görmez): Süre Enjeksiyonu, Dondur, Eleme, Rakip Okuması, Konum Testi,
--   Sayı İşareti, Kalkan, Yansıtma, Yanıltma.
-- Counter: engeli ATAN sonucu (blocked/reflected) KENDİ use_protocol dönüşünden
--   görür (kendi satırı zaten kendine görünür). Savunmanın önceden kurulu olduğu
--   ifşa edilmez (Kalkan/Yansıtma kurulum satırı rakibe görünmez).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) match_protocol_uses RLS: rakip yalnız GÖZLEMLENEBİLİR protokolleri görür
-- ════════════════════════════════════════════════════════════════════════════
-- Kendi kullanımların her zaman görünür (kullanıldı şeridi + counter outcome'u).
-- Rakibin kullanımıysa SADECE gözlemlenebilir protokol id'leri görünür. Realtime
-- postgres_changes da bu SELECT politikasına uyar → gizli satır rakibe akmaz.
drop policy if exists "match_protocol_uses_select_players" on public.match_protocol_uses;
drop policy if exists "match_protocol_uses_select_visible" on public.match_protocol_uses;
create policy "match_protocol_uses_select_visible"
  on public.match_protocol_uses for select
  using (
    public.is_match_player(match_id)
    and (
      auth.uid() = player
      or protocol_id in (
        'time_steal', 'time_slow', 'disrupt_fog', 'disrupt_silence', 'disrupt_waste'
      )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Yanıltma bayrağını matches'tan KAPALI tabloya taşı (istemciye hiç inmez)
-- ════════════════════════════════════════════════════════════════════════════
-- matches.deceived_p1/p2, select('*') + realtime ile istemciye iniyordu →
-- kurban "yanıltıldım" bilgisini ağdan/state'ten çıkarabiliyordu. Bu sunucu-içi
-- durumu, istemciye TAMAMEN kapalı (RLS politikası yok, grant yok) bir tabloya
-- taşıyoruz; kurbanın istemcisine hiçbir kanaldan inmez.
create table if not exists public.match_hidden_state (
  match_id uuid primary key references public.matches(id) on delete cascade,
  deceived_p1 boolean not null default false,
  deceived_p2 boolean not null default false
);
alter table public.match_hidden_state enable row level security;
-- Bilinçli olarak HİÇBİR politika yok → anon/authenticated için tüm erişim RED
-- (secrets deseni). Yalnız security definer RPC'ler okur/yazar.
revoke all on table public.match_hidden_state from anon, authenticated;

-- Yanıltma etkisi: hedefin "sonraki tahmini şişir" bayrağını KAPALI tabloya yaz.
create or replace function public._obstacle_deceive(p_match public.matches, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into match_hidden_state (match_id, deceived_p1, deceived_p2)
  values (p_match.id, p_target = p_match.player1, p_target = p_match.player2)
  on conflict (match_id) do update
    set deceived_p1 = match_hidden_state.deceived_p1 or (p_target = p_match.player1),
        deceived_p2 = match_hidden_state.deceived_p2 or (p_target = p_match.player2);
  return '{}'::jsonb;
end;
$$;
revoke execute on function public._obstacle_deceive(public.matches, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) make_guess: yanıltma durumunu KAPALI tablodan oku/temizle (matches yerine)
-- ════════════════════════════════════════════════════════════════════════════
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

  -- Yanıltma durumu KAPALI tablodan (istemciye inmez); satır yoksa false.
  my_deceive := false;
  select case when uid = m.player1 then deceived_p1 else deceived_p2 end
    into my_deceive from match_hidden_state where match_id = m.id;
  my_deceive := coalesce(my_deceive, false);

  my_clock := (case when uid = m.player1 then m.clock1_ms else m.clock2_ms end)
              - _turn_elapsed_ms(m);

  if my_clock <= 0 then
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

  select digits into opp_secret
    from secrets where match_id = m.id and player = opp and round = m.current_round;
  if not found then
    raise exception 'opponent_secret_missing';
  end if;

  fb := evaluate_guess(opp_secret, p_digits); -- GERÇEK (otorite)

  -- Yanıltma: yalnız partial:0/1 bir kademe şişirilir (gösterim); win/dcwo/
  -- partial:2 sahtelenmez. Gerçek sonuç oyunu yönetir.
  display_fb := fb;
  if my_deceive then
    if fb = 'partial:0' then
      display_fb := 'partial:1';
    elsif fb = 'partial:1' then
      display_fb := 'partial:2';
    end if;
  end if;

  -- Yanıltma bayrağı bu tahminle tüketilir (KAPALI tablo; satır yoksa no-op).
  update match_hidden_state
     set deceived_p1 = case when uid = m.player1 then false else deceived_p1 end,
         deceived_p2 = case when uid = m.player2 then false else deceived_p2 end
   where match_id = m.id;

  -- Satıra GÖSTERİLEN değer yazılır (kurbana gerçek inmez; şişirme işareti yok).
  insert into guesses (match_id, guesser, digits, feedback, round, fogged)
  values (m.id, uid, p_digits, display_fb, m.current_round, my_fog);

  if fb = 'win' then
    perform 1 from matches where id = m.id for update;
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end
     where id = m.id;
    m := _advance_or_finish(m.id, uid, 'win');
  else
    -- Sıra rakibe geçer. Tur bitti: donma söner; çağıranın yavaşlatması/
    -- susturması/sisi temizlenir (yanıltma yukarıda tüketildi).
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
    'feedback', display_fb, 'current_turn', m.current_turn,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms,
    'fogged', my_fog);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) _advance_or_finish: yanıltma temizliği KAPALI tabloda (matches kolonları yok)
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

  -- Yanıltma bayrağı tur/maç sınırında KAPALI tabloda temizlenir (satır yoksa no-op).
  update match_hidden_state set deceived_p1 = false, deceived_p2 = false
   where match_id = p_match_id;

  return m;
end;
$$;
revoke execute on function public._advance_or_finish(uuid, uuid, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Artık matches'taki yanıltma kolonlarını DÜŞÜR (istemciye sızma kaynağı)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.matches drop column if exists deceived_p1;
alter table public.matches drop column if exists deceived_p2;

-- PostgREST şema önbelleğini tazele.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - Rakip Yanıltma kullanınca: kurbanın match satırında deceive bilgisi YOK
--     (kolon düştü); match_protocol_uses satırı kurbana GÖRÜNMEZ (RLS). Gösterim
--     yine şişer, gerçek değerlendirme sunucuda.
--   - Kalkan/Yansıtma/Eleme/Konum/Sayı İşareti/Rakip Okuması/Süre/Dondur:
--     match_protocol_uses satırı rakibe GÖRÜNMEZ.
--   - Saat Çalma/Yavaşlat/Sis/Susturma/Zorla Harca: rakibe GÖRÜNÜR.
--   - Counter: atan, use_protocol dönüşünden blocked/reflected görür; kurulum ifşa olmaz.
