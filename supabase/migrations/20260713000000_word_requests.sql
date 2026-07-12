-- Havuza kelime ÖNERİ sistemi: oyuncular (online + offline ANON) secret_words'te
-- olmayan bir kelimeyi `request_word` ile önerir → word_requests'e düşer. Admin panelde
-- (bcrypt PIN) onaylar (secret_words'e taşınır) ya da reddeder. Aynı kelime tekrar
-- önerilirse req_count artar (popülerlik). Gönderen SAKLANMAZ (anon dostu).
--
-- Güvenlik: word_requests istemciye kapalı (RLS + revoke); tüm erişim SECURITY DEFINER.
-- Biçim + PIN kontrolü admin_add_word ile BİREBİR aynı (4-6 TR harf + ünlü; app_config
-- bcrypt hash). request_word PIN'siz (anon+authenticated); listele/onayla/reddet PIN'li.

create table if not exists public.word_requests (
  word text primary key check (char_length(word) between 4 and 6),
  req_count int not null default 1,
  first_requested_at timestamptz not null default now(),
  last_requested_at  timestamptz not null default now()
);
alter table public.word_requests enable row level security;
-- RLS açık + politika YOK → istemci doğrudan erişemez; yalnız definer RPC.
revoke all on public.word_requests from anon, authenticated;

-- ─── Oyuncu önerisi (PIN'siz, anon dahil) ──────────────────────────────────
create or replace function public.request_word(p_word text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  w text := lower(trim(coalesce(p_word, '')));
begin
  -- Biçim: admin_add_word ile AYNI (4-6 TR harf, q/w/x yok, en az bir ünlü).
  if w !~ '^[abcçdefgğhıijklmnoöprsştuüvyz]{4,6}$' or w !~ '[aeıioöuü]' then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- Zaten havuzdaysa öneriye gerek yok.
  if exists (select 1 from public.secret_words where word = w) then
    return jsonb_build_object('status', 'exists');
  end if;
  insert into public.word_requests (word) values (w)
    on conflict (word) do update
      set req_count = word_requests.req_count + 1,
          last_requested_at = now();
  return jsonb_build_object('status', 'submitted');
end;
$$;

-- ─── Admin: bekleyen istekleri listele (PIN'li) ────────────────────────────
create or replace function public.admin_list_word_requests(p_pin text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare h text;
begin
  select value into h from public.app_config where key = 'admin_pin_hash';
  if h is null or crypt(coalesce(p_pin, ''), h) <> h then
    raise exception 'wrong_pin';
  end if;
  return coalesce(
    (select jsonb_agg(
       jsonb_build_object('word', word, 'count', req_count, 'at', last_requested_at)
       order by req_count desc, last_requested_at desc)
     from public.word_requests),
    '[]'::jsonb);
end;
$$;

-- ─── Admin: onayla → havuza ekle + istekten sil (PIN'li) ───────────────────
create or replace function public.admin_approve_word(p_word text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  h text;
  w text := lower(trim(coalesce(p_word, '')));
begin
  select value into h from public.app_config where key = 'admin_pin_hash';
  if h is null or crypt(coalesce(p_pin, ''), h) <> h then
    raise exception 'wrong_pin';
  end if;
  insert into public.secret_words (word) values (w) on conflict (word) do nothing;
  delete from public.word_requests where word = w;
  return jsonb_build_object('status', 'approved');
end;
$$;

-- ─── Admin: reddet → istekten sil (PIN'li) ─────────────────────────────────
create or replace function public.admin_reject_word(p_word text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  h text;
  w text := lower(trim(coalesce(p_word, '')));
begin
  select value into h from public.app_config where key = 'admin_pin_hash';
  if h is null or crypt(coalesce(p_pin, ''), h) <> h then
    raise exception 'wrong_pin';
  end if;
  delete from public.word_requests where word = w;
  return jsonb_build_object('status', 'rejected');
end;
$$;

revoke execute on function public.request_word(text) from public;
revoke execute on function public.admin_list_word_requests(text) from public;
revoke execute on function public.admin_approve_word(text, text) from public;
revoke execute on function public.admin_reject_word(text, text) from public;
grant execute on function public.request_word(text) to anon, authenticated;
grant execute on function public.admin_list_word_requests(text) to anon, authenticated;
grant execute on function public.admin_approve_word(text, text) to anon, authenticated;
grant execute on function public.admin_reject_word(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
