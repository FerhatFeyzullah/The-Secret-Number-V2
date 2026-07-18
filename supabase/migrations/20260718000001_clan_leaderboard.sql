-- ══════════════════════════════════════════════════════════════════════════
-- KLAN SİSTEMİ — Faz 2a: Klan Lider Tablosu
--
-- Klan skoru = üyelerin Kupa (rating) toplamı. Global sıralama (ilk 50).
-- get_clan_leaderboard(): sıralı klan kartları.
-- get_my_clan(): mevcut çıktıya 'score' + 'rank' eklenir (additive).
--
-- Skor anlık hesaplanır (küçük ölçekte ucuz; denormalize etmeye gerek yok →
-- maç-bitiş mantığına dokunulmaz).
-- ══════════════════════════════════════════════════════════════════════════

-- ─── Klan lider tablosu ────────────────────────────────────────────────────
create or replace function public.get_clan_leaderboard()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select cl.id, cl.name, cl.tag, cl.emblem, cl.member_count,
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
        'rank', rnk, 'id', id, 'name', name, 'tag', tag,
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

-- ─── get_my_clan: skor + sıra eklenir (canlı 20260718000000 gövdesi + 2 alan) ──
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
    return null;   -- klanda değil
  end if;
  select * into c from clans where id = m.clan_id;
  if not found then
    return null;
  end if;

  -- Skor = üye Kupa toplamı; sıra = daha yüksek skorlu klan sayısı + 1.
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
    'tag', c.tag,
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

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════
-- MANUEL DOĞRULAMA:
--   select get_clan_leaderboard();
--   set local request.jwt.claims = '{"sub":"<USER_UUID>"}';
--   select get_my_clan() -> 'rank', get_my_clan() -> 'score';
-- ══════════════════════════════════════════════════════════════════════════
