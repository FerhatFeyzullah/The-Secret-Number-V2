-- profiles tablosu + RLS + yeni kullanıcı trigger'ı
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).

-- 1) Tablo -------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) RLS ---------------------------------------------------------------------

alter table public.profiles enable row level security;

-- Kullanıcı yalnızca KENDİ satırını okuyabilir.
-- (Lider tablosu için başkalarının username'ini okuma ileride ayrıca eklenecek.)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- Kullanıcı yalnızca KENDİ satırını güncelleyebilir.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- INSERT politikası bilinçli olarak YOK: satırı aşağıdaki security definer
-- trigger açar; istemciden doğrudan insert gerekmez.

-- 3) Yeni kullanıcı → otomatik profil satırı ----------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Başlangıç adı: e-postanın @ öncesi (istemci sonra güncelleyecek).
  insert into public.profiles (id, username)
  values (new.id, coalesce(split_part(new.email, '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) updated_at otomatik tazelensin -------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 5) Backfill: trigger'dan ÖNCE kayıt olmuş kullanıcılara profil satırı aç ----

insert into public.profiles (id, username)
select u.id, coalesce(split_part(u.email, '@', 1), '')
from auth.users u
on conflict (id) do nothing;
