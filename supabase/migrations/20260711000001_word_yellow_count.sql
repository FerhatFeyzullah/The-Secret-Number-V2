-- ════════════════════════════════════════════════════════════════════════════
-- Kelime modu: rakip ilerlemesinde SARI (doğru harf, yanlış yer) sayısını da göster.
-- SAF EK: make_guess DEĞİŞMEZ. guesses'e yellow_count kolonu + before-insert trigger
-- kelime tahmininde rakip-gizlisinden sarıyı hesaplar. green_count ile AYNI yol:
-- satıra yazılır → rakip fetchGuesses/realtime ile okur (per-harf dizi SIZMAZ,
-- yalnız sayı görünür). Sayı modunda (green_count null) hesaplanmaz.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.guesses add column if not exists yellow_count int;
alter table public.guesses drop constraint if exists guesses_yellow_count_check;
alter table public.guesses add constraint guesses_yellow_count_check
  check (yellow_count is null or yellow_count >= 0);

create or replace function public._set_yellow_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  opp uuid;
  opp_secret text;
  mk text;
begin
  -- Yalnız kelime tahmini (green_count dolu) → sarı hesapla; sayı modunda null kalır.
  if new.green_count is null then
    return new;
  end if;
  select case when player1 = new.guesser then player2 else player1 end
    into opp from matches where id = new.match_id;
  select digits into opp_secret from secrets
    where match_id = new.match_id and player = opp and round = new.round;
  if opp_secret is null then
    return new;
  end if;
  -- make_guess'in green için kullandığı aynı marks fonksiyonu ('G'/'Y'/'X').
  mk := _word_marks(opp_secret, new.digits);
  new.yellow_count := char_length(mk) - char_length(replace(mk, 'Y', ''));
  return new;
end; $$;

drop trigger if exists trg_set_yellow_count on public.guesses;
create trigger trg_set_yellow_count
  before insert on public.guesses
  for each row execute function public._set_yellow_count();

notify pgrst, 'reload schema';
