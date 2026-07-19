-- ══════════════════════════════════════════════════════════════════════════
-- TURNUVA — "Gizemli Kule" · Faz 2: RPC'ler (giriş / durum / oynanış / ödül)
--
-- Tüm iş mantığı SUNUCU-OTORİTER (istemci gizli kelimeyi asla görmez):
--   enter_tower         300 Veri düş, koşu aç, kat 1'i başlat
--   get_tower_state     ana ekran/resume: dönem + koşu + 10 kat konfigü + aktif kat
--   start_tower_floor   "Başla/Devam/Tekrar Dene" (idempotent): kelime seç, saati kur
--   tower_guess         ÇEKİRDEK: değerlendir + twist'lerle gösterim marks'ı boz +
--                       kazanınca ödül+ilerle / süre bitince can düş
--   claim_tower_timeout istemci geri sayımı 0'a inince: süre doğrula → can düş
--
-- Gizli kelime kat çözülünce/elenince floor_state ile silinir; o yüzden reveal
-- (kelime ifşası) tower_guess/claim_tower_timeout yanıtında INLINE döner.
-- Hata: raise exception '<token>' → istemci ERROR_MESSAGES ile Türkçeye çevirir.
-- Desenler: clans (RLS/definer/veri), word_wordle_marks (_word_marks), seasons.
-- ══════════════════════════════════════════════════════════════════════════

-- ─── İç yardımcı: bir katı aç (kelime seç + saat kur) ──────────────────────
create or replace function public._tower_open_floor(p_run_id uuid, p_floor int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fl public.tower_floors;
  w  text;
  w2 text := null;
begin
  select * into fl from tower_floors where floor_no = p_floor;
  if not found then
    raise exception 'no_active_floor';
  end if;
  w := _tower_pick_word(fl.word_length);
  -- 'double' twist'i (v2): ikinci gizli kelime (ilkinden farklı). v1 seed'inde yok.
  if exists (select 1 from jsonb_array_elements(fl.twists) t where t.value->>'kind' = 'double') then
    w2 := _tower_pick_word(fl.word_length, array[w]);
  end if;
  insert into tower_floor_state (run_id, floor_no, secret, secret2, clock_ms, turn_started_at)
  values (p_run_id, p_floor, w, w2, fl.clock_ms, now())
  on conflict (run_id) do update set
    floor_no        = excluded.floor_no,
    secret          = excluded.secret,
    secret2         = excluded.secret2,
    solved1         = false,
    solved2         = false,
    clock_ms        = excluded.clock_ms,
    turn_started_at = now(),
    blind_used      = false,
    lie_used        = false;
end;
$$;
revoke execute on function public._tower_open_floor(uuid, int) from public, anon, authenticated;

-- ─── İç yardımcı: tam durum jsonb (istemciye; GİZLİ kelime içermez) ────────
create or replace function public._tower_state_json(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pid     bigint;
  v_ends  timestamptz;
  run     public.tower_runs;
  st      public.tower_floor_state;
  v_floors jsonb;
  v_active jsonb := null;
  v_veri   int := 0;
  has_run  boolean := false;
begin
  pid := (select max(id) from tower_periods);
  -- Dönem 3 gün sürer: bu dönemin başlangıcı + 3 gün.
  select started_at + interval '3 days' into v_ends from tower_periods where id = pid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'floor_no', floor_no,
           'word_length', word_length,
           'clock_ms', clock_ms,
           'twists', twists,
           'veri_reward', veri_reward,
           'is_boss', is_boss,
           'item_preview', case when jsonb_array_length(boss_pool) > 0 then boss_pool -> 0 else null end
         ) order by floor_no), '[]'::jsonb)
    into v_floors
    from tower_floors;

  select * into run from tower_runs where user_id = p_uid and period_id = pid;
  has_run := found;

  if has_run and run.status = 'active' then
    select * into st from tower_floor_state where run_id = run.id;
    if found then
      v_active := jsonb_build_object(
        'floor_no', st.floor_no,
        'word_length', (select word_length from tower_floors where floor_no = st.floor_no),
        'remaining_ms', greatest(0, st.clock_ms - floor(extract(epoch from (now() - st.turn_started_at)) * 1000)::int),
        'twists', (select twists from tower_floors where floor_no = st.floor_no),
        'guesses', (select coalesce(jsonb_agg(jsonb_build_object(
                             'guess', guess, 'marks', marks, 'green_count', green_count) order by id), '[]'::jsonb)
                      from tower_guesses where run_id = run.id and floor_no = st.floor_no),
        'solved1', st.solved1,
        'solved2', st.solved2
      );
    end if;
  end if;

  select veri into v_veri from profiles where id = p_uid;

  return jsonb_build_object(
    'period', jsonb_build_object('id', pid, 'ends_at', v_ends),
    'run', case when has_run then jsonb_build_object(
             'current_floor', run.current_floor,
             'lives', run.lives,
             'status', run.status,
             'floors_cleared', run.floors_cleared,
             'win_streak', run.win_streak) else null end,
    'floors', v_floors,
    'active', v_active,
    'veri', coalesce(v_veri, 0)
  );
end;
$$;
revoke execute on function public._tower_state_json(uuid) from public, anon, authenticated;

-- ─── İç yardımcı: kat ödülü ver (idempotent) ───────────────────────────────
create or replace function public._tower_grant_floor_reward(p_run public.tower_runs, p_fl public.tower_floors)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me          public.profiles;
  it          jsonb;
  v_kind      text;
  v_id        text;
  v_item_kind text := null;
  v_item_id   text := null;
  v_converted boolean := false;
  granted     boolean := false;
  v_veri      int := p_fl.veri_reward;
  new_streak  int;
  v_kupa      int;
  existing    jsonb;
begin
  -- Çifte-grant engeli: zaten verildiyse kayıtlıyı döndür.
  select jsonb_build_object('veri', veri, 'kupa', kupa, 'item_kind', item_kind, 'item_id', item_id, 'converted', converted)
    into existing from tower_rewards where run_id = p_run.id and floor_no = p_fl.floor_no;
  if found then
    return existing;
  end if;

  select * into me from profiles where id = p_run.user_id for update;

  if p_fl.is_boss then
    for it in select value from jsonb_array_elements(p_fl.boss_pool) loop
      v_kind := it ->> 'kind';
      v_id   := it ->> 'id';
      if v_kind = 'protocol' and not (v_id = any(me.owned_protocols)) then
        update profiles set owned_protocols = array_append(owned_protocols, v_id) where id = me.id;
        v_item_kind := 'protocol'; v_item_id := v_id; granted := true; exit;
      elsif v_kind = 'signal' and not (v_id = any(me.owned_signals)) then
        update profiles set owned_signals = array_append(owned_signals, v_id) where id = me.id;
        v_item_kind := 'signal'; v_item_id := v_id; granted := true; exit;
      end if;
    end loop;
    if not granted then
      v_veri := v_veri + p_fl.dup_veri;   -- hepsi sahip → Veri'ye çevir
      v_converted := true;
    end if;
  end if;

  -- Kupa (rating): ardışık geçişte +2 (streak1→10, 2→12...); kayıpta streak 0'a döner.
  new_streak := p_run.win_streak + 1;
  v_kupa := 8 + 2 * new_streak;
  update tower_runs set win_streak = new_streak where id = p_run.id;

  update profiles set veri = veri + v_veri, rating = rating + v_kupa where id = me.id;

  insert into tower_rewards (run_id, floor_no, veri, kupa, item_kind, item_id, converted)
  values (p_run.id, p_fl.floor_no, v_veri, v_kupa, v_item_kind, v_item_id, v_converted);

  return jsonb_build_object('veri', v_veri, 'kupa', v_kupa, 'item_kind', v_item_kind, 'item_id', v_item_id, 'converted', v_converted);
end;
$$;
revoke execute on function public._tower_grant_floor_reward(public.tower_runs, public.tower_floors) from public, anon, authenticated;

-- ─── İç yardımcı: kat başarısız (can düş / elenme) → outcome jsonb ─────────
create or replace function public._tower_fail_floor(p_run public.tower_runs, p_st public.tower_floor_state)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_lives int := p_run.lives - 1;
  v_reveal  jsonb := jsonb_build_object('secret', p_st.secret, 'secret2', p_st.secret2);
begin
  delete from tower_floor_state where run_id = p_run.id;
  delete from tower_guesses where run_id = p_run.id and floor_no = p_st.floor_no;

  -- Kayıpta kupa serisi sıfırlanır (sonraki geçiş yine 10 kupa verir).
  if new_lives <= 0 then
    update tower_runs set lives = 0, status = 'eliminated', win_streak = 0 where id = p_run.id;
    return jsonb_build_object('status', 'eliminated', 'lives', 0, 'reveal', v_reveal);
  else
    update tower_runs set lives = new_lives, win_streak = 0 where id = p_run.id;
    return jsonb_build_object('status', 'floor_failed', 'lives', new_lives, 'reveal', v_reveal);
  end if;
end;
$$;
revoke execute on function public._tower_fail_floor(public.tower_runs, public.tower_floor_state) from public, anon, authenticated;

-- ─── RPC: turnuvaya gir (300 Veri) ─────────────────────────────────────────
create or replace function public.enter_tower()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me  public.profiles;
  pid bigint;
  run public.tower_runs;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  pid := (select max(id) from tower_periods);
  if pid is null then
    raise exception 'tower_closed';
  end if;

  select * into me from profiles where id = uid for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  select * into run from tower_runs where user_id = uid and period_id = pid;
  if found then
    if run.status = 'eliminated' then
      raise exception 'tower_eliminated';
    else
      raise exception 'tower_already_entered';   -- active ya da cleared
    end if;
  end if;

  if me.veri < 300 then
    raise exception 'insufficient_veri';
  end if;

  update profiles set veri = veri - 300 where id = uid;
  insert into tower_runs (user_id, period_id) values (uid, pid) returning * into run;
  perform _tower_open_floor(run.id, 1);

  return _tower_state_json(uid);
end;
$$;
revoke execute on function public.enter_tower() from public, anon;
grant execute on function public.enter_tower() to authenticated;

-- ─── RPC: durum / resume ───────────────────────────────────────────────────
create or replace function public.get_tower_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  return _tower_state_json(uid);
end;
$$;
revoke execute on function public.get_tower_state() from public, anon;
grant execute on function public.get_tower_state() to authenticated;

-- ─── RPC: kat başlat / devam / tekrar dene (idempotent) ────────────────────
create or replace function public.start_tower_floor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  run public.tower_runs;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into run from tower_runs
   where user_id = uid and period_id = (select max(id) from tower_periods);
  if not found then
    raise exception 'no_active_run';
  end if;
  if run.status = 'eliminated' then
    raise exception 'tower_eliminated';
  elsif run.status <> 'active' then
    raise exception 'tower_not_active';
  end if;
  -- Aktif kat yoksa (yeni kat ya da can-sonrası retry) aç; varsa dokunma (resume).
  if not exists (select 1 from tower_floor_state where run_id = run.id) then
    perform _tower_open_floor(run.id, run.current_floor);
  end if;
  return _tower_state_json(uid);
end;
$$;
revoke execute on function public.start_tower_floor() from public, anon;
grant execute on function public.start_tower_floor() to authenticated;

-- ─── RPC: tahmin (ÇEKİRDEK) ────────────────────────────────────────────────
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
  elapsed  int;
  remaining int;
  tw jsonb;
  v_kind text;
  real_marks text;
  darr text[];
  disp text;
  green int;
  reward jsonb;
  blind_now boolean := false;
  hidden int;
  lockpos int;
  pos int;
  steal int;
  penalty int;
  cursed_letter text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into run from tower_runs
   where user_id = uid and period_id = (select max(id) from tower_periods);
  if not found then
    raise exception 'no_active_run';
  end if;
  if run.status <> 'active' then
    raise exception 'tower_not_active';
  end if;
  select * into st from tower_floor_state where run_id = run.id;
  if not found then
    raise exception 'no_active_floor';
  end if;
  select * into fl from tower_floors where floor_no = st.floor_no;
  n := fl.word_length;

  -- Saat (ön-kontrol): süre dolmuşsa bu tahmin işlenmez → kat başarısız.
  elapsed := floor(extract(epoch from (now() - st.turn_started_at)) * 1000)::int;
  remaining := st.clock_ms - elapsed;
  if remaining <= 0 then
    return _tower_fail_floor(run, st);
  end if;

  -- Geçerlilik: uzunluk + havuz üyeliği (is_valid_guess_for deseni).
  if char_length(p_guess) <> n then
    raise exception 'invalid_digits';
  end if;
  if not exists (select 1 from secret_words where word = p_guess) then
    raise exception 'word_not_in_pool';
  end if;

  real_marks := _word_marks(st.secret, p_guess);

  -- ── KAZANMA: hiçbir twist bozamaz → ödül + ilerle ──
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

  -- ── YANLIŞ: zaman twist'leri (cursed / time_thief) → clock_ms kes ──
  for tw in select value from jsonb_array_elements(fl.twists) loop
    v_kind := tw ->> 'kind';
    if v_kind = 'cursed' then
      cursed_letter := coalesce(tw -> 'params' ->> 'letter', '');
      penalty := coalesce((tw -> 'params' ->> 'penalty_ms')::int, 0);
      if cursed_letter <> '' and position(cursed_letter in p_guess) > 0 then
        st.clock_ms := st.clock_ms - penalty;
      end if;
    elsif v_kind = 'time_thief' then
      steal := coalesce((tw -> 'params' ->> 'steal_ms')::int, 0);
      st.clock_ms := st.clock_ms - steal;
    end if;
  end loop;

  -- ── YANLIŞ: gösterim marks'ı twist'lerle boz ──
  darr := regexp_split_to_array(real_marks, '');
  for tw in select value from jsonb_array_elements(fl.twists) loop
    if (tw ->> 'kind') = 'blind' and not st.blind_used then
      blind_now := true;
    end if;
  end loop;

  if blind_now then
    darr := array_fill('?'::text, array[n]);
    st.blind_used := true;
  else
    for tw in select value from jsonb_array_elements(fl.twists) loop
      v_kind := tw ->> 'kind';
      if v_kind = 'lock' then
        lockpos := coalesce((tw -> 'params' ->> 'pos')::int, 0);
        if lockpos between 1 and n then
          darr[lockpos] := '?';
        end if;
      elsif v_kind = 'fog' then
        hidden := coalesce((tw -> 'params' ->> 'hidden')::int, 1);
        for pos in select i from generate_series(1, n) i where darr[i] <> '?' order by random() limit hidden loop
          darr[pos] := '?';
        end loop;
      elsif v_kind = 'liar' and not st.lie_used then
        select i into pos from generate_series(1, n) i where darr[i] <> '?' order by random() limit 1;
        if pos is not null then
          darr[pos] := case darr[pos] when 'G' then 'X' when 'Y' then 'G' else 'Y' end;
          st.lie_used := true;
        end if;
      end if;
    end loop;
    -- shuffle en son: renkleri pozisyonla hizasız permüte et.
    if exists (select 1 from jsonb_array_elements(fl.twists) t where t.value ->> 'kind' = 'shuffle') then
      select array_agg(x order by random()) into darr from unnest(darr) x;
    end if;
  end if;

  disp := array_to_string(darr, '');
  green := char_length(disp) - char_length(replace(disp, 'G', ''));

  -- floor_state güncelle (kesilen saat + tüketilen blind/liar).
  update tower_floor_state
     set clock_ms = st.clock_ms, blind_used = st.blind_used, lie_used = st.lie_used
   where run_id = run.id;

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

-- ─── RPC: süre bitişini iddia et (istemci geri sayımı 0) ───────────────────
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
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into run from tower_runs
   where user_id = uid and period_id = (select max(id) from tower_periods);
  if not found then
    raise exception 'no_active_run';
  end if;
  if run.status <> 'active' then
    raise exception 'tower_not_active';
  end if;
  select * into st from tower_floor_state where run_id = run.id;
  if not found then
    raise exception 'no_active_floor';
  end if;

  elapsed := floor(extract(epoch from (now() - st.turn_started_at)) * 1000)::int;
  if st.clock_ms - elapsed > 0 then
    raise exception 'clock_not_expired';
  end if;

  return _tower_fail_floor(run, st);
end;
$$;
revoke execute on function public.claim_tower_timeout() from public, anon;
grant execute on function public.claim_tower_timeout() to authenticated;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════
-- MANUEL DOĞRULAMA (Supabase SQL editor — auth shim ile):
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<USER_A_UUID>"}';
--
--   -- 1) Giriş (profiles.veri >= 300 olmalı; 300 düşer, kat 1 açılır):
--   select enter_tower();                       -- run + active floor 1 döner
--   -- 2) Durum/resume:
--   select get_tower_state();
--   -- 3) Aktif katın gizli kelimesini (yalnız TEST için) oku ve doğru gir:
--   --    (üretimde istemci göremez; test için service_role/SQL editör okur)
--   --    select secret from tower_floor_state ts join tower_runs r on r.id=ts.run_id where r.user_id='<USER_A_UUID>';
--   select tower_guess('<DOĞRU_KELİME>');       -- floor_cleared + reward + reveal
--   -- 4) Sonraki katı başlat:
--   select start_tower_floor();
--   -- 5) Yanlış tahmin (twist bozması gör):
--   select tower_guess('<HAVUZDAKİ_YANLIŞ_KELİME>');   -- playing + bozulmuş marks
--   -- 6) Süre bitişi (turn_started_at'i geçmişe alarak simüle et):
--   --    update tower_floor_state set turn_started_at = now() - interval '10 min'
--   --      where run_id = (select id from tower_runs where user_id='<USER_A_UUID>');
--   select claim_tower_timeout();               -- floor_failed (can--) veya eliminated
--   -- 7) Re-entry engeli:
--   select enter_tower();                        -- 'tower_already_entered' / 'tower_eliminated'
-- ══════════════════════════════════════════════════════════════════════════
