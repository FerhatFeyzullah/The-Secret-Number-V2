-- ══════════════════════════════════════════════════════════════════════════
-- KLAN SİSTEMİ — Faz 3: Klan Sohbeti (hafif moderasyon)
--
-- clan_messages: yalnız klan üyeleri okur (RLS) + realtime yayını. Gönderme RPC'si
-- uzunluk (1–300) + spam (10 sn'de 5 mesaj) sınırı uygular; klan başına son 100
-- mesaj tutulur. Silme: yazar ya da yönetici (leader/coleader).
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.clan_messages (
  id          uuid primary key default gen_random_uuid(),
  clan_id     uuid not null references public.clans (id) on delete cascade,
  player      uuid not null references public.profiles (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists clan_messages_clan_idx on public.clan_messages (clan_id, created_at desc);
-- DELETE realtime olayı OLD satırın tamamını taşısın (clan_id filtresi çalışsın).
alter table public.clan_messages replica identity full;

alter table public.clan_messages enable row level security;
-- Yalnız klan üyeleri kendi klanının mesajlarını okur (realtime de bu politikadan geçer).
drop policy if exists "clan_messages_select_member" on public.clan_messages;
create policy "clan_messages_select_member" on public.clan_messages
  for select using (
    exists (
      select 1 from public.clan_members cm
       where cm.clan_id = clan_messages.clan_id and cm.player = auth.uid()
    )
  );
revoke all on table public.clan_messages from anon, authenticated;
grant select on table public.clan_messages to authenticated;

-- Realtime yayınına ekle (yayın yoksa atla — idempotent).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clan_messages'
    ) then
      execute 'alter publication supabase_realtime add table public.clan_messages';
    end if;
  end if;
end;
$$;

-- Mesaj gönder: uzunluk + spam sınırı; klan başına son 100 mesajı tut.
create or replace function public.send_clan_message(p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  my_clan uuid;
  v_body text := btrim(coalesce(p_body, ''));
  recent int;
  new_id uuid;
  ts timestamptz;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select clan_id into my_clan from clan_members where player = uid;
  if my_clan is null then
    raise exception 'not_in_clan';
  end if;
  if char_length(v_body) < 1 then
    raise exception 'empty_message';
  end if;
  if char_length(v_body) > 300 then
    raise exception 'message_too_long';
  end if;
  -- Spam: son 10 sn içinde 5+ mesaj → reddet.
  select count(*) into recent
    from clan_messages
   where player = uid and created_at > now() - interval '10 seconds';
  if recent >= 5 then
    raise exception 'too_many_messages';
  end if;

  insert into clan_messages (clan_id, player, body)
  values (my_clan, uid, v_body)
  returning id, created_at into new_id, ts;

  -- Klan başına son 100 mesajı tut (eskileri buda).
  delete from clan_messages
   where clan_id = my_clan
     and id not in (
       select id from clan_messages where clan_id = my_clan order by created_at desc limit 100
     );

  return jsonb_build_object(
    'id', new_id, 'clan_id', my_clan, 'player', uid, 'body', v_body, 'created_at', ts
  );
end;
$$;
revoke execute on function public.send_clan_message(text) from public, anon;
grant execute on function public.send_clan_message(text) to authenticated;

-- Mesaj sil: yazar ya da yönetici (leader/coleader).
create or replace function public.delete_clan_message(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  msg public.clan_messages;
  me public.clan_members;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into msg from clan_messages where id = p_id;
  if not found then
    raise exception 'message_not_found';
  end if;
  select * into me from clan_members where player = uid;
  if not found or me.clan_id <> msg.clan_id then
    raise exception 'not_authorized';
  end if;
  if msg.player <> uid and me.role not in ('leader', 'coleader') then
    raise exception 'not_authorized';
  end if;
  delete from clan_messages where id = p_id;
  return jsonb_build_object('deleted', p_id);
end;
$$;
revoke execute on function public.delete_clan_message(uuid) from public, anon;
grant execute on function public.delete_clan_message(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════
-- MANUEL DOĞRULAMA:
--   set local request.jwt.claims = '{"sub":"<USER_UUID>"}';
--   select send_clan_message('merhaba klan');
--   select * from clan_messages order by created_at desc limit 5;
--   select delete_clan_message('<MSG_ID>');
-- ══════════════════════════════════════════════════════════════════════════
