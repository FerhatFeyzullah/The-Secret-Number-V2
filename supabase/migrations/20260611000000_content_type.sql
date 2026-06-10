-- İçerik tipi soyutlaması (Faz 1B — kelime modu hazırlığı).
--
-- DB artık gizli içeriği tip-bağımsız saklar/doğrular; tek tanımlı tip 'number'
-- ve number maçlarda kurallar BİREBİR eskisi gibi zorlanır (davranış değişmez).
--
-- set_secret/make_guess bu migration yazılırken yürürlükteki SON tanımlarından
-- (pg_get_functiondef) alınmıştır; tek değişiklik doğrulama/evaluate çağrılarının
-- maçın content_type'ı üzerinden dispatch olmasıdır. Protokol mantığı (sis,
-- yanıltma, saat, tur ilerletme) aynen korunur — protokoller şimdilik yalnız
-- content_type='number' varsayar (kelime uyarlaması Faz 2 kararı).

-- 1) Maçın içerik tipi. Mevcut tüm satırlar default ile 'number' olur.
--    Faz 2 bu CHECK'i 'word' ile genişletir.
alter table public.matches
  add column if not exists content_type text not null default 'number'
  check (content_type in ('number'));

-- 2) Tip-bazlı doğrulama dispatch'leri.
--    'number' dalı mevcut is_valid_secret'e delege eder (tek kopya, sıfır sapma).
create or replace function public.is_valid_secret_for(p_content_type text, p_value text)
returns boolean
language plpgsql immutable
as $$
begin
  if p_content_type = 'number' then
    return public.is_valid_secret(p_value);
  end if;
  raise exception 'unknown_content_type';
end;
$$;

-- Tahmin format kuralı eski guesses.digits CHECK'inin BİREBİR karşılığıdır
-- (yalnız regex; tekrarsızlık tahminde RPC katmanında is_valid_secret ile aranır).
create or replace function public.is_valid_guess_for(p_content_type text, p_value text)
returns boolean
language plpgsql immutable
as $$
begin
  if p_content_type = 'number' then
    return p_value ~ '^[1-9]{3}$';
  end if;
  raise exception 'unknown_content_type';
end;
$$;

-- 3) Değerlendirme dispatch'i. Sayı gövdesi eski evaluate_guess'ten BİREBİR taşındı.
create or replace function public._evaluate_guess_number(p_secret text, p_guess text)
returns text
language plpgsql immutable
as $$
declare
  value_match int := 0;
  i int;
begin
  for i in 1..3 loop
    if position(substring(p_guess, i, 1) in p_secret) > 0 then
      value_match := value_match + 1;
    end if;
  end loop;

  if value_match < 3 then
    return 'partial:' || value_match;
  end if;
  if p_guess = p_secret then
    return 'win';
  end if;
  return 'digits_correct_wrong_order';
end;
$$;

create or replace function public.evaluate_guess(p_content_type text, p_secret text, p_guess text)
returns text
language plpgsql immutable
as $$
begin
  if p_content_type = 'number' then
    return public._evaluate_guess_number(p_secret, p_guess);
  end if;
  raise exception 'unknown_content_type';
end;
$$;

-- Eski 2-arg imza korunur ama tek kopyaya delege eder (sapma olmasın).
create or replace function public.evaluate_guess(p_secret text, p_guess text)
returns text
language plpgsql immutable
as $$
begin
  return public._evaluate_guess_number(p_secret, p_guess);
end;
$$;

-- 4) Kolon CHECK'leri tip-bilinçli trigger doğrulamasına taşınır.
--    (CHECK maçın content_type'ına bakamaz; trigger her INSERT/UPDATE yolunu kapatır.
--    guesses.feedback CHECK'i aynen yerinde kalır.)
alter table public.secrets drop constraint if exists secrets_digits_check;
alter table public.guesses drop constraint if exists guesses_digits_check;

create or replace function public._validate_secret_digits()
returns trigger
language plpgsql
as $$
declare
  ct text;
begin
  select content_type into ct from public.matches where id = new.match_id;
  if ct is null then
    raise exception 'match_not_found';
  end if;
  if not public.is_valid_secret_for(ct, new.digits) then
    raise exception 'invalid_digits';
  end if;
  return new;
end;
$$;

create or replace function public._validate_guess_digits()
returns trigger
language plpgsql
as $$
declare
  ct text;
begin
  select content_type into ct from public.matches where id = new.match_id;
  if ct is null then
    raise exception 'match_not_found';
  end if;
  if not public.is_valid_guess_for(ct, new.digits) then
    raise exception 'invalid_digits';
  end if;
  return new;
end;
$$;

drop trigger if exists secrets_validate_digits on public.secrets;
create trigger secrets_validate_digits
  before insert or update on public.secrets
  for each row execute function public._validate_secret_digits();

drop trigger if exists guesses_validate_digits on public.guesses;
create trigger guesses_validate_digits
  before insert or update on public.guesses
  for each row execute function public._validate_guess_digits();

-- 5) set_secret — yürürlükteki son tanım; tek fark: is_valid_secret →
--    is_valid_secret_for(m.content_type, ...).
create or replace function public.set_secret(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  m public.matches;
  cnt int;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'setup' then
    raise exception 'not_in_setup';
  end if;
  if m.setup_deadline is not null and now() > m.setup_deadline then
    raise exception 'setup_expired';
  end if;
  if not is_valid_secret_for(m.content_type, p_digits) then
    raise exception 'invalid_digits';
  end if;

  insert into secrets (match_id, player, digits, round)
  values (m.id, uid, p_digits, m.current_round)
  on conflict (match_id, player, round) do update set digits = excluded.digits;

  select count(*) into cnt from secrets where match_id = m.id and round = m.current_round;

  if cnt = 2 then
    update matches
       set status = 'active',
           current_turn = case
             when m.first_turn_mode = 'creator' then m.player1
             when random() < 0.5 then m.player1
             else m.player2
           end,
           turn_started_at = now(),
           clock1_ms = m.clock_ms,
           clock2_ms = m.clock_ms,
           setup_deadline = null,
           player1_ready = true,
           player2_ready = true
     where id = m.id;
    return jsonb_build_object('match_id', m.id, 'status', 'active');
  end if;

  if uid = m.player1 then
    update matches set player1_ready = true where id = m.id;
  else
    update matches set player2_ready = true where id = m.id;
  end if;

  return jsonb_build_object('match_id', m.id, 'status', 'setup');
end;
$function$;

-- 6) make_guess — yürürlükteki son tanım; tek fark: doğrulama + evaluate
--    çağrıları content_type üzerinden. Protokol mantığı (yanıltma/sis/saat/
--    susturma temizliği, _advance_or_finish) AYNEN.
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
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'active' then
    raise exception 'match_not_active';
  end if;
  if m.current_turn <> uid then
    raise exception 'not_your_turn';
  end if;
  if not is_valid_secret_for(m.content_type, p_digits) then
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

  -- Yanıltma: yalnız partial:0/1 bir kademe şişirilir (gösterim); win/dcwo/
  -- partial:2 sahtelenmez. Gerçek sonuç oyunu yönetir.
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

  -- Satıra GÖSTERİLEN değer yazılır (kurbana gerçek inmez; şişirme işareti yok).
  insert into guesses (match_id, guesser, digits, feedback, round, fogged)
  values (m.id, uid, p_digits, display_fb, m.current_round, my_fog);

  if fb = 'win' then
    perform 1 from matches where id = m.id for update;
    update matches
       set clock1_ms = case when uid = player1 then my_clock else clock1_ms end,
           clock2_ms = case when uid = player2 then my_clock else clock2_ms end
     where id = m.id;
    m := _advance_or_finish(m.id, uid, 'win');
  else
    -- Sıra rakibe geçer. Tur bitti: donma söner; çağıranın yavaşlatması/
    -- susturması/sisi temizlenir (yanıltma yukarıda tüketildi).
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

  return jsonb_build_object(
    'match_id', m.id, 'status', m.status, 'result', m.result, 'winner', m.winner,
    'feedback', display_fb, 'current_turn', m.current_turn,
    'clock1_ms', m.clock1_ms, 'clock2_ms', m.clock2_ms,
    'fogged', my_fog);
end;
$function$;

notify pgrst, 'reload schema';
