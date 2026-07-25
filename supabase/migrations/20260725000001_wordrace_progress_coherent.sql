-- ═══════════════════════════════════════════════════════════════════════════
-- Kelime Yarışı — rakip ilerleme (best_green/best_yellow) TUTARLILIK düzeltmesi
-- ═══════════════════════════════════════════════════════════════════════════
-- SORUN: word_race_guess, p*_best_green ve p*_best_yellow'u BAĞIMSIZ greatest()
-- ile güncelliyordu. Rakip önce sarı bulup (ör. green=0, yellow=2) sonraki
-- tahminde o harfleri yeşile çevirince (green=2, yellow=0):
--     best_green  = greatest(0, 2) = 2   ✓
--     best_yellow = greatest(2, 0) = 2   ✗  (sarı DÜŞMÜYOR → takılı kalıyor)
-- → ekranda "2 yeşil + 2 sarı" = 4 işaret (4 harfli kelimede saçma/şişik ilerleme).
--
-- ÇÖZÜM: best'i TEK bir tahminden gelen TUTARLI çift olarak sakla — yeşil
-- öncelikli, sarı ikincil (lexicographic). Yeni tahmin ancak KESİN daha iyiyse
-- (daha çok yeşil; eşitse daha çok sarı) best'i devralır. Böylece yeşil artınca
-- best_yellow o tahminin sarısına iner; best_green+best_yellow ≤ word_length her
-- zaman korunur. İlerleme geriye gitmez (yalnız kesin-daha-iyi devralır).
--
-- _word_race_winner / _word_race_progress_winner best_green→best_yellow sırasıyla
-- karar verdiği için (artık aynı tahminden, tutarlı) süre-sonu kazananı da doğru.
--
-- YALNIZ 533-544 satırları değişti; fonksiyonun geri kalanı 20260719000001 ile
-- birebir aynı (create or replace).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.word_race_guess(p_match_id uuid, p_digits text, p_expected_round int default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  v_is_p1 boolean;
  v_remaining int;
  v_secret text;
  v_marks text;
  v_green int;
  v_yellow int;
  v_status text;
  v_reveal text := null;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  if uid not in (m.player1, m.player2) then
    raise exception 'not_a_player';
  end if;
  if m.status <> 'active' then
    raise exception 'match_not_active';
  end if;

  -- Tur guard (anti-sızma): istemcinin oynadığı tur sunucunun aktif turundan farklıysa
  -- (rakip turu az önce çözüp yeni tur başlattı; realtime gecikme penceresi) geç gelen
  -- tahmini REDDET → yeni tura SIZMAZ. İstemci 'stale_round'u sessizce yutar (realtime
  -- tur-sonu ekranını zaten gösterir).
  if p_expected_round is not null and p_expected_round <> m.current_round then
    raise exception 'stale_round';
  end if;

  v_is_p1 := (uid = m.player1);

  -- Ortak geri sayım (sıra yok). Süre dolduysa tahmin REDDEDİLİR → istemci
  -- claim_word_race_timeout çağırır (turu ilerlemeye göre böler).
  v_remaining := m.clock_ms - floor(extract(epoch from (now() - m.turn_started_at)) * 1000)::int;
  if v_remaining <= 0 then
    raise exception 'round_over';
  end if;

  -- Format + havuz doğrulama (birleşik secret_words havuzu; 'word' dalı yeter).
  if char_length(p_digits) <> m.word_length then
    raise exception 'wrong_length';
  end if;
  if not is_valid_guess_for('word', p_digits, m.word_length) then
    raise exception 'word_not_in_pool';
  end if;

  select digits into v_secret
    from secrets where match_id = m.id and round = m.current_round limit 1;
  if v_secret is null then
    raise exception 'secret_missing';
  end if;

  v_marks  := _word_marks(v_secret, p_digits);                       -- 'G'/'Y'/'X'
  v_green  := char_length(v_marks) - char_length(replace(v_marks, 'G', ''));
  v_yellow := char_length(v_marks) - char_length(replace(v_marks, 'Y', ''));

  -- Tahmini kaydet (guesser satırı; wordrace RLS ile rakip GÖREMEZ). green_count/
  -- yellow_count satıra yazılır (rakip-güvenli toplu sayı; trigger de doğrular).
  insert into guesses (match_id, guesser, digits, feedback, round, green_count, yellow_count)
  values (m.id, uid, p_digits, v_marks, m.current_round, v_green, v_yellow);

  -- Bu oyuncunun toplu ilerlemesi (rakibe İNEN tek veri) — TUTARLI best (tek
  -- tahminden; yeşil öncelikli, sarı ikincil). Yalnız KESİN-daha-iyi devralır →
  -- yeşil artınca sarı o tahminin sarısına iner (bağımsız greatest ARTIK YOK).
  if v_is_p1 then
    update matches
       set p1_best_green  = v_green,
           p1_best_yellow = v_yellow
     where id = m.id
       and (v_green > p1_best_green
            or (v_green = p1_best_green and v_yellow > p1_best_yellow));
  else
    update matches
       set p2_best_green  = v_green,
           p2_best_yellow = v_yellow
     where id = m.id
       and (v_green > p2_best_green
            or (v_green = p2_best_green and v_yellow > p2_best_yellow));
  end if;

  if v_green = m.word_length then
    -- ÇÖZDÜ: tur ANINDA biter (rakip donar). Turu wordrace-özel ilerlet.
    m := _word_race_advance(m.id, uid, 'win');
    v_reveal := v_secret;
    v_status := case when m.status = 'finished' then 'match_won' else 'round_won' end;
  else
    v_status := 'playing';
    select * into m from matches where id = p_match_id;   -- best_* güncellenmiş
  end if;

  return jsonb_build_object(
    'status',        v_status,
    'marks',         v_marks,
    'green_count',   v_green,
    'yellow_count',  v_yellow,
    'remaining_ms',  greatest(0, v_remaining),
    'p1_round_wins', m.p1_round_wins,
    'p2_round_wins', m.p2_round_wins,
    'current_round', m.current_round,
    'reveal',        v_reveal);
end;
$$;
revoke execute on function public.word_race_guess(uuid, text, int) from public, anon;
grant execute on function public.word_race_guess(uuid, text, int) to authenticated;
