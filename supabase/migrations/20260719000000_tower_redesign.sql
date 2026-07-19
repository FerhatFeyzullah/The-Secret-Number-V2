-- ══════════════════════════════════════════════════════════════════════════
-- TURNUVA — "Gizemli Kule" · Yetenek yeniden tasarımı (2026-07-19)
--
-- Yetenekler 4'e indirildi ve yeniden tanımlandı; eskiler (shuffle/blind/liar/
-- lock/double) KALDIRILDI:
--   🌫️ fog (Sis)         : gösterimde YALNIZ yeşil+sarı maskelenir ('P'); gri (X) kalır.
--   ⏳ time_thief         : yanlış tahminde her GRİ (X) hane için -1sn.
--   🚫 cursed (Lanetli)   : gizlide OLMAYAN 1-2 harf lanetli (istemciye açık); guess'te
--                           her geçiş -3sn.
--   🧠 memory (Hafıza)    : tamamen istemci-taraflı (sorgu 3sn sonra kaybolur).
--
-- Ek mekanikler:
--   • ERTELENMİŞ SAAT: kat açılınca started=false; saat begin_tower_floor ile başlar
--     (ilk-karşılaşma modalı kapanınca). tower_guess başlamamış katı auto-begin eder.
--   • KATTAN ÇIKIŞ: leave_tower_floor → başlamış kat için -1 can (istemci onaylar).
--   • Lanetli harfler kat açılışında seçilir (gizlide yok → güvenle istemciye döner).
-- ══════════════════════════════════════════════════════════════════════════

-- ─── 1) Şema: started + cursed_letters ─────────────────────────────────────
alter table public.tower_floor_state add column if not exists started boolean not null default false;
alter table public.tower_floor_state add column if not exists cursed_letters text[] not null default '{}';

-- ─── 2) Kat konfigü yeniden seed (4 yetenek, harf 4→5→6, süre 120/180sn) ───
insert into public.tower_floors
  (floor_no, word_length, clock_ms, twists, veri_reward, is_boss, boss_pool, dup_veri)
values
  (1,  4, 120000, '[]'::jsonb,                                                          60, false, '[]'::jsonb, 0),
  (2,  4, 120000, '[]'::jsonb,                                                          80, false, '[]'::jsonb, 0),
  (3,  4, 120000, '[{"kind":"fog"}]'::jsonb,                                           110, false, '[]'::jsonb, 0),
  (4,  4, 180000, '[{"kind":"time_thief"}]'::jsonb,                                    140, false, '[]'::jsonb, 0),
  (5,  5, 180000, '[{"kind":"cursed","params":{"count":1}},{"kind":"time_thief"}]'::jsonb, 240, true,
     '[{"kind":"protocol","id":"info_postest"},{"kind":"signal","id":"sig_eureka"}]'::jsonb, 400),
  (6,  5, 120000, '[{"kind":"memory"}]'::jsonb,                                        180, false, '[]'::jsonb, 0),
  (7,  5, 180000, '[{"kind":"fog"},{"kind":"time_thief"}]'::jsonb,                     220, false, '[]'::jsonb, 0),
  (8,  5, 180000, '[{"kind":"cursed","params":{"count":2}}]'::jsonb,                   260, false, '[]'::jsonb, 0),
  (9,  6, 120000, '[{"kind":"memory"},{"kind":"fog"}]'::jsonb,                         300, false, '[]'::jsonb, 0),
  (10, 6, 180000, '[{"kind":"memory"},{"kind":"time_thief"},{"kind":"cursed","params":{"count":2}}]'::jsonb, 500, true,
     '[{"kind":"protocol","id":"def_reflect"},{"kind":"signal","id":"sig_locked"}]'::jsonb, 800)
on conflict (floor_no) do update set
  word_length = excluded.word_length, clock_ms = excluded.clock_ms, twists = excluded.twists,
  veri_reward = excluded.veri_reward, is_boss = excluded.is_boss,
  boss_pool = excluded.boss_pool, dup_veri = excluded.dup_veri;

-- ─── 3) Lanetli harf seçici: gizlide OLMAYAN harflerden count tanesi ───────
create or replace function public._tower_pick_cursed(p_secret text, p_count int)
returns text[]
language sql
volatile
security definer
set search_path = public
as $$
  select coalesce(array_agg(l), '{}')
  from (
    select l
    from unnest(array['a','b','c','ç','d','e','f','g','ğ','h','ı','i','j','k','l','m',
                      'n','o','ö','p','r','s','ş','t','u','ü','v','y','z']) as l
    where position(l in p_secret) = 0
    order by random()
    limit greatest(0, p_count)
  ) picked;
$$;
revoke execute on function public._tower_pick_cursed(text, int) from public, anon, authenticated;

-- ─── 4) _tower_open_floor: started=false + lanetli harf seç ─────────────────
create or replace function public._tower_open_floor(p_run_id uuid, p_floor int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fl public.tower_floors;
  w  text;
  v_cursed text[] := '{}';
  cnt int;
begin
  select * into fl from tower_floors where floor_no = p_floor;
  if not found then
    raise exception 'no_active_floor';
  end if;
  w := _tower_pick_word(fl.word_length);
  -- Lanetli harf twist'i varsa gizlide olmayan count harf seç (istemciye açılır).
  if exists (select 1 from jsonb_array_elements(fl.twists) t where t.value ->> 'kind' = 'cursed') then
    cnt := coalesce((select (t.value -> 'params' ->> 'count')::int
                       from jsonb_array_elements(fl.twists) t where t.value ->> 'kind' = 'cursed' limit 1), 1);
    v_cursed := _tower_pick_cursed(w, cnt);
  end if;
  insert into tower_floor_state (run_id, floor_no, secret, secret2, clock_ms, turn_started_at, started, cursed_letters)
  values (p_run_id, p_floor, w, null, fl.clock_ms, now(), false, v_cursed)
  on conflict (run_id) do update set
    floor_no        = excluded.floor_no,
    secret          = excluded.secret,
    secret2         = null,
    solved1         = false,
    solved2         = false,
    clock_ms        = excluded.clock_ms,
    turn_started_at = now(),
    started         = false,
    cursed_letters  = excluded.cursed_letters,
    blind_used      = false,
    lie_used        = false;
end;
$$;
revoke execute on function public._tower_open_floor(uuid, int) from public, anon, authenticated;

-- ─── 5) _tower_state_json: started + cursed_letters + not-started remaining ─
create or replace function public._tower_state_json(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pid      bigint;
  v_ends   timestamptz;
  run      public.tower_runs;
  st       public.tower_floor_state;
  v_floors jsonb;
  v_active jsonb := null;
  v_veri   int := 0;
  has_run  boolean := false;
begin
  pid := (select max(id) from tower_periods);
  select started_at + interval '3 days' into v_ends from tower_periods where id = pid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'floor_no', floor_no, 'word_length', word_length, 'clock_ms', clock_ms,
           'twists', twists, 'veri_reward', veri_reward, 'is_boss', is_boss,
           'item_preview', case when jsonb_array_length(boss_pool) > 0 then boss_pool -> 0 else null end
         ) order by floor_no), '[]'::jsonb)
    into v_floors from tower_floors;

  select * into run from tower_runs where user_id = p_uid and period_id = pid;
  has_run := found;

  if has_run and run.status = 'active' then
    select * into st from tower_floor_state where run_id = run.id;
    if found then
      v_active := jsonb_build_object(
        'floor_no', st.floor_no,
        'word_length', (select word_length from tower_floors where floor_no = st.floor_no),
        'started', st.started,
        'remaining_ms', case when st.started
             then greatest(0, st.clock_ms - floor(extract(epoch from (now() - st.turn_started_at)) * 1000)::int)
             else st.clock_ms end,
        'twists', (select twists from tower_floors where floor_no = st.floor_no),
        'cursed_letters', to_jsonb(st.cursed_letters),
        'guesses', (select coalesce(jsonb_agg(jsonb_build_object(
                             'guess', guess, 'marks', marks, 'green_count', green_count) order by id), '[]'::jsonb)
                      from tower_guesses where run_id = run.id and floor_no = st.floor_no),
        'solved1', st.solved1, 'solved2', st.solved2
      );
    end if;
  end if;

  select veri into v_veri from profiles where id = p_uid;

  return jsonb_build_object(
    'period', jsonb_build_object('id', pid, 'ends_at', v_ends),
    'run', case when has_run then jsonb_build_object(
             'current_floor', run.current_floor, 'lives', run.lives, 'status', run.status,
             'floors_cleared', run.floors_cleared, 'win_streak', run.win_streak) else null end,
    'floors', v_floors, 'active', v_active, 'veri', coalesce(v_veri, 0)
  );
end;
$$;
revoke execute on function public._tower_state_json(uuid) from public, anon, authenticated;

-- ─── 6) begin_tower_floor: saati BAŞLAT (modal kapanınca) — idempotent ──────
create or replace function public.begin_tower_floor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  run public.tower_runs;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into run from tower_runs
   where user_id = uid and period_id = (select max(id) from tower_periods);
  if not found then raise exception 'no_active_run'; end if;
  if run.status <> 'active' then raise exception 'tower_not_active'; end if;
  -- Yalnız henüz başlamamış aktif katı başlat (tekrar çağrı no-op).
  update tower_floor_state
     set started = true, turn_started_at = now()
   where run_id = run.id and started = false;
  return _tower_state_json(uid);
end;
$$;
revoke execute on function public.begin_tower_floor() from public, anon;
grant execute on function public.begin_tower_floor() to authenticated;

-- ─── 7) leave_tower_floor: başlamış kattan çıkış → -1 can ───────────────────
create or replace function public.leave_tower_floor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  run public.tower_runs;
  st  public.tower_floor_state;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into run from tower_runs
   where user_id = uid and period_id = (select max(id) from tower_periods);
  if not found then raise exception 'no_active_run'; end if;
  if run.status <> 'active' then raise exception 'tower_not_active'; end if;
  select * into st from tower_floor_state where run_id = run.id;
  if not found then raise exception 'no_active_floor'; end if;
  -- Başlamamış kat (intro modal aşaması) → çıkış SERBEST, can gitmez.
  if not st.started then
    return jsonb_build_object('status', 'left', 'lives', run.lives);
  end if;
  -- Başlamış kat → kat başarısız (can düş / elenme).
  return _tower_fail_floor(run, st);
end;
$$;
revoke execute on function public.leave_tower_floor() from public, anon;
grant execute on function public.leave_tower_floor() to authenticated;

-- ─── 8) tower_guess: yeni twist mantığı + not-started auto-begin ────────────
create or replace function public.tower_guess(p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  run public.tower_runs;
  fl  public.tower_floors;
  st  public.tower_floor_state;
  n   int;
  elapsed   int;
  remaining int;
  real_marks text;
  disp text;
  green int;
  gray int;
  cl text;
  occ int;
  reward jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into run from tower_runs
   where user_id = uid and period_id = (select max(id) from tower_periods);
  if not found then raise exception 'no_active_run'; end if;
  if run.status <> 'active' then raise exception 'tower_not_active'; end if;
  select * into st from tower_floor_state where run_id = run.id;
  if not found then raise exception 'no_active_floor'; end if;
  select * into fl from tower_floors where floor_no = st.floor_no;
  n := fl.word_length;

  -- Kat henüz başlamadıysa ilk tahminle başlat (güvenlik; normalde begin ile başlar).
  if not st.started then
    st.started := true;
    st.turn_started_at := now();
    update tower_floor_state set started = true, turn_started_at = now() where run_id = run.id;
  end if;

  -- Saat (ön-kontrol): süre dolmuşsa kat başarısız.
  elapsed := floor(extract(epoch from (now() - st.turn_started_at)) * 1000)::int;
  remaining := st.clock_ms - elapsed;
  if remaining <= 0 then
    return _tower_fail_floor(run, st);
  end if;

  -- Geçerlilik: uzunluk + havuz üyeliği.
  if char_length(p_guess) <> n then raise exception 'invalid_digits'; end if;
  if not exists (select 1 from secret_words where word = p_guess) then
    raise exception 'word_not_in_pool';
  end if;

  real_marks := _word_marks(st.secret, p_guess);

  -- ── KAZANMA: hiçbir güç dokunamaz → ödül + ilerle ──
  if p_guess = st.secret then
    green := n;
    insert into tower_guesses (run_id, floor_no, guess, marks, green_count)
    values (run.id, st.floor_no, p_guess, real_marks, green);
    reward := _tower_grant_floor_reward(run, fl);
    if st.floor_no >= 10 then
      update tower_runs set status = 'cleared', floors_cleared = 10 where id = run.id;
      delete from tower_floor_state where run_id = run.id;
      delete from tower_guesses where run_id = run.id;
      return jsonb_build_object('status', 'tower_cleared', 'marks', real_marks, 'green_count', green,
        'lives', run.lives, 'reward', reward,
        'reveal', jsonb_build_object('secret', st.secret, 'secret2', st.secret2));
    else
      update tower_runs set current_floor = st.floor_no + 1,
             floors_cleared = greatest(floors_cleared, st.floor_no) where id = run.id;
      delete from tower_floor_state where run_id = run.id;
      delete from tower_guesses where run_id = run.id and floor_no = st.floor_no;
      return jsonb_build_object('status', 'floor_cleared', 'marks', real_marks, 'green_count', green,
        'lives', run.lives, 'reward', reward,
        'reveal', jsonb_build_object('secret', st.secret, 'secret2', st.secret2));
    end if;
  end if;

  -- ── YANLIŞ: zaman etkileri ──
  -- Lanetli Harf: guess'teki her lanetli harf GEÇİŞİ için -3sn.
  if array_length(st.cursed_letters, 1) is not null then
    foreach cl in array st.cursed_letters loop
      occ := char_length(p_guess) - char_length(replace(p_guess, cl, ''));
      if occ > 0 then
        st.clock_ms := st.clock_ms - 3000 * occ;
      end if;
    end loop;
  end if;
  -- Zaman Hırsızı: gerçek sonuçtaki her GRİ (X) hane için -1sn.
  if exists (select 1 from jsonb_array_elements(fl.twists) t where t.value ->> 'kind' = 'time_thief') then
    gray := char_length(real_marks) - char_length(replace(real_marks, 'X', ''));
    st.clock_ms := st.clock_ms - 1000 * gray;
  end if;

  -- ── YANLIŞ: gösterim — Sis (yeşil+sarı → 'P'; gri kalır) ──
  if exists (select 1 from jsonb_array_elements(fl.twists) t where t.value ->> 'kind' = 'fog') then
    disp := translate(real_marks, 'GY', 'PP');
  else
    disp := real_marks;
  end if;
  green := char_length(disp) - char_length(replace(disp, 'G', ''));

  update tower_floor_state set clock_ms = st.clock_ms where run_id = run.id;

  insert into tower_guesses (run_id, floor_no, guess, marks, green_count)
  values (run.id, st.floor_no, p_guess, disp, green);

  -- Zaman çalındıysa süre bitmiş olabilir → kat başarısız.
  elapsed := floor(extract(epoch from (now() - st.turn_started_at)) * 1000)::int;
  remaining := st.clock_ms - elapsed;
  if remaining <= 0 then
    return _tower_fail_floor(run, st);
  end if;

  return jsonb_build_object('status', 'playing', 'marks', disp, 'green_count', green,
    'remaining_ms', remaining, 'lives', run.lives, 'solved1', st.solved1, 'solved2', st.solved2);
end;
$$;
revoke execute on function public.tower_guess(text) from public, anon;
grant execute on function public.tower_guess(text) to authenticated;

-- ─── 9) claim_tower_timeout: başlamamış katta timeout YOK ───────────────────
create or replace function public.claim_tower_timeout()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  run public.tower_runs;
  st  public.tower_floor_state;
  elapsed int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into run from tower_runs
   where user_id = uid and period_id = (select max(id) from tower_periods);
  if not found then raise exception 'no_active_run'; end if;
  if run.status <> 'active' then raise exception 'tower_not_active'; end if;
  select * into st from tower_floor_state where run_id = run.id;
  if not found then raise exception 'no_active_floor'; end if;
  if not st.started then raise exception 'clock_not_expired'; end if;
  elapsed := floor(extract(epoch from (now() - st.turn_started_at)) * 1000)::int;
  if st.clock_ms - elapsed > 0 then raise exception 'clock_not_expired'; end if;
  return _tower_fail_floor(run, st);
end;
$$;
revoke execute on function public.claim_tower_timeout() from public, anon;
grant execute on function public.claim_tower_timeout() to authenticated;

notify pgrst, 'reload schema';
