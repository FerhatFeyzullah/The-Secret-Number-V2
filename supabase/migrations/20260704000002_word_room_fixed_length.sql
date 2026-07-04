-- Özel oda kelime modunda harf sayısı seçimi (4/5/6 sabit ya da Rastgele).
--
-- Gerekçe: Özel (private) kelime odası kuran kişi, oyunun 3 tur boyunca kaç harfli
-- olacağını seçebilsin (4/5/6) ya da "Rastgele" bırakabilsin (her tur farklı —
-- mevcut davranış). Bugüne dek uzunluk hem oda doğumunda hem her tur sonunda
-- (_advance_or_finish) 4-6 arası yeniden zarlanıyordu.
--
-- YAKLAŞIM: matches'e yeni nullable kolon fixed_word_length:
--   • null  → uzunluk her tur RASTGELE zarlanır (özel-oda "Rastgele" + tüm eşleşmeli
--             kelime maçları → SIFIR REGRESYON).
--   • 4/5/6 → uzunluk SABİT; her tur aynı kalır.
-- _advance_or_finish tek coalesce ile iki durumu birleştirir; create_private_room
-- kolonu doldurur. Eşleşmeli (find_or_create_quick_match) kolonu ATAMAZ → null →
-- rastgele (aynen). Yalnız özel oda etkilenir.

-- ─── 1) Şema: fixed_word_length kolonu ───────────────────────────────────
alter table public.matches
  add column if not exists fixed_word_length int
  check (fixed_word_length is null or fixed_word_length between 4 and 6);

-- ─── 2) create_private_room: p_word_length parametresi (4/5/6 ya da null) ─
-- İmza (int,text,text) → (int,text,text,int). Overload belirsizliği olmasın diye
-- eski 3-arg sürüm DROP edilir; yeni p_word_length default null (3-arg çağrılar
-- geriye uyumlu → Rastgele). Gövde 20260704000000'den; yalnız word uzunluğu +
-- fixed_word_length eklendi.
drop function if exists public.create_private_room(int, text, text);

create or replace function public.create_private_room(
  p_clock_ms int default 60000,
  p_first_turn_mode text default 'random',
  p_room_mode text default 'quick',
  p_word_length int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  m public.matches;
  attempt int;
  v_mode text;
  v_content text;
  v_win_target int;
  v_word_length int;
  v_fixed_word_length int;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_clock_ms not in (60000, 90000, 120000, 180000) then
    raise exception 'invalid_clock';
  end if;
  if p_first_turn_mode not in ('random', 'creator') then
    raise exception 'invalid_first_turn';
  end if;
  if p_room_mode not in ('quick', 'protocol', 'word') then
    raise exception 'invalid_room_mode';
  end if;
  if p_word_length is not null and p_word_length not in (4, 5, 6) then
    raise exception 'invalid_word_length';
  end if;

  -- Oda modu → kamudaki karşılığının BİREBİR kolonları:
  --   quick    : mode='private', number, tek tur (win_target=1)
  --   protocol : mode='protocol', number, Bo3 (win_target=2)
  --   word     : mode='private', word, Bo3 (win_target=2); uzunluk p_word_length
  --              (4/5/6) SABİT ya da null → random(4-6). fixed_word_length niyeti taşır.
  if p_room_mode = 'protocol' then
    v_mode := 'protocol'; v_content := 'number'; v_win_target := 2;
    v_word_length := null; v_fixed_word_length := null;
  elsif p_room_mode = 'word' then
    v_mode := 'private'; v_content := 'word'; v_win_target := 2;
    v_word_length := coalesce(p_word_length, 4 + floor(random() * 3)::int);
    v_fixed_word_length := p_word_length;  -- null → her tur rastgele; 4/5/6 → sabit
  else
    v_mode := 'private'; v_content := 'number'; v_win_target := 1;
    v_word_length := null; v_fixed_word_length := null;
  end if;

  for attempt in 1..20 loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '')
      into code
      from generate_series(1, 6);
    begin
      insert into matches (
        mode, player1, room_code, clock_ms, first_turn_mode,
        content_type, win_target, word_length, fixed_word_length, is_friendly)
      values (
        v_mode, uid, code, p_clock_ms, p_first_turn_mode,
        v_content, v_win_target, v_word_length, v_fixed_word_length, true)
      returning * into m;
      return jsonb_build_object(
        'match_id', m.id, 'room_code', m.room_code,
        'role', 'player1', 'status', m.status);
    exception when unique_violation then
      null; -- kod çakıştı, yeniden üret
    end;
  end loop;
  raise exception 'room_code_generation_failed';
end;
$$;

revoke execute on function public.create_private_room(int, text, text, int) from public, anon;
grant execute on function public.create_private_room(int, text, text, int) to authenticated;

-- ─── 3) _advance_or_finish: sabit uzunlukta re-roll YAPMA ────────────────
-- Gövde 20260611000003'ten birebir; tek fark ★ word_length satırı: sabit oda
-- (fixed_word_length dolu) her tur aynı uzunluğu korur, null ise 4-6 zarlanır.
create or replace function public._advance_or_finish(p_match_id uuid, p_round_winner uuid, p_result text)
returns matches
language plpgsql
security definer
set search_path to 'public'
as $function$
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
           -- ★ kelimede tur arası belirleme 60+8 sn (sayıda 30+8, eski değer);
           --   yeni tur uzunluğu: fixed_word_length dolu → SABİT, null → yeniden zarla.
           setup_deadline = now() + case when content_type = 'word'
                                         then interval '68 seconds'
                                         else interval '38 seconds' end,
           word_length = case when content_type = 'word'
                              then coalesce(fixed_word_length, 4 + floor(random() * 3)::int)
                              else word_length end,
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
$function$;

notify pgrst, 'reload schema';
