-- Faz 3 / Adım 4a: Protokol kullanım iskeleti + Süre Enjeksiyonu + Eleme
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- use_protocol RPC'si maç içi protokol kullanımının TEK kapısıdır: tüm doğrulama
-- (mod, faz, sıra, seçim, hak, zamanlama) ve TÜM ETKİ sunucuda. İstemci asla
-- etki uygulamaz; yalnızca RPC çağırır ve realtime/dönüşten durumu okur.
-- 4b/4c/4d yalnızca yeni etki dalları (+ katalog değerleri) ekleyecek.
--
-- Kullanım hakkı VARSAYILANI: maç başına 1 (Best of 3 boyunca tek; turlar arası
-- SIFIRLANMAZ). Altyapı tur-başı sıfırlamayı da destekler (reset_per_round).
-- Gizlilik: Eleme yalnızca "sayıda OLMAYAN bir rakam" döndürür; gizli sayı,
-- rakibin eli/seçimi ve elenen rakamlar (protocol_hands RLS) ASLA sızmaz.
-- match_protocol_uses sır içermez → maçın iki oyuncusu da okuyabilir
-- ("rakip X kullandı" bildirimi realtime INSERT'ten gelir).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) KATALOG: kullanım zamanı + hak alanları (catalog.ts ile bire bir)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.protocols
  add column if not exists usage_timing text not null default 'own_turn'
  check (usage_timing in ('own_turn', 'anytime', 'setup'));
alter table public.protocols
  add column if not exists uses_per_match int not null default 1;
alter table public.protocols
  add column if not exists reset_per_round boolean not null default false;

-- Seed güncelle (yalnız 4a'da uygulanmış time_add + info_eliminate bağlayıcı;
-- diğer timing'ler 4b/4c/4d'de etkiyle birlikte kesinleşir — catalog.ts aynı).
update public.protocols set usage_timing = 'own_turn'
 where id in ('time_add','info_eliminate','info_readlast','time_steal','disrupt_fog',
              'info_postest','disrupt_silence','time_slow','disrupt_waste',
              'info_reveal','disrupt_deceive');
update public.protocols set usage_timing = 'anytime'
 where id in ('def_shield','time_freeze','def_reflect');
update public.protocols set uses_per_match = 1, reset_per_round = false;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) match_protocol_uses: kullanım kaydı (hak + "rakip kullandı" sinyali)
-- ════════════════════════════════════════════════════════════════════════════
-- SIR İÇERMEZ (yalnız kim/hangi protokol/hangi tur) → maçın iki oyuncusu da
-- SELECT edebilir; realtime INSERT aboneliği rakip bildirimini sağlar.
-- Yazma yalnızca use_protocol (security definer) içinden.
create table if not exists public.match_protocol_uses (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  player uuid not null references public.profiles(id) on delete cascade,
  protocol_id text not null references public.protocols(id),
  round int not null,
  created_at timestamptz not null default now()
);

create index if not exists match_protocol_uses_match_idx
  on public.match_protocol_uses (match_id, player);

alter table public.match_protocol_uses enable row level security;
drop policy if exists "match_protocol_uses_select_players" on public.match_protocol_uses;
create policy "match_protocol_uses_select_players"
  on public.match_protocol_uses for select
  using (public.is_match_player(match_id));
-- INSERT/UPDATE politikası YOK: tüm yazma use_protocol RPC'sinden.
revoke all on table public.match_protocol_uses from anon, authenticated;
grant select on table public.match_protocol_uses to authenticated;

-- Realtime yayını (migration 3'teki desenle; yayın yoksa atla).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime yayını yok, atlanıyor';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'match_protocol_uses'
  ) then
    alter publication supabase_realtime add table public.match_protocol_uses;
  end if;
end
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) protocol_hands.eliminations: Eleme'nin verdiği rakamlar (tur → rakamlar)
-- ════════════════════════════════════════════════════════════════════════════
-- Yalnız ÇAĞIRANIN özel bilgisi; protocol_hands RLS'i (kendi satırı) korur.
-- jsonb: {"1": [7], "2": [3, 5]} — tur bazlı, çünkü her turun gizli sayısı ayrı.
alter table public.protocol_hands
  add column if not exists eliminations jsonb not null default '{}';

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Etki yardımcıları (yalnız use_protocol içinden; 4b/4c/4d yenilerini ekler)
-- ════════════════════════════════════════════════════════════════════════════
-- Süre Enjeksiyonu: kullananın KENDİ saatine +12 sn (atomik; tavan/floor yok).
create or replace function public._protocol_time_add(p_match public.matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
begin
  update matches
     set clock1_ms = clock1_ms + case when p_uid = player1 then 12000 else 0 end,
         clock2_ms = clock2_ms + case when p_uid = player2 then 12000 else 0 end
   where id = p_match.id
   returning * into m;
  return jsonb_build_object(
    'added_ms', 12000, 'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms);
end;
$$;
revoke execute on function public._protocol_time_add(public.matches, uuid) from public, anon, authenticated;

-- Eleme: rakibin BU TURDAKİ gizli sayısında OLMAYAN bir rakam seç (varsa daha
-- önce verilmemiş olanlardan), çağıranın eliminations kaydına işle ve YALNIZCA
-- rakamı döndür. Gizli sayının kendisi hiçbir koşulda dönmez.
create or replace function public._protocol_info_eliminate(p_match public.matches, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  opp uuid;
  opp_secret text;
  given jsonb;
  cand int[];
  pick int;
  updated jsonb;
begin
  opp := case when p_uid = p_match.player1 then p_match.player2 else p_match.player1 end;
  select digits into opp_secret
    from secrets
   where match_id = p_match.id and player = opp and round = p_match.current_round;
  if not found then
    raise exception 'opponent_secret_missing';
  end if;

  given := coalesce((
    select eliminations -> p_match.current_round::text
      from protocol_hands
     where match_id = p_match.id and player = p_uid), '[]'::jsonb);

  -- 1-9 içinde sayıda olmayan VE bu turda daha önce verilmemiş rakamlar.
  select array_agg(d) into cand
    from generate_series(1, 9) d
   where strpos(opp_secret, d::text) = 0
     and not given @> to_jsonb(d);
  if cand is null then
    raise exception 'no_digits_left';
  end if;

  pick := cand[1 + floor(random() * array_length(cand, 1))::int];
  updated := given || to_jsonb(pick);
  update protocol_hands
     set eliminations = jsonb_set(eliminations, array[p_match.current_round::text], updated, true)
   where match_id = p_match.id and player = p_uid;

  return jsonb_build_object('eliminated_digit', pick, 'eliminated', updated);
end;
$$;
revoke execute on function public._protocol_info_eliminate(public.matches, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) use_protocol: tek kapı (doğrulama + etki + kayıt — hepsi sunucuda)
-- ════════════════════════════════════════════════════════════════════════════
-- p_payload 4a'da kullanılmaz; ileride parametreli protokoller (örn. Konum
-- Testi) için ayrılmıştır. _match_for_player FOR UPDATE kilidi eşzamanlı/çifte
-- çağrıları serileştirir → idempotans: ikinci çağrı hakkı dolu görür
-- (protocol_already_used), etki bir kez uygulanır.
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
  elapsed_ms int;
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
    -- Süresi (görsel olarak) dolmuş sıra protokolle canlandırılamaz; turun
    -- kaderi claim_timeout / make_guess'e kalır.
    elapsed_ms := floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
    my_clock := (case when uid = m.player1 then m.clock1_ms else m.clock2_ms end) - elapsed_ms;
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

  -- ETKİ (sunucuda; 4b/4c/4d buraya yalnızca yeni dal ekler).
  if p_protocol_id = 'time_add' then
    extra := _protocol_time_add(m, uid);
  elsif p_protocol_id = 'info_eliminate' then
    extra := _protocol_info_eliminate(m, uid);
  else
    raise exception 'protocol_not_implemented';
  end if;

  -- Kullanımı kaydet (etkiyle aynı transaction: ikisi birlikte ya da hiç).
  -- INSERT realtime'da iki oyuncuya da düşer → "rakip X kullandı" bildirimi.
  insert into match_protocol_uses (match_id, player, protocol_id, round)
  values (m.id, uid, p_protocol_id, m.current_round);

  return jsonb_build_object(
    'match_id', m.id,
    'protocol_id', p_protocol_id,
    'round', m.current_round) || coalesce(extra, '{}'::jsonb);
end;
$$;
revoke execute on function public.use_protocol(uuid, text, jsonb) from public, anon;
grant execute on function public.use_protocol(uuid, text, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) get_my_hand: + kendi kullanımların + elenen rakamların (rakibinki ASLA)
-- ════════════════════════════════════════════════════════════════════════════
-- (20260607000005'teki kilitsiz/read-only-güvenli sürüm korunarak genişletildi:
-- şerit "kullanıldı" durumu ve kalıcı "elenenler" göstergesi yeniden bağlanınca
-- da doğru dolsun.)
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
    -- El henüz dağıtılmamış/yok: boş el (istemci yükleniyor/yeniden-dene gösterir).
    return jsonb_build_object('hand', '[]'::jsonb, 'selected', '[]'::jsonb,
                              'slots', _protocol_slots(coalesce(lvl, 1)),
                              'uses', '[]'::jsonb, 'eliminations', '{}'::jsonb);
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
    'eliminations', coalesce(h.eliminations, '{}'::jsonb));
end;
$$;
revoke execute on function public.get_my_hand(uuid) from public, anon;
grant execute on function public.get_my_hand(uuid) to authenticated;

-- PostgREST şema önbelleğini tazele (yeni RPC/tablo panelde hemen görünsün).
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Doğrulama notları (panelde / docker'da)
-- ════════════════════════════════════════════════════════════════════════════
--   - time_add: kendi sıranda → kendi saatin +12000 ms (rakibinki değişmez).
--   - info_eliminate: dönen rakam rakibin O TURDAKİ sayısında YOK; gizli sayı
--     hiçbir alanda dönmez; eliminations yalnız kendi protocol_hands satırında.
--   - own_turn: sıra rakipteyken → not_your_turn.
--   - Hak: maç başına 1 — tur 2'de tekrar → protocol_already_used (SIFIRLANMAZ).
--   - İdempotans: çifte çağrı kilitle serileşir; ikincisi protocol_already_used.
--   - Seçilmemiş protokol → protocol_not_selected; uygulanmamış (4b/4c/4d)
--     → protocol_not_implemented.
--   - match_protocol_uses: iki oyuncu da SELECT edebilir (sır yok); rakibin
--     protocol_hands satırı (el/seçim/eliminations) RLS ile kapalı.
