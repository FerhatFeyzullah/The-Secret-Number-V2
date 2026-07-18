-- ══════════════════════════════════════════════════════════════════════════
-- KLAN SİSTEMİ — etiket (tag) tamamen kaldırılır
--
-- Klanlar yalnız ad + uuid ile tanımlanır (kısa etiket kavramı sistemden çıkar).
-- clans.tag sütunu + benzersiz index düşürülür; tag döndüren/kullanan tüm RPC'ler
-- tag'siz yeniden tanımlanır. create_clan artık p_tag ALMAZ (5 argüman).
-- ══════════════════════════════════════════════════════════════════════════

-- ─── Tag'siz okuma RPC'leri ────────────────────────────────────────────────

create or replace function public.get_my_clan()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.clan_members;
  c public.clans;
  my_score bigint;
  my_rank bigint;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into m from clan_members where player = uid;
  if not found then
    return null;
  end if;
  select * into c from clans where id = m.clan_id;
  if not found then
    return null;
  end if;
  select coalesce(sum(p.rating), 0)::bigint into my_score
    from clan_members cm2
    join profiles p on p.id = cm2.player
   where cm2.clan_id = c.id;
  select 1 + count(*) into my_rank
    from (
      select coalesce(sum(p2.rating), 0) as sc
        from clans cl2
        left join clan_members cm3 on cm3.clan_id = cl2.id
        left join profiles p2 on p2.id = cm3.player
       group by cl2.id
    ) t
   where t.sc > my_score;
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'description', c.description,
    'emblem', c.emblem,
    'join_mode', c.join_mode,
    'min_trophies', c.min_trophies,
    'member_count', c.member_count,
    'owner', c.owner,
    'my_role', m.role,
    'score', my_score,
    'rank', my_rank,
    'members', public._clan_members_json(c.id),
    'requests', case
      when m.role in ('leader', 'coleader') then public._clan_requests_json(c.id)
      else '[]'::jsonb
    end
  );
end;
$$;
revoke execute on function public.get_my_clan() from public, anon;
grant execute on function public.get_my_clan() to authenticated;

create or replace function public.list_clans(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(card order by mc desc, created_at desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'emblem', c.emblem,
        'join_mode', c.join_mode,
        'min_trophies', c.min_trophies,
        'member_count', c.member_count
      ) as card,
      c.member_count as mc,
      c.created_at
    from clans c
    where p_query is null
       or btrim(p_query) = ''
       or c.name ilike '%' || p_query || '%'
    order by c.member_count desc, c.created_at desc
    limit 40
  ) s;
$$;
revoke execute on function public.list_clans(text) from public, anon;
grant execute on function public.list_clans(text) to authenticated;

create or replace function public.get_my_requests()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id, 'name', c.name, 'emblem', c.emblem,
        'join_mode', c.join_mode, 'min_trophies', c.min_trophies, 'member_count', c.member_count
      )
      order by r.created_at desc
    ),
    '[]'::jsonb
  )
  from clan_join_requests r
  join clans c on c.id = r.clan_id
  where r.player = auth.uid();
$$;
revoke execute on function public.get_my_requests() from public, anon;
grant execute on function public.get_my_requests() to authenticated;

create or replace function public.get_clan_leaderboard()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select cl.id, cl.name, cl.emblem, cl.member_count,
           coalesce(sum(p.rating), 0)::bigint as score
      from clans cl
      left join clan_members cm on cm.clan_id = cl.id
      left join profiles p on p.id = cm.player
     group by cl.id
  ),
  ranked as (
    select *, row_number() over (order by score desc, name asc) as rnk
      from scored
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank', rnk, 'id', id, 'name', name,
        'emblem', emblem, 'member_count', member_count, 'score', score
      )
      order by rnk
    ),
    '[]'::jsonb
  )
  from (select * from ranked order by rnk limit 50) top;
$$;
revoke execute on function public.get_clan_leaderboard() from public, anon;
grant execute on function public.get_clan_leaderboard() to authenticated;

-- ─── create_clan: p_tag KALDIRILDI (6 arg → 5 arg) ─────────────────────────
drop function if exists public.create_clan(text, text, text, jsonb, text, int);

create or replace function public.create_clan(
  p_name text,
  p_description text,
  p_emblem jsonb,
  p_join_mode text,
  p_min_trophies int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  new_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_mode text := coalesce(p_join_mode, 'open');
  v_min  int  := greatest(0, coalesce(p_min_trophies, 0));
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 20 then
    raise exception 'invalid_clan_name';
  end if;
  if char_length(v_desc) > 120 then
    raise exception 'invalid_clan_description';
  end if;
  if v_mode not in ('open', 'approval') then
    raise exception 'invalid_join_mode';
  end if;

  select * into me from profiles where id = uid for update;
  if not found then
    raise exception 'profile_not_found';
  end if;
  if exists (select 1 from clan_members where player = uid) then
    raise exception 'already_in_clan';
  end if;
  if me.level < 3 then
    raise exception 'level_too_low';
  end if;
  if me.veri < 1000 then
    raise exception 'insufficient_veri';
  end if;

  update profiles set veri = veri - 1000 where id = uid;

  insert into clans (name, description, emblem, join_mode, min_trophies, owner, member_count)
  values (v_name, v_desc, coalesce(p_emblem, '{}'::jsonb), v_mode, v_min, uid, 1)
  returning id into new_id;

  insert into clan_members (player, clan_id, role, wins_at_join)
  values (uid, new_id, 'leader', me.wins);

  delete from clan_join_requests where player = uid;

  return public.get_my_clan();
end;
$$;
revoke execute on function public.create_clan(text, text, jsonb, text, int) from public, anon;
grant execute on function public.create_clan(text, text, jsonb, text, int) to authenticated;

-- ─── Sütunu + index'i düşür (fonksiyonlar artık tag'e bakmıyor) ─────────────
drop index if exists public.clans_tag_unique;
alter table public.clans drop column if exists tag;

notify pgrst, 'reload schema';
