-- Online 1v1: matches / secrets / guesses / presence tabloları + RLS
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Kritik güvenlik kuralı: secrets tablosu istemciden HİÇBİR koşulda okunamaz;
-- gizli sayıya yalnızca 2. adımdaki security definer RPC'ler erişecek.

-- 1) matches -------------------------------------------------------------------

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  -- waiting: rakip bekleniyor (kuyruk) | setup: sayı belirleme fazı
  -- active: oyun sürüyor | finished / cancelled / abandoned: bitti
  status text not null default 'waiting'
    check (status in ('waiting', 'setup', 'active', 'finished', 'cancelled', 'abandoned')),
  mode text not null
    check (mode in ('quick', 'private')),
  -- Özel oyun için kısa kod; sadece private modda dolu.
  room_code text null,
  player1 uuid not null references auth.users (id) on delete cascade,
  player2 uuid null references auth.users (id) on delete cascade,
  -- Sırası gelen oyuncu.
  current_turn uuid null references auth.users (id) on delete set null,
  -- Sıranın başladığı SUNUCU zamanı (satranç saati hesabı için).
  turn_started_at timestamptz null,
  -- Kalan süreler (ms); kişi başı 60 sn.
  clock1_ms int not null default 60000,
  clock2_ms int not null default 60000,
  -- Sayı belirleme fazının bitiş anı (15 sn).
  setup_deadline timestamptz null,
  winner uuid null references auth.users (id) on delete set null,
  result text null
    check (result in ('win', 'timeout', 'forfeit', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Kuyruk taraması (2. adımdaki eşleştirme RPC'si) için.
create index if not exists matches_waiting_queue_idx
  on public.matches (mode, created_at)
  where status = 'waiting';

-- room_code yalnızca devam eden maçlar arasında benzersiz olsun;
-- maç bitince kod yeniden kullanılabilir.
create unique index if not exists matches_room_code_active_uniq
  on public.matches (room_code)
  where room_code is not null and status in ('waiting', 'setup', 'active');

-- 2) secrets -------------------------------------------------------------------

create table if not exists public.secrets (
  match_id uuid not null references public.matches (id) on delete cascade,
  player uuid not null references auth.users (id) on delete cascade,
  -- 3 hane, rakamlar 1-9 ve birbirinden farklı (offline kuralıyla aynı).
  digits text not null check (
    digits ~ '^[1-9]{3}$'
    and substring(digits, 1, 1) <> substring(digits, 2, 1)
    and substring(digits, 1, 1) <> substring(digits, 3, 1)
    and substring(digits, 2, 1) <> substring(digits, 3, 1)
  ),
  primary key (match_id, player)
);

-- 3) guesses -------------------------------------------------------------------

create table if not exists public.guesses (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  guesser uuid not null references auth.users (id) on delete cascade,
  digits text not null check (digits ~ '^[1-9]{3}$'),
  -- partial:N (N = doğru rakam sayısı, 0-2) | digits_correct_wrong_order | win
  -- Pozisyon eşleşme sayısı ASLA tutulmaz/sızdırılmaz (offline kuralıyla birebir).
  feedback text not null check (
    feedback in ('partial:0', 'partial:1', 'partial:2', 'digits_correct_wrong_order', 'win')
  ),
  created_at timestamptz not null default now()
);

create index if not exists guesses_match_created_idx
  on public.guesses (match_id, created_at);

-- 4) presence ------------------------------------------------------------------

create table if not exists public.presence (
  match_id uuid not null references public.matches (id) on delete cascade,
  player uuid not null references auth.users (id) on delete cascade,
  last_seen timestamptz not null default now(),
  -- Kopuş anı; 30 sn'lik yeniden bağlanma penceresi buradan hesaplanır.
  disconnected_at timestamptz null,
  primary key (match_id, player)
);

-- 5) Yardımcı: kullanıcı bu maçın oyuncusu mu? ---------------------------------
-- security definer: guesses/presence politikaları matches'ı, matches'ın kendi
-- RLS'ine takılmadan kontrol edebilsin diye.

create or replace function public.is_match_player(m_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.matches m
    where m.id = m_id
      and auth.uid() in (m.player1, m.player2)
  );
$$;

-- 6) RLS -----------------------------------------------------------------------

alter table public.matches enable row level security;
alter table public.secrets enable row level security;
alter table public.guesses enable row level security;
alter table public.presence enable row level security;

-- matches: yalnızca maçın oyuncuları okuyabilir.
-- (waiting kuyruğunu istemci TARAMAZ; eşleştirmeyi 2. adımdaki security definer
-- RPC yapacak. INSERT/UPDATE politikası bilinçli olarak YOK — tüm maç durumu
-- değişiklikleri RPC'lerden geçecek; politikasız tabloda RLS varsayılanı RED.)
drop policy if exists "matches_select_players" on public.matches;
create policy "matches_select_players"
  on public.matches for select
  using (auth.uid() in (player1, player2));

-- secrets: İSTEMCİYE TAMAMEN KAPALI.
-- Bilinçli olarak HİÇBİR politika tanımlanmıyor: RLS açık + politika yok =
-- anon/authenticated için SELECT/INSERT/UPDATE/DELETE hepsi RED. Kendi satırı
-- dahil hiçbir istemci okuyamaz. Erişim yalnızca security definer RPC'lerden:
-- yazma set_secret, okuma make_guess içinde sunucuda (2. adım).
-- Ek emniyet kemeri: tablo grant'lerini de kaldır.
revoke all on table public.secrets from anon, authenticated;

-- guesses: maçın oyuncuları kendi maçlarının TÜM tahminlerini okuyabilir
-- (kendi + rakip tahmin ve feedback — feedback pozisyon bilgisi sızdırmıyor).
-- INSERT politikası bilinçli olarak YOK: tahminler make_guess RPC'sinden geçer.
drop policy if exists "guesses_select_match_players" on public.guesses;
create policy "guesses_select_match_players"
  on public.guesses for select
  using (public.is_match_player(match_id));

-- presence: maçın oyuncuları okuyabilir; herkes yalnızca KENDİ satırını
-- yazabilir (heartbeat istemciden gelebilir). Forfeit kararını RPC verecek.
drop policy if exists "presence_select_match_players" on public.presence;
create policy "presence_select_match_players"
  on public.presence for select
  using (public.is_match_player(match_id));

drop policy if exists "presence_insert_own" on public.presence;
create policy "presence_insert_own"
  on public.presence for insert
  with check (auth.uid() = player and public.is_match_player(match_id));

drop policy if exists "presence_update_own" on public.presence;
create policy "presence_update_own"
  on public.presence for update
  using (auth.uid() = player)
  with check (auth.uid() = player);

-- 7) updated_at otomatik tazelensin --------------------------------------------
-- (set_updated_at profiles migration'ında da tanımlı; idempotentlik için
-- burada da create or replace ediliyor — panelde tek başına çalıştırılabilsin.)

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists matches_set_updated_at on public.matches;
create trigger matches_set_updated_at
  before update on public.matches
  for each row execute function public.set_updated_at();

-- 8) Doğrulama (panelde elle denenebilir) ---------------------------------------
--
-- secrets RLS testi: aşağıdaki sorgular authenticated/anon rolüyle 0 satır
-- dönmeli ya da yetki hatası vermeli — rakibin gizli sayısı HİÇBİR koşulda
-- istemciden okunamamalı.
--
--   -- SQL Editor'de istemci rolünü taklit et:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
--   select * from public.secrets;            -- beklenen: permission denied (revoke)
--   insert into public.secrets values
--     ('00000000-0000-0000-0000-000000000002',
--      '00000000-0000-0000-0000-000000000001', '123');
--                                             -- beklenen: permission denied
--   reset role;
--
--   -- matches: oyuncusu olmadığın maç görünmemeli:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
--   select count(*) from public.matches;     -- beklenen: yalnızca kendi maçların
--   update public.matches set status = 'finished';
--                                             -- beklenen: 0 satır etkilenir (politika yok)
--   reset role;
