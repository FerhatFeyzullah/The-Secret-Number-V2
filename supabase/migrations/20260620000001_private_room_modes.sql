-- Özel oda (private room) 3 moda çıkar: Hızlı (number/quick), Protokol
-- (number/protocol Bo3), Kelime (word Bo3 + Wordle). Her özel mod KAMUDAKİ
-- karşılığının kurallarını BİREBİR yansıtır; TEK fark "dostluk maçı": hiçbir
-- kalıcı etki yok (ELO/XP/Veri/lig/istatistik). Ödül-kapatma ayrı migration'da
-- (20260620000002); bu migration yalnız oda doğumu + katılımı genişletir.
--
-- ─── TASARIM: mode KURAL ekseni, is_friendly ÖDÜL/KAYIT ekseni ──────────
-- Oyun kuralları sunucuda KOLON-güdümlüdür:
--   • Hızlı/Kelime kuralları content_type + win_target + clock_ms ile sürer —
--     mode'dan BAĞIMSIZ. Bu yüzden Hızlı/Kelime özel odası mode='private'
--     KALIR (private zaten her yerde ödül/eşleşme DIŞI → ekstra kapı gerekmez)
--     ama gameplay kamuyla AYNI (set_secret/make_guess/_advance_or_finish/
--     mark_ready hepsi content_type+win_target okur).
--   • Protokol kuralları (Kader Eli, protocol_select, use_protocol) mode=
--     'protocol'e BAĞLIDIR → protokol özel odası mode='protocol' OLMAK ZORUNDA.
--     mode='protocol' ise ödül/eşleşme-eligible olur; bu yüzden is_friendly
--     bayrağı protokol özel odasını ranked sistemlerden ayırır.
-- Sonuç: is_friendly TÜM özel odalara konur (açık niyet + savunma); ama asıl
-- ödül/kayıt gücünü protokol özel odasında gösterir. Hızlı/Kelime özel odası
-- ZATEN mode='private' ile dışlanır. (Ödül kapıları: 20260620000002.)

-- ─── 1) is_friendly kolonu (kalıcı; maç satırında durur) ────────────────
alter table public.matches
  add column if not exists is_friendly boolean not null default false;

-- ─── 2) room_code benzersizliği protocol_select'i de kapsasın ───────────
-- Protokol özel odası katılınca 'waiting'→'protocol_select' olur; kod hâlâ
-- doludur. Eski kısmi indeks protocol_select'i kapsamıyordu → o pencerede kod
-- yeniden üretilebilirdi (çok düşük olasılık ama kapatılır). Matchmade protokol
-- maçları room_code=null olduğundan (kısmi indeks where room_code is not null)
-- bu değişiklikten ETKİLENMEZ.
drop index if exists matches_room_code_active_uniq;
create unique index if not exists matches_room_code_active_uniq
  on public.matches (room_code)
  where room_code is not null
    and status in ('waiting', 'setup', 'active', 'protocol_select');

-- ─── 3) create_private_room: oda modu seçimi (quick | protocol | word) ───
-- Eski imza (int, text) DROP edilir → ambiguity yok. Yeni p_room_mode default
-- 'quick' (eski 2-arg çağrılar Hızlı sayı odası açar; geriye uyumlu).
drop function if exists public.create_private_room(int, text);

create or replace function public.create_private_room(
  p_clock_ms int default 60000,
  p_first_turn_mode text default 'random',
  p_room_mode text default 'quick'
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
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_clock_ms not in (60000, 90000, 120000) then
    raise exception 'invalid_clock';
  end if;
  if p_first_turn_mode not in ('random', 'creator') then
    raise exception 'invalid_first_turn';
  end if;
  if p_room_mode not in ('quick', 'protocol', 'word') then
    raise exception 'invalid_room_mode';
  end if;

  -- Oda modu → kamudaki karşılığının BİREBİR kolonları:
  --   quick    : mode='private', number, tek tur (win_target=1)   [private=quick rules]
  --   protocol : mode='protocol', number, Bo3 (win_target=2)      [protokol kuralları mode'a bağlı]
  --   word     : mode='private', word, Bo3 (win_target=2), uzunluk random(4-6)
  if p_room_mode = 'protocol' then
    v_mode := 'protocol'; v_content := 'number'; v_win_target := 2; v_word_length := null;
  elsif p_room_mode = 'word' then
    v_mode := 'private'; v_content := 'word'; v_win_target := 2; v_word_length := 4 + floor(random() * 3)::int;
  else
    v_mode := 'private'; v_content := 'number'; v_win_target := 1; v_word_length := null;
  end if;

  for attempt in 1..20 loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '')
      into code
      from generate_series(1, 6);
    begin
      insert into matches (
        mode, player1, room_code, clock_ms, first_turn_mode,
        content_type, win_target, word_length, is_friendly)
      values (
        v_mode, uid, code, p_clock_ms, p_first_turn_mode,
        v_content, v_win_target, v_word_length, true)
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

revoke execute on function public.create_private_room(int, text, text) from public, anon;
grant execute on function public.create_private_room(int, text, text) to authenticated;

-- ─── 4) join_private_room: protokol odası seçim fazına + el dağıt ────────
-- Protokol özel odası matchmade protokol maçıyla BİREBİR: katılınca
-- status='protocol_select' + her iki oyuncuya el dağıtılır (find_or_create_
-- protocol_match'in katılma dalıyla AYNI). Hızlı/Kelime odası 'setup'a düşer
-- (süre mark_ready'de; content_type maç satırından — kelime 60 sn penceresi).
create or replace function public.join_private_room(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  norm_code text := upper(trim(p_code));
  m public.matches;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into m
    from matches
   where room_code = norm_code
     and status in ('waiting', 'setup', 'active', 'protocol_select')
   order by created_at desc
   limit 1
   for update;

  if not found then
    raise exception 'room_not_found';
  end if;
  if m.player1 = uid then
    raise exception 'own_room';
  end if;
  if m.status <> 'waiting' or m.player2 is not null then
    raise exception 'room_full';
  end if;

  if m.mode = 'protocol' then
    -- Protokol özel odası: seçim fazı + her iki oyuncuya el (otoriteli).
    update matches set player2 = uid, status = 'protocol_select' where id = m.id;
    perform _deal_protocol_hand(m.id, m.player1);
    perform _deal_protocol_hand(m.id, uid);
    return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'protocol_select');
  end if;

  -- Hızlı / Kelime: belirlemeye geç (süre başlatma mark_ready'de).
  update matches
     set player2 = uid,
         status = 'setup'
   where id = m.id;
  return jsonb_build_object('match_id', m.id, 'role', 'player2', 'status', 'setup');
end;
$$;
-- join_private_room grant'i 20260605000002'de verildi; create or replace korur.

notify pgrst, 'reload schema';
