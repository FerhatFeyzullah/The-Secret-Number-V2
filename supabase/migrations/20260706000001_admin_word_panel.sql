-- Gizli admin paneli: kelime havuzuna (secret_words) PIN korumalı ekleme.
--
-- Erişim: uygulamada sürüm yazısına 5 kez basılır → PIN sorulur → doğruysa panel.
-- GÜVENLİK: PIN telefonda değil SUNUCUDA doğrulanır (biri uygulamayı atlayıp
-- doğrudan API çağırsa bile PIN olmadan ekleyemez). PIN KODA/COMMIT'E GİRMEZ
-- (repo public): hash app_config'te tutulur ve YALNIZCA panelde elle set edilir:
--   insert into app_config(key,value)
--   values('admin_pin_hash', crypt('<PIN>', gen_salt('bf')))
--   on conflict (key) do update set value = excluded.value;
--
-- pgcrypto bcrypt (crypt/gen_salt) ile doğrulama; app_config istemciye kapalı
-- (RLS + revoke), erişim yalnız security-definer RPC'lerle.

create extension if not exists pgcrypto;

-- ─── app_config: sunucu-içi anahtar/değer (PIN hash burada; istemciye kapalı) ───
create table if not exists public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
-- RLS açık + politika YOK → istemci okuyamaz/yazamaz; yalnız definer RPC erişir.

-- ─── PIN doğrulama (panel açılışı için) ─────────────────────────────────
create or replace function public.admin_verify_pin(p_pin text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare h text;
begin
  select value into h from public.app_config where key = 'admin_pin_hash';
  return h is not null and crypt(coalesce(p_pin, ''), h) = h;
end;
$$;

-- ─── PIN korumalı kelime ekleme (tek havuz = secret_words) ──────────────
create or replace function public.admin_add_word(p_word text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  h text;
  w text := lower(trim(coalesce(p_word, '')));
  n int;
begin
  select value into h from public.app_config where key = 'admin_pin_hash';
  if h is null or crypt(coalesce(p_pin, ''), h) <> h then
    raise exception 'wrong_pin';
  end if;
  -- Biçim: 4-6 Türkçe harf (q/w/x yok) + en az bir ünlü (çöp/kısaltma engeli).
  if w !~ '^[abcçdefgğhıijklmnoöprsştuüvyz]{4,6}$' or w !~ '[aeıioöuü]' then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.secret_words (word) values (w) on conflict (word) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('status', case when n > 0 then 'added' else 'exists' end);
end;
$$;

revoke execute on function public.admin_verify_pin(text) from public;
revoke execute on function public.admin_add_word(text, text) from public;
grant execute on function public.admin_verify_pin(text) to anon, authenticated;
grant execute on function public.admin_add_word(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
