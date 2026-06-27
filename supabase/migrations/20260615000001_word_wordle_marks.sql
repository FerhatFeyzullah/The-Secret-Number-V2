-- Kelime modu: Wordle per-harf renk geri bildirimi (BİLİNÇLİ KURAL DEĞİŞİKLİĞİ).
--
-- Projenin çekirdek kuralı "pozisyon asla sızmaz, yalnız kaç harf doğru" idi.
-- KELİME modu için bu kural KASTEN kaldırılıyor: tahmin eden oyuncu KENDİ
-- tahmininin per-harf renklerini görür (yeşil/sarı/yok). SAYI modu eski
-- sözleşmeyi AYNEN korur — bu migration number davranışına dokunmaz.
--
-- ─── GİZLİLİK MİMARİSİ (kritik) ────────────────────────────────────────
-- guesses_select_match_players politikası, maçın HER İKİ oyuncusuna tüm
-- tahmin satırlarını (tüm sütunlar) okutur. RLS satır-düzeyidir; tek bir
-- sütunu rakipten gizleyemez. Bu yüzden per-harf marks dizisi BİR SÜTUN
-- OLARAK SAKLANMAZ — aksi halde realtime/fetch ile rakibe sızardı.
--
--  • guesses.green_count (int, nullable): tahminin YEŞİL (doğru pozisyon) harf
--    sayısı. Rakip kartı bunu gösterir ("3/5"). Yalnız SAYI — pozisyon dizisi
--    değil. Number satırlarda NULL.
--  • Per-harf marks dizisi yalnız İKİ yoldan döner, ikisi de YALNIZ ÇAĞIRANA:
--      1. make_guess dönüşü (yalnız tahmini yapan oyuncuya gider).
--      2. get_my_marks RPC'si — guesser = auth.uid() ile SERT filtreli; bir
--         oyuncu RAKİBİNİN marks'ını ASLA alamaz.
--  • Sonuç: rakibin marks dizisi hiçbir realtime payload'ında ya da RPC
--    dönüşünde bulunmaz. Yalnız green_count görünür. Garanti RLS/RPC düzeyinde.
--
-- ─── Türkçe locale ─────────────────────────────────────────────────────
-- _word_marks lower()/collation KULLANMAZ. Gizli/tahmin DB'ye zaten istemcide
-- tr-lowercase normalize edilmiş (normalizeTr) yazılır; SQL yalnız KESİN
-- karakter eşitliği (=) ile karşılaştırır. Deterministik collation'da '=' bayt
-- eşitliğidir → ı (U+0131) ≠ i (U+0069). Locale tuzağı yapısal olarak yok.
--
-- make_guess gövdesi yürürlükteki canlı tanımdan (20260611000002) alındı;
-- yalnız ★ işaretli satırlar eklendi/değişti.

-- ─── 1) green_count kolonu ─────────────────────────────────────────────
alter table public.guesses add column if not exists green_count int;
alter table public.guesses drop constraint if exists guesses_green_count_check;
alter table public.guesses add constraint guesses_green_count_check
  check (green_count is null or green_count >= 0);

-- ─── 2) _word_marks: iki-geçişli Wordle işaretleme (Türkçe-duyarlı) ────
-- src/game/word.ts wordMarks ile BİREBİR. Çıktı 'G'/'Y'/'X' dizisi (ör "GYXG").
create or replace function public._word_marks(p_secret text, p_guess text)
returns text
language plpgsql immutable
as $$
declare
  n int := char_length(p_guess);
  s text[] := regexp_split_to_array(p_secret, '');
  g text[] := regexp_split_to_array(p_guess, '');
  marks text[] := array_fill('X'::text, array[n]);
  remaining jsonb := '{}'::jsonb;   -- tüketilmemiş gizli harflerin sayacı
  i int;
  ch text;
  cnt int;
begin
  if char_length(p_secret) <> n then
    raise exception 'length_mismatch';
  end if;

  -- 1. geçiş: pozisyon birebir tutanlar YEŞİL; kalan gizli harfleri say.
  for i in 1..n loop
    if g[i] = s[i] then
      marks[i] := 'G';
    else
      ch := s[i];
      remaining := jsonb_set(
        remaining, array[ch], to_jsonb(coalesce((remaining ->> ch)::int, 0) + 1), true);
    end if;
  end loop;

  -- 2. geçiş: yeşil olmayanları SOLDAN SAĞA gez; kalan sayıda varsa SARI.
  for i in 1..n loop
    if marks[i] = 'G' then
      continue;
    end if;
    ch := g[i];
    cnt := coalesce((remaining ->> ch)::int, 0);
    if cnt > 0 then
      marks[i] := 'Y';
      remaining := jsonb_set(remaining, array[ch], to_jsonb(cnt - 1), true);
    end if;
  end loop;

  return array_to_string(marks, '');
end;
$$;

-- ─── 3) get_my_marks: ÇAĞIRANIN KENDİ tahminlerinin per-harf renkleri ──
-- Rakibin marks'ı ASLA dönmez (guesser = auth.uid() filtresi). Sunucu gizli
-- havuzu okuyup yeniden hesaplar; istemci yeniden bağlanınca kendi tahtasını
-- bundan boyar. Dönüş: [{id, marks}, ...].
create or replace function public.get_my_marks(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  opp uuid;
  result jsonb;
begin
  m := _match_for_player(p_match_id);   -- oyuncu değilse hata fırlatır
  if m.content_type <> 'word' then
    return '[]'::jsonb;                 -- yalnız kelime modunda anlamlı
  end if;
  opp := case when uid = m.player1 then m.player2 else m.player1 end;

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
     and g.guesser = uid;          -- ★ YALNIZ kendi tahminleri

  return result;
end;
$$;

revoke execute on function public.get_my_marks(uuid) from public, anon;
grant execute on function public.get_my_marks(uuid) to authenticated;

-- ─── 4) make_guess: kelime dalında marks (çağırana) + green_count (satıra) ─
create or replace function public.make_guess(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  marks text;        -- ★ kelime per-harf renkleri; YALNIZ çağırana döner
  green int;         -- ★ yeşil sayısı; satıra yazılır (rakip-güvenli)
  v_guess_id bigint; -- ★ eklenen satır id'si (çağıran kendi tahtasını eşler)
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'active' then
    raise exception 'match_not_active';
  end if;
  if m.current_turn <> uid then
    raise exception 'not_your_turn';
  end if;
  if not is_valid_guess_for(m.content_type, p_digits, m.word_length) then
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

  fb := evaluate_guess(m.content_type, opp_secret, p_digits); -- GERÇEK (otorite)

  -- ★ Kelimede per-harf renk (GERÇEK gizliye göre) + yeşil sayısı.
  if m.content_type = 'word' then
    marks := _word_marks(opp_secret, p_digits);
    green := char_length(marks) - char_length(replace(marks, 'G', ''));
  end if;

  -- Yanıltma: yalnız partial:0/1 bir kademe şişirilir (gösterim). Kelimede
  -- protokol yok → my_deceive daima false; bu blok yalnız sayı modunu etkiler.
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

  -- Satıra GÖSTERİLEN feedback + green_count yazılır (marks YAZILMAZ → rakibe
  -- per-harf dizi sızmaz). ★ green_count number'da NULL.
  insert into guesses (match_id, guesser, digits, feedback, round, fogged, green_count)
  values (m.id, uid, p_digits, display_fb, m.current_round, my_fog, green)
  returning id into v_guess_id;

  if fb = 'win' then
    perform 1 from matches where id = m.id for update;
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end
     where id = m.id;
    m := _advance_or_finish(m.id, uid, 'win');
  else
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

  -- ★ marks + green_count + guess_id YALNIZ ÇAĞIRANA döner (kendi tahtası).
  --   Number'da hepsi NULL → eski dönüş şekli korunur (istemci null'ları atar).
  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'feedback', display_fb, 'current_turn', m.current_turn,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms,
    'fogged', my_fog, 'marks', marks, 'green_count', green, 'guess_id', v_guess_id);
end;
$function$;

notify pgrst, 'reload schema';
