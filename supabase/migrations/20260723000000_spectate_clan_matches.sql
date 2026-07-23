-- KLAN MAÇ İZLEME (Seyirci modu)
--
-- Klan üyesi, klan arkadaşının EŞLEŞMELİ (matchmaking) maçını salt-okunur
-- izleyebilir. İzleyici, izlediği oyuncunun ekranında ne varsa onu görür.
--
-- ════════════════════════════════════════════════════════════════════════════
-- GÜVENLİK MODELİ (kritik — bu blok tasarımın sözleşmesidir)
-- ════════════════════════════════════════════════════════════════════════════
--  1) secrets tablosuna DOKUNULMAZ. RLS+grant'leri kapalı kalır; canlı turun
--     gizli sayı/kelimesi hiçbir seyirci yoluyla dönmez. (Kelime modunda
--     oyuncunun kendi gizlisi zaten sunucudan hiç dönmüyor; istemci-yerel
--     hafızadan gösteriliyor → seyircide doğal olarak boş kalır.)
--  2) Paylaşımlı tablolar (matches / guesses / presence / match_protocol_uses)
--     zaten İKİ OYUNCUYA DA açık veridir. Seyircinin bunları görmesi hiçbir
--     tarafa bilgi avantajı yaratmaz → SELECT politikası genişletilir, böylece
--     realtime postgres_changes seyirciye de akar. ANCAK iki tabloda oyuncuya
--     özel kısıt VARDIR ve seyirci politikası bunları BİREBİR yansıtır:
--       • guesses: wordrace'te oyuncu YALNIZ kendi tahminlerini görür (aynı
--         gizli kelimeyi yarıştıkları için). Seyirci de yalnız KLAN ARKADAŞININ
--         satırlarını görür; rakibin tahminleri gizli kalır.
--       • match_protocol_uses: rakibin yalnız "gözlemlenebilir" protokolleri
--         görünür (Kalkan/Yansıtma gibi gizli kurulumlar görünmez). Seyirci de
--         aynı listeyle sınırlıdır; klan arkadaşının satırları tam görünür.
--     Bilinen artık risk: iki oyuncu da AYNI klandansa seyirci iki tarafı da
--     görür. Bu zaten tasarım gereği mümkün (seyirci sırayla ikisini de
--     izleyebilir), yeni bir yetki açmaz.
--  3) OYUNCUYA ÖZEL veri (protokol eli, kelime per-harf renkleri, ifşa) yalnız
--     can_spectate_player() kapısından döner: hedef oyuncu, çağıranın KLAN
--     ARKADAŞI olmak ZORUNDA. Rakibin (yabancının) eli/renkleri ASLA dönmez —
--     aksi halde seyirci rakibin elini klan arkadaşına söyleyip avantaj
--     sağlayabilirdi.
--  4) Özel oda (mode='private') ve kuyruk (status='waiting') kapsam DIŞI.
--     Kuyruğun dışlanması "istemci waiting kuyruğunu taramaz" ilkesini korur.
--  5) Mevcut get_my_* / get_*_reveal fonksiyonlarına DOKUNULMAZ → canlı
--     maçlarda regresyon riski yok. Seyirci dalı ayrı fonksiyonlardadır.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Kapı fonksiyonları
-- ════════════════════════════════════════════════════════════════════════════

-- Maç izlenebilir mi? (paylaşımlı tablolar için — RLS politikalarında kullanılır)
-- security definer: politikalar matches'ı kendi RLS'ine takılmadan okusun
-- (is_match_player ile aynı desen).
create or replace function public.can_spectate_match(m_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.matches m
      join public.clan_members me on me.player = auth.uid()
      join public.clan_members them
        on them.clan_id = me.clan_id
       and them.player in (m.player1, m.player2)
     where m.id = m_id
       and m.mode <> 'private'      -- özel oda izlenemez
       and m.status <> 'waiting'    -- kuyruk taraması açılmaz
  );
$$;

revoke execute on function public.can_spectate_match(uuid) from public, anon;
grant execute on function public.can_spectate_match(uuid) to authenticated;

-- Belirli bir OYUNCUNUN gözünden izlenebilir mi? (oyuncuya özel RPC'ler için)
-- Hedef, çağıranın klan arkadaşı VE maçın oyuncusu olmalı. Kendini "izlemek"
-- de teknik olarak geçerlidir (çağıran oyuncunun kendisiyse) — zararsız.
create or replace function public.can_spectate_player(m_id uuid, p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.matches m
      join public.clan_members me on me.player = auth.uid()
      join public.clan_members target
        on target.clan_id = me.clan_id
       and target.player = p_player
     where m.id = m_id
       and m.mode <> 'private'
       and m.status <> 'waiting'
       and p_player in (m.player1, m.player2)   -- hedef bu maçın oyuncusu
  );
$$;

revoke execute on function public.can_spectate_player(uuid, uuid) from public, anon;
grant execute on function public.can_spectate_player(uuid, uuid) to authenticated;

-- Hedef oyuncu çağıranın klan arkadaşı mı? (satır-bazlı aynalama kısıtları için)
create or replace function public.is_clanmate(p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.clan_members me
      join public.clan_members them on them.clan_id = me.clan_id
     where me.player = auth.uid()
       and them.player = p_player
  );
$$;

revoke execute on function public.is_clanmate(uuid) from public, anon;
grant execute on function public.is_clanmate(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Paylaşımlı tablolarda seyirci SELECT politikaları
-- ════════════════════════════════════════════════════════════════════════════
-- Birden çok permissive SELECT politikası OR'lanır → mevcut oyuncu
-- politikaları aynen kalır, yanına seyirci dalı eklenir.

drop policy if exists "matches_select_spectator" on public.matches;
create policy "matches_select_spectator"
  on public.matches for select
  using (public.can_spectate_match(id));

-- guesses: number/word'te iki oyuncu da tüm satırları görür → seyirci de görür.
-- wordrace'te oyuncu yalnız KENDİ satırını görür (canlı politika,
-- 20260719000001) → seyirci de yalnız klan arkadaşının satırlarını görür.
drop policy if exists "guesses_select_spectator" on public.guesses;
create policy "guesses_select_spectator"
  on public.guesses for select
  using (
    public.can_spectate_match(match_id)
    and (
      public.is_clanmate(guesser)
      or exists (
        select 1 from public.matches m
         where m.id = guesses.match_id
           and m.content_type <> 'wordrace'
      )
    )
  );

drop policy if exists "presence_select_spectator" on public.presence;
create policy "presence_select_spectator"
  on public.presence for select
  using (public.can_spectate_match(match_id));

-- match_protocol_uses: rakibin GİZLİ protokol kullanımları oyuncuya görünmez
-- (canlı politika, 20260607000011) → seyirci de aynı gözlemlenebilir listeyle
-- sınırlıdır. Klan arkadaşının kendi satırları tam görünür (aynası).
drop policy if exists "protocol_uses_select_spectator" on public.match_protocol_uses;
create policy "protocol_uses_select_spectator"
  on public.match_protocol_uses for select
  using (
    public.can_spectate_match(match_id)
    and (
      public.is_clanmate(player)
      or protocol_id in (
        'time_steal', 'time_slow', 'disrupt_fog', 'disrupt_silence', 'disrupt_waste'
      )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3) get_spectator_marks — izlenen oyuncunun KELİME tahtası renkleri
-- ════════════════════════════════════════════════════════════════════════════
-- get_my_marks'ın seyirci kardeşi: uid yerine p_player'ın tahminleri boyanır.
-- p_player ÇAĞIRANIN KLAN ARKADAŞI olmak zorunda (rakibin renkleri dönmez).
create or replace function public.get_spectator_marks(p_match_id uuid, p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.matches;
  opp uuid;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_spectate_player(p_match_id, p_player) then
    raise exception 'not_spectatable';
  end if;

  select * into m from public.matches where id = p_match_id;
  if m.content_type <> 'word' then
    return '[]'::jsonb;                 -- yalnız kelime düellosunda anlamlı
  end if;
  opp := case when p_player = m.player1 then m.player2 else m.player1 end;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', g.id, 'marks', _word_marks(s.digits, g.digits))
             order by g.id),
           '[]'::jsonb)
    into result
    from guesses g
    join secrets s
      on s.match_id = g.match_id and s.player = opp and s.round = g.round
   where g.match_id = p_match_id
     and g.guesser = p_player;          -- ★ yalnız izlenen oyuncunun tahminleri

  return result;
end;
$$;

revoke execute on function public.get_spectator_marks(uuid, uuid) from public, anon;
grant execute on function public.get_spectator_marks(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) get_spectator_hand — izlenen oyuncunun PROTOKOL eli
-- ════════════════════════════════════════════════════════════════════════════
-- get_my_hand'in seyirci kardeşi. Rakibin eli ASLA dönmez (can_spectate_player).
create or replace function public.get_spectator_hand(p_match_id uuid, p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h public.protocol_hands;
  lvl int;
  has_hand boolean;
  player_uses jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_spectate_player(p_match_id, p_player) then
    raise exception 'not_spectatable';
  end if;

  select level into lvl from profiles where id = p_player;

  select * into h from protocol_hands where match_id = p_match_id and player = p_player;
  has_hand := found;

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
    into player_uses
    from match_protocol_uses u
   where u.match_id = p_match_id and u.player = p_player;

  return jsonb_build_object(
    'hand', coalesce(to_jsonb(h.hand), '[]'::jsonb),
    'selected', coalesce(to_jsonb(h.selected), '[]'::jsonb),
    'slots', _protocol_slots(coalesce(lvl, 1)),
    'uses', player_uses,
    'eliminations', coalesce(h.eliminations, '{}'::jsonb),
    'hints', coalesce(h.hints, '{}'::jsonb),
    'shield_armed', coalesce(h.shield_armed, false),
    'reflect_armed', coalesce(h.reflect_armed, false));
end;
$$;

revoke execute on function public.get_spectator_hand(uuid, uuid) from public, anon;
grant execute on function public.get_spectator_hand(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) get_spectator_reveal — maç sonu ifşa (izlenen oyuncunun bakışıyla)
-- ════════════════════════════════════════════════════════════════════════════
-- get_match_reveal'in seyirci kardeşi. status='finished' kapısı AYNEN korunur →
-- canlı maçın gizlisi dönmez.
create or replace function public.get_spectator_reveal(p_match_id uuid, p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.matches;
  opp uuid;
  mine_digits text;
  opp_digits text;
  scored boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_spectate_player(p_match_id, p_player) then
    raise exception 'not_spectatable';
  end if;

  select * into m from public.matches where id = p_match_id;
  if m.status <> 'finished' then
    raise exception 'match_not_finished';
  end if;

  opp := case when p_player = m.player1 then m.player2 else m.player1 end;
  select digits into mine_digits from public.secrets
   where match_id = p_match_id and player = p_player and round = m.current_round;
  select digits into opp_digits from public.secrets
   where match_id = p_match_id and player = opp and round = m.current_round;

  scored := m.mode in ('quick', 'protocol') and m.rating_applied and not m.is_friendly;

  return jsonb_build_object(
    'mine', mine_digits,
    'opponent', opp_digits,
    'scored', scored,
    'rating_delta', case when p_player = m.player1 then m.p1_rating_delta else m.p2_rating_delta end,
    'xp_delta', case when p_player = m.player1 then m.p1_xp_delta else m.p2_xp_delta end,
    'veri_delta', case when p_player = m.player1 then m.p1_veri_delta else m.p2_veri_delta end);
end;
$$;

revoke execute on function public.get_spectator_reveal(uuid, uuid) from public, anon;
grant execute on function public.get_spectator_reveal(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) get_spectator_round_reveal — tur sonu ifşa (Bo3 tur arası)
-- ════════════════════════════════════════════════════════════════════════════
-- get_round_reveal'in seyirci kardeşi. "Yalnız KARARLAŞMIŞ tur" kapısı AYNEN
-- korunur → canlı turun gizlisi ASLA dönmez.
create or replace function public.get_spectator_round_reveal(
  p_match_id uuid,
  p_round int,
  p_player uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.matches;
  opp uuid;
  mine_digits text;
  opp_digits text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_spectate_player(p_match_id, p_player) then
    raise exception 'not_spectatable';
  end if;

  select * into m from public.matches where id = p_match_id;

  if not (p_round < m.current_round
          or (p_round = m.current_round and m.status = 'finished')) then
    raise exception 'round_not_revealable';
  end if;

  opp := case when p_player = m.player1 then m.player2 else m.player1 end;

  select digits into mine_digits from public.secrets
   where match_id = p_match_id and player = p_player and round = p_round;
  select digits into opp_digits from public.secrets
   where match_id = p_match_id and player = opp and round = p_round;

  return jsonb_build_object('mine', mine_digits, 'opponent', opp_digits);
end;
$$;

revoke execute on function public.get_spectator_round_reveal(uuid, int, uuid) from public, anon;
grant execute on function public.get_spectator_round_reveal(uuid, int, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) get_spectator_race_reveal — Kelime Yarışı ORTAK gizli kelimesi
-- ════════════════════════════════════════════════════════════════════════════
-- word_race_reveal'in seyirci kardeşi. Kelime Yarışı'nda iki oyuncu AYNI gizli
-- kelimeyi çözer → tek "secret" döner. "Yalnız KARARLAŞMIŞ tur" kapısı AYNEN
-- korunur; canlı turun kelimesi ASLA dönmez (aksi halde seyirci yarışı bozardı).
create or replace function public.get_spectator_race_reveal(
  p_match_id uuid,
  p_round int,
  p_player uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.matches;
  v_secret text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_spectate_player(p_match_id, p_player) then
    raise exception 'not_spectatable';
  end if;

  select * into m from public.matches where id = p_match_id;

  if not (p_round < m.current_round
          or (p_round = m.current_round and m.status = 'finished')) then
    raise exception 'round_not_revealable';
  end if;

  select digits into v_secret
    from public.secrets where match_id = p_match_id and round = p_round limit 1;

  return jsonb_build_object('secret', v_secret);
end;
$$;

revoke execute on function public.get_spectator_race_reveal(uuid, int, uuid) from public, anon;
grant execute on function public.get_spectator_race_reveal(uuid, int, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - Klan arkadaşı OLMAYAN kullanıcı: select * from matches where id=<maç>
--     → 0 satır. can_spectate_match → false.
--   - Klan arkadaşı: matches/guesses/presence/match_protocol_uses okunur;
--     secrets → yine 0 satır / permission denied (DEĞİŞMEDİ).
--   - get_spectator_hand(<maç>, <RAKİP id>) → 'not_spectatable' hatası.
--   - wordrace maçında: guesses'ten YALNIZ klan arkadaşının satırları döner
--     (rakibin tahminleri 0 satır — gizli kelime sızmaz).
--   - Protokol maçında rakibin 'shield'/'reflect' satırı seyirciye DÖNMEZ;
--     'time_steal' vb. gözlemlenebilir olanlar döner.
--   - get_spectator_reveal canlı maçta → 'match_not_finished'.
--   - get_spectator_round_reveal canlı turda → 'round_not_revealable'.
--   - Özel oda maçı (mode='private') → can_spectate_match false.
