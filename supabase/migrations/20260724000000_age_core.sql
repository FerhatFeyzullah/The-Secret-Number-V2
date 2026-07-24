-- ══════════════════════════════════════════════════════════════════════════
-- GİZEM ÇAĞI — 3 oyunculu harita fetih modu · Faz 1: Şema + sabitler
--
-- Mevcut 1v1 maç motoru (matches, player1/player2) 2 kişiliktir ve 3 kişiye
-- açılamaz → Gizem Çağı, Gizemli Kule deseniyle TAMAMEN AYRI, sunucu-otoriter
-- bir alt sistemdir (age_*). Bu migration YALNIZ şema + statik sabitler; iş
-- mantığı ..01 (hazırlık) ve ..02 (savaş) RPC'lerindedir.
--
-- ─── AKIŞ ÖZETİ ────────────────────────────────────────────────────────────
--  • 3 kişilik kuyruk (age_find_match) → dolunca HAZIRLIK (prep) fazı, 3 dk.
--  • Harita: 15 parça = 5 KALE (2×4h, 2×5h, 1×6h "taht") + her kalenin 2 nöbet
--    KULESİ. Hepsi başta bot elinde (owner=null).
--  • KULE = 3 haneli sayı bulmaca (60 sn deneme). KALE = kelime (4h→90/5h→120/
--    6h→150 sn). Kaleye saldırı şartı: o kalenin İKİ kulesi de sende.
--  • Fetheden şifre belirler (kule: kendi sayın/random; kale: kendi kelimen).
--  • SAVAŞ (war) fazı, 10 dk: rakip topraklarına saldırı. Son toprağını kaybeden
--    elenir (ilk elenen 3.); süre dolunca sıralama kale>kule>toplam fetih.
--
-- ─── GİZLİLİK MİMARİSİ (kritik — secrets/tower_floor_state deseni) ──────────
-- Parça şifreleri (age_secrets) YALNIZ sunucuda: RLS açık + politika YOK +
-- revoke all → hiçbir istemci okuyamaz. Yalnız security-definer RPC'ler görür;
-- değerlendirme sunucuda (_evaluate_guess_number / _word_marks), cevap ASLA
-- döndürülmez (parça fethedilene kadar).
-- ══════════════════════════════════════════════════════════════════════════

-- ─── Sabitler (tek doğruluk kaynağı; RPC'ler bunları okur) ──────────────────
-- Faz süreleri + parça deneme süreleri + sabotaj fiyatları. Bir tabloda değil,
-- fonksiyon sabitleri olarak (seasons/tower deseni: statik konfig immutable fn).
create or replace function public._age_const(p_key text)
returns int
language sql
immutable
as $$
  select case p_key
    when 'prep_ms'          then 180000   -- hazırlık fazı 3 dk
    when 'war_ms'           then 600000   -- savaş fazı 10 dk
    when 'tower_try_ms'     then 60000    -- kule (sayı) deneme süresi
    when 'castle_try_4'     then 90000    -- 4 harf kale
    when 'castle_try_5'     then 120000   -- 5 harf kale
    when 'castle_try_6'     then 150000   -- 6 harf kale (taht)
    when 'defense_slots'    then 3        -- kale savunmasında sayı hakkı
    when 'defense_time_cut' then 15000    -- her savunma çözümü → saldırana -15 sn
    when 'sabotage_penalty' then 3000     -- lanetli harf geçiş cezası -3 sn
    when 'fog_turns'        then 3        -- sis kaç tahmin maskeler
    when 'cost_fog'         then 50       -- sis premium sabotaj (Veri)
    when 'cost_cursed'      then 75       -- lanetli harf premium sabotaj (Veri)
    when 'set_code_ms'      then 30000    -- fetih sonrası şifre belirleme penceresi
    when 'reap_ms'          then 30000    -- sessiz oyuncu reap eşiği
    else null
  end;
$$;

-- ─── 1) age_matches ─────────────────────────────────────────────────────────
-- Bir Gizem Çağı oyunu. 3 oyuncu (p1/p2/p3), faz, faz bitiş zamanları,
-- bitişte sıralama + ödül deltaları.
create table if not exists public.age_matches (
  id           uuid primary key default gen_random_uuid(),
  phase        text not null default 'queue'
    check (phase in ('queue', 'prep', 'war', 'finished', 'cancelled')),
  player1      uuid not null references auth.users (id) on delete cascade,
  player2      uuid null references auth.users (id) on delete cascade,
  player3      uuid null references auth.users (id) on delete cascade,
  prep_ends_at timestamptz null,
  war_ends_at  timestamptz null,
  -- Bitişte: [{player, rank, kupa_delta, veri_delta}] (rank 1..3).
  ranking      jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Kuyruk taraması (age_find_match): bekleyen maç bul.
create index if not exists age_matches_queue_idx
  on public.age_matches (created_at)
  where phase = 'queue';

-- ─── 2) age_players ─────────────────────────────────────────────────────────
-- Her maçta 3 satır. last_seen = reap (heartbeat), eliminated_at = eleme anı,
-- prep_accuracy = hazırlıkta toplam isabet (topraksız-topraksız tiebreak).
create table if not exists public.age_players (
  match_id      uuid not null references public.age_matches (id) on delete cascade,
  player        uuid not null references auth.users (id) on delete cascade,
  slot          int not null check (slot between 1 and 3),
  last_seen     timestamptz not null default now(),
  eliminated_at timestamptz null,
  prep_accuracy int not null default 0,
  primary key (match_id, player)
);
create index if not exists age_players_player_idx on public.age_players (player);

-- ─── 3) age_territories ─────────────────────────────────────────────────────
-- Maç başına 15 satır. kind=tower → level=0, castle_id = bağlı kale (kapı).
-- kind=castle → level ∈ {4,5,6}, castle_id = null. owner=null → bot elinde.
-- ŞİFRE BU TABLODA DEĞİL (age_secrets'te, kapalı).
create table if not exists public.age_territories (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.age_matches (id) on delete cascade,
  kind          text not null check (kind in ('tower', 'castle')),
  -- Harita düzeni için sabit indeks (0..4 kale, kule kalesine bağlı) — istemci
  -- düğüm haritasını buna göre yerleştirir.
  slot_index    int not null,
  castle_id     uuid null references public.age_territories (id) on delete cascade,
  level         int not null default 0,   -- kule:0 · kale:4/5/6 (harf sayısı)
  owner         uuid null references auth.users (id) on delete set null,
  conquer_count int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists age_territories_match_idx on public.age_territories (match_id);
create index if not exists age_territories_castle_idx on public.age_territories (castle_id);

-- ─── 4) age_secrets ─────────────────────────────────────────────────────────
-- Parça şifresi. digits (kule, 3 hane) VEYA word (kale). İSTEMCİYE TAMAMEN
-- KAPALI: RLS açık + politika YOK + revoke all (secrets deseni). Yalnız
-- security-definer RPC'ler okur/yazar.
create table if not exists public.age_secrets (
  territory_id uuid primary key references public.age_territories (id) on delete cascade,
  digits       text null,   -- kule: '^[1-9]{3}$' tekrarsız
  word         text null    -- kale: valid_words havuzundan
);

-- ─── 5) age_attacks ─────────────────────────────────────────────────────────
-- Aktif/birikmiş saldırı oturumu. Aynı hedefe birden çok saldıran =
-- race_group ile gruplu (hazırlıkta açık yarış). Kuşatma birikimi: saldırı
-- düşse de satır 'open' kalır → aynı oyuncu döndüğünde tahminleri korunur.
-- Sabotaj alanları savaş fazı kale-savunmasında dolar.
create table if not exists public.age_attacks (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.age_matches (id) on delete cascade,
  attacker      uuid not null references auth.users (id) on delete cascade,
  territory_id  uuid not null references public.age_territories (id) on delete cascade,
  kind          text not null check (kind in ('tower', 'castle')),
  status        text not null default 'open'
    check (status in ('open', 'active', 'won', 'lost')),
  -- Aktif deneme penceresi bitişi (sadece status='active' iken anlamlı).
  deadline      timestamptz null,
  -- Sabotaj bayrakları (savaş kale-savunmasından; tower_guess deseni).
  fog_remaining int not null default 0,
  cursed_letters text[] not null default '{}',
  clock_penalty_ms int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists age_attacks_match_idx on public.age_attacks (match_id);
-- Bir oyuncunun bir hedefe TEK birikmiş saldırısı (kuşatma sürekliliği).
create unique index if not exists age_attacks_attacker_target_uniq
  on public.age_attacks (attacker, territory_id);

-- ─── 6) age_attack_guesses ──────────────────────────────────────────────────
-- Saldırı tahminleri + feedback (+ kelime marks server-side). Kuşatma birikimi
-- buradan: aynı saldırıya dönünce geçmiş tahminler ekranda durur.
create table if not exists public.age_attack_guesses (
  id         bigint generated always as identity primary key,
  attack_id  uuid not null references public.age_attacks (id) on delete cascade,
  guess      text not null,
  feedback   text not null,   -- sayı: partial:N/.../win · kelime: win/miss
  marks      text null,       -- kelime: 'GYX...' (çağırana boyanır)
  created_at timestamptz not null default now()
);
create index if not exists age_attack_guesses_attack_idx
  on public.age_attack_guesses (attack_id, id);

-- ─── 7) age_defenses ────────────────────────────────────────────────────────
-- Kale savunma oturumu (savunmaya koşan oyuncu botun sayısını çözer). Bir
-- saldırıya karşı en fazla 1 aktif savunma. solved_count 0..3 = kullanılan
-- sayı hakkı. secret_digits = botun ŞU ANKİ sayısı (kapalı; çözülünce yenilenir).
create table if not exists public.age_defenses (
  id            uuid primary key default gen_random_uuid(),
  attack_id     uuid not null references public.age_attacks (id) on delete cascade,
  defender      uuid not null references auth.users (id) on delete cascade,
  solved_count  int not null default 0 check (solved_count between 0 and 3),
  secret_digits text not null,   -- botun aktif sayısı (istemciye kapalı tabloda)
  deadline      timestamptz null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists age_defenses_attack_uniq on public.age_defenses (attack_id);

-- ══════════════════════════════════════════════════════════════════════════
-- RLS
-- ══════════════════════════════════════════════════════════════════════════
-- age_secrets + age_defenses.secret_digits istemciye TAMAMEN kapalı.
-- Diğer tablolar: yalnız MAÇIN oyuncuları okuyabilir (şifre bu tablolarda yok).

alter table public.age_matches      enable row level security;
alter table public.age_players      enable row level security;
alter table public.age_territories  enable row level security;
alter table public.age_secrets      enable row level security;
alter table public.age_attacks      enable row level security;
alter table public.age_attack_guesses enable row level security;
alter table public.age_defenses     enable row level security;

-- age_secrets: HİÇBİR politika + grant revoke (secrets deseni). Tam kapalı.
revoke all on table public.age_secrets from anon, authenticated;
-- age_defenses: secret_digits taşıdığı için tamamen kapalı; savunma durumu
-- age_get_state içinde güvenli türetilir (solved_count vb. sızmadan).
revoke all on table public.age_defenses from anon, authenticated;

-- Yardımcı: çağıran bu maçın oyuncusu mu? (security definer → politikalar
-- age_matches'ı kendi RLS'ine takılmadan kontrol eder; is_match_player deseni.)
create or replace function public.is_age_player(m_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.age_matches m
     where m.id = m_id and auth.uid() in (m.player1, m.player2, m.player3)
  );
$$;
revoke execute on function public.is_age_player(uuid) from public, anon;
grant execute on function public.is_age_player(uuid) to authenticated;

-- Okuma politikaları (maçın oyuncuları). Mutasyonlar YALNIZ RPC'lerden
-- (politikasız → RLS varsayılanı red; matches deseni).
drop policy if exists age_matches_select on public.age_matches;
create policy age_matches_select on public.age_matches for select
  using (auth.uid() in (player1, player2, player3));

drop policy if exists age_players_select on public.age_players;
create policy age_players_select on public.age_players for select
  using (public.is_age_player(match_id));

drop policy if exists age_territories_select on public.age_territories;
create policy age_territories_select on public.age_territories for select
  using (public.is_age_player(match_id));

drop policy if exists age_attacks_select on public.age_attacks;
create policy age_attacks_select on public.age_attacks for select
  using (public.is_age_player(match_id));

-- Saldırı tahminleri: yalnız KENDİ saldırının tahminleri (rakibin kuşatma
-- ilerlemesi ham tahmin olarak sızmasın; savunana özet age_get_state verir).
drop policy if exists age_attack_guesses_select on public.age_attack_guesses;
create policy age_attack_guesses_select on public.age_attack_guesses for select
  using (
    exists (
      select 1 from public.age_attacks a
       where a.id = age_attack_guesses.attack_id and a.attacker = auth.uid()
    )
  );

-- updated_at tetikleyicisi (mevcut set_updated_at yeniden kullanılır).
drop trigger if exists age_matches_set_updated_at on public.age_matches;
create trigger age_matches_set_updated_at before update on public.age_matches
  for each row execute function public.set_updated_at();
drop trigger if exists age_attacks_set_updated_at on public.age_attacks;
create trigger age_attacks_set_updated_at before update on public.age_attacks
  for each row execute function public.set_updated_at();
drop trigger if exists age_defenses_set_updated_at on public.age_defenses;
create trigger age_defenses_set_updated_at before update on public.age_defenses
  for each row execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- Ortak yardımcılar (RPC'ler kullanır)
-- ══════════════════════════════════════════════════════════════════════════

-- Rastgele 3 haneli, 1-9, tekrarsız sayı (kule şifresi + savunma botu).
create or replace function public._age_rand_number()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  d int[];
begin
  select array_agg(x order by random()) into d
    from (select generate_series(1, 9) x) s;
  return d[1]::text || d[2]::text || d[3]::text;
end;
$$;
revoke execute on function public._age_rand_number() from public, anon, authenticated;

-- Rastgele geçerli kelime (verilen uzunlukta) — _word_race_pick_secret deseni.
create or replace function public._age_rand_word(p_length int)
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select word from public.secret_words where length = p_length order by random() limit 1;
$$;
revoke execute on function public._age_rand_word(int) from public, anon, authenticated;

-- Kale harf sayısına göre deneme süresi (ms).
create or replace function public._age_castle_try_ms(p_level int)
returns int
language sql
immutable
as $$
  select case p_level
    when 4 then public._age_const('castle_try_4')
    when 5 then public._age_const('castle_try_5')
    when 6 then public._age_const('castle_try_6')
    else public._age_const('castle_try_5')
  end;
$$;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════
-- Doğrulama notları (harness / panel)
-- ══════════════════════════════════════════════════════════════════════════
--   - age_secrets / age_defenses: authenticated rolüyle select → permission denied
--     (grant yok). Yalnız definer RPC erişir.
--   - Harita düzeni: 5 kale (slot_index 0..4; level 4,4,5,5,6), her kalenin 2
--     kulesi (castle_id dolu). Bu düzen age_find_match içinde seed'lenir (..01).
--   - _age_rand_number: 3 farklı hane, hepsi 1-9. _age_rand_word: secret_words'ten.
