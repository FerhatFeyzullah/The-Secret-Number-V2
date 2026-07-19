-- ══════════════════════════════════════════════════════════════════════════
-- TURNUVA — "Gizemli Kule" · Faz 1: Şema + statik kat konfigü + kelime seçici
--
-- Haftalık, süreli, tek modlu PvE gauntlet. Oyuncu 300 Veri ile girer, 10 katlı
-- kuleyi tırmanır; her kat = sunucunun tuttuğu gizli KELİMEYİ (kelime modu,
-- Wordle) süre bitmeden çöz. Tahmin sınırsız (satranç saati). 3 can; kat
-- başarısız = -1 can + yeni kelimeyle tekrar; 0 can = elenme (o hafta kapanır,
-- tekrar giriş/diriliş yok). Katlar zorlaştıkça (kelime uzar, süre kısalır,
-- "fantastik" twist'ler) risk artar. Boss katları (5 & 10) protokol/sinyal ödülü.
--
-- ─── GİZLİLİK MİMARİSİ (kritik, seasons/secrets deseni) ────────────────────
-- Gizli kelime YALNIZ sunucuda (tower_floor_state). O tablo: RLS açık + politika
-- YOK + revoke all → anon/authenticated hiçbir satırı okuyamaz. Yalnız
-- security-definer RPC'ler (Faz 2) görür. İstemci tahmini gönderir, sunucu
-- _word_marks ile değerlendirir; cevabı ASLA döndürmez (kat çözülene/elenene dek).
--
-- Bu migration YALNIZ şema + statik veri; iş mantığı 20260718000006_tower_rpcs.
-- Roller/veri: oyuncu = auth.uid() = profiles.id. Mutasyonlar Faz 2 RPC'lerinden.
-- ══════════════════════════════════════════════════════════════════════════

-- ─── 1) Dönem: haftalık turnuva penceresi (seasons deseni; istemciye KAPALI) ─
-- Her hafta cron (Faz 3) yeni satır açar. "Güncel dönem" = max(id). tower_runs
-- (user_id, period_id) benzersizdir → oyuncu dönem başına bir kez girer.
create table if not exists public.tower_periods (
  id         bigint generated always as identity primary key,
  started_at timestamptz not null default now()
);
-- İlk dönem (yoksa).
insert into public.tower_periods (started_at)
  select now() where not exists (select 1 from public.tower_periods);
-- İSTEMCİYE TAMAMEN KAPALI (seasons deseni): RLS açık + politika yok + revoke.
-- ends_at istemciye get_tower_state içinde türetilir (gelecek Pazartesi 00:00 UTC).
alter table public.tower_periods enable row level security;
revoke all on table public.tower_periods from anon, authenticated;

-- ─── 2) Kat konfigü: statik zorluk eğrisi (seed'li; istemciye OKUNUR) ───────
-- Tüm oyuncular aynı 10 kat konfigünü görür (uzunluk/süre/twist rozetleri/ödül
-- önizleme). Gizli KELİME burada DEĞİL — kelime koşuya özel, tower_floor_state'te.
--   twists jsonb: [{"kind":"fog","params":{"hidden":1}}, ...]
--     kind ∈ fog | time_thief | shuffle | cursed | blind | liar | lock | double
--   boss_pool jsonb: sırayla denenecek ödüller [{"kind":"protocol","id":"..."}, ...]
--     (sahip olunmayan İLK item verilir; hepsi sahipse dup_veri Veri'ye çevrilir)
create table if not exists public.tower_floors (
  floor_no    int primary key check (floor_no between 1 and 10),
  word_length int not null check (word_length between 4 and 6),
  clock_ms    int not null check (clock_ms > 0),
  twists      jsonb not null default '[]'::jsonb,
  veri_reward int not null default 0 check (veri_reward >= 0),
  is_boss     boolean not null default false,
  boss_pool   jsonb not null default '[]'::jsonb,
  dup_veri    int not null default 0 check (dup_veri >= 0)
);
alter table public.tower_floors enable row level security;
drop policy if exists tower_floors_read on public.tower_floors;
create policy tower_floors_read on public.tower_floors
  for select using (auth.uid() is not null);
revoke all on table public.tower_floors from anon, authenticated;
grant select on table public.tower_floors to authenticated;

-- Seed (idempotent: on conflict do update → migration'ı re-run ederek yeniden ayarla).
insert into public.tower_floors
  (floor_no, word_length, clock_ms, twists, veri_reward, is_boss, boss_pool, dup_veri)
values
  (1,  4, 150000, '[]'::jsonb,                                                         60, false, '[]'::jsonb, 0),
  (2,  4, 140000, '[]'::jsonb,                                                         80, false, '[]'::jsonb, 0),
  (3,  4, 130000, '[{"kind":"fog","params":{"hidden":1}}]'::jsonb,                    110, false, '[]'::jsonb, 0),
  (4,  5, 120000, '[{"kind":"time_thief","params":{"steal_ms":5000}}]'::jsonb,        140, false, '[]'::jsonb, 0),
  (5,  5, 105000, '[{"kind":"shuffle"},{"kind":"blind"}]'::jsonb,                     240, true,
     '[{"kind":"protocol","id":"info_postest"},{"kind":"signal","id":"sig_eureka"}]'::jsonb, 400),
  (6,  5, 100000, '[{"kind":"cursed","params":{"letter":"k","penalty_ms":7000}}]'::jsonb, 180, false, '[]'::jsonb, 0),
  (7,  6,  95000, '[{"kind":"time_thief","params":{"steal_ms":9000}}]'::jsonb,        220, false, '[]'::jsonb, 0),
  (8,  6,  88000, '[{"kind":"lock","params":{"pos":3}}]'::jsonb,                      260, false, '[]'::jsonb, 0),
  (9,  6,  82000, '[{"kind":"liar"},{"kind":"fog","params":{"hidden":1}}]'::jsonb,    300, false, '[]'::jsonb, 0),
  (10, 6,  75000, '[{"kind":"shuffle"},{"kind":"liar"}]'::jsonb,                      500, true,
     '[{"kind":"protocol","id":"def_reflect"},{"kind":"signal","id":"sig_locked"}]'::jsonb, 800)
on conflict (floor_no) do update set
  word_length = excluded.word_length,
  clock_ms    = excluded.clock_ms,
  twists      = excluded.twists,
  veri_reward = excluded.veri_reward,
  is_boss     = excluded.is_boss,
  boss_pool   = excluded.boss_pool,
  dup_veri    = excluded.dup_veri;

-- ─── 3) Koşu: oyuncunun bir dönemdeki tırmanışı (istemciye SAHİP okur) ──────
create table if not exists public.tower_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  period_id      bigint not null references public.tower_periods (id),
  current_floor  int  not null default 1  check (current_floor between 1 and 10),
  lives          int  not null default 3  check (lives >= 0),
  status         text not null default 'active' check (status in ('active', 'cleared', 'eliminated')),
  floors_cleared int  not null default 0  check (floors_cleared between 0 and 10),
  started_at     timestamptz not null default now(),
  win_streak     int  not null default 0,   -- kupa için ardışık geçiş (kayıpta 0'a döner)
  unique (user_id, period_id)   -- ← tekrar giriş YOK / diriliş YOK
);
-- Canlı/eski tablo için idempotent kolon ekleme.
alter table public.tower_runs add column if not exists win_streak int not null default 0;
create index if not exists tower_runs_user_idx on public.tower_runs (user_id);
alter table public.tower_runs enable row level security;
drop policy if exists tower_runs_select_own on public.tower_runs;
create policy tower_runs_select_own on public.tower_runs
  for select using (user_id = auth.uid());
revoke all on table public.tower_runs from anon, authenticated;
grant select on table public.tower_runs to authenticated;

-- ─── 4) Aktif kat durumu: GİZLİ kelime + saat (SUNUCU-ONLY, seasons deseni) ─
-- Koşu başına en fazla bir aktif kat (run_id pk). Kat çözülünce/başarısız olunca
-- Faz 2 RPC'si bu satırı siler; sonraki kat / retry yeni satır açar.
create table if not exists public.tower_floor_state (
  run_id          uuid primary key references public.tower_runs (id) on delete cascade,
  floor_no        int  not null,
  secret          text not null,           -- GİZLİ (asla istemciye)
  secret2         text,                     -- 'double' twist'i (v2); v1'de null
  solved1         boolean not null default false,
  solved2         boolean not null default false,
  clock_ms        int  not null,            -- kalan bütçe (twist'ler bunu keser); remaining = clock_ms - elapsed
  turn_started_at timestamptz not null default now(),
  blind_used      boolean not null default false,   -- 'blind' bir kez
  lie_used        boolean not null default false    -- 'liar' bir kez
);
-- Tamamen kapalı: RLS açık + politika YOK + revoke → istemci ASLA okuyamaz.
alter table public.tower_floor_state enable row level security;
revoke all on table public.tower_floor_state from anon, authenticated;

-- ─── 5) Tahmin geçmişi: GÖSTERİLEN (twist'lerle bozulmuş) marks (SAHİP okur) ─
-- Gerçek marks DEĞİL — twist'lerden geçmiş gösterim marks'ı ('G'/'Y'/'X'/'?').
-- Gizli kelime içermez → sızma yok. Yalnız AKTİF kat tahtasını boyamak için;
-- kat çözülünce/başarısız olunca Faz 2 temizler.
create table if not exists public.tower_guesses (
  id          bigint generated always as identity primary key,
  run_id      uuid not null references public.tower_runs (id) on delete cascade,
  floor_no    int  not null,
  guess       text not null,
  marks       text not null,               -- gösterim: G/Y/X, gizlenen pozisyon '?'
  green_count int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists tower_guesses_run_floor_idx on public.tower_guesses (run_id, floor_no, id);
alter table public.tower_guesses enable row level security;
drop policy if exists tower_guesses_select_own on public.tower_guesses;
create policy tower_guesses_select_own on public.tower_guesses
  for select using (
    exists (select 1 from public.tower_runs r
             where r.id = tower_guesses.run_id and r.user_id = auth.uid())
  );
revoke all on table public.tower_guesses from anon, authenticated;
grant select on table public.tower_guesses to authenticated;

-- ─── 6) Ödül günlüğü + idempotency (SAHİP okur) ────────────────────────────
-- Ödül anında profiles.veri / owned_protocols / owned_signals'a işlenir; bu tablo
-- yalnız günlük + çifte-grant engeli (PK run_id, floor_no).
create table if not exists public.tower_rewards (
  run_id     uuid not null references public.tower_runs (id) on delete cascade,
  floor_no   int  not null,
  veri       int  not null default 0,
  kupa       int  not null default 0,   -- kat geçişinde kazanılan Kupa (rating)
  item_kind  text check (item_kind in ('protocol', 'signal')),  -- null = yalnız Veri
  item_id    text,
  converted  boolean not null default false,   -- boss item zaten sahip → Veri'ye çevrildi
  created_at timestamptz not null default now(),
  primary key (run_id, floor_no)
);
alter table public.tower_rewards add column if not exists kupa int not null default 0;
alter table public.tower_rewards enable row level security;
drop policy if exists tower_rewards_select_own on public.tower_rewards;
create policy tower_rewards_select_own on public.tower_rewards
  for select using (
    exists (select 1 from public.tower_runs r
             where r.id = tower_rewards.run_id and r.user_id = auth.uid())
  );
revoke all on table public.tower_rewards from anon, authenticated;
grant select on table public.tower_rewards to authenticated;

-- ─── 7) Kelime seçici (server-only) ────────────────────────────────────────
-- secret_words havuzundan verilen uzunlukta rastgele kelime. Kelime istemciye
-- okunabilir olsa da (secret_words RLS açık), HANGİ kelimenin bir kata atandığı
-- yalnız tower_floor_state'te (kapalı) → havuzu bilmek hile sağlamaz (PvP'deki
-- gibi). p_avoid: koşu içi tekrar kaçınması (aynı kelimeyi iki kez verme).
create or replace function public._tower_pick_word(p_length int, p_avoid text[] default '{}')
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select word from secret_words
   where length = p_length
     and not (word = any(coalesce(p_avoid, '{}'::text[])))
   order by random()
   limit 1;
$$;
revoke execute on function public._tower_pick_word(int, text[]) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════
-- MANUEL DOĞRULAMA (Supabase SQL editor):
--
--   -- Seed 10 kat geldi mi?
--   select floor_no, word_length, clock_ms, twists, veri_reward, is_boss from tower_floors order by floor_no;
--   -- Kelime seçici çalışıyor mu?
--   select public._tower_pick_word(4), public._tower_pick_word(5), public._tower_pick_word(6);
--   -- İlk dönem açıldı mı?
--   select * from tower_periods;
--
--   -- RLS: authenticated GİZLİ tabloları okuyamamalı, konfigü okuyabilmeli.
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<USER_A_UUID>"}';
--   select count(*) from tower_floors;          -- OK (>0)
--   select count(*) from tower_periods;         -- 0 satır (RLS politika yok → gizli)
--   select count(*) from tower_floor_state;     -- 0 satır (gizli)
-- ══════════════════════════════════════════════════════════════════════════
