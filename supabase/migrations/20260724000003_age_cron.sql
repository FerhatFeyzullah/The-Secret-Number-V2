-- ══════════════════════════════════════════════════════════════════════════
-- GİZEM ÇAĞI · Faz 4: Yarım kalan maç reap'i (cron)
--
-- Süresi çoktan geçmiş ama kimse age_claim_phase çağırmadığı için 'prep'/'war'da
-- asılı kalan maçları kapat. season_cron/heartbeat-reap deseni: pg_cron yoksa
-- (test) blok sessizce atlanır, migration kırılmaz.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.age_reap()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Hazırlık süresi geçmiş asılı maçlar → savaşa geçir / bitir.
  for r in select id from age_matches
            where phase = 'prep' and prep_ends_at < now() - interval '10 seconds'
  loop
    -- claim_phase mantığını doğrudan uygula (auth kontrolü olmadan; cron).
    perform public._age_reap_prep(r.id);
  end loop;
  -- Savaş süresi geçmiş asılı maçlar → sıralama.
  for r in select id from age_matches
            where phase = 'war' and war_ends_at < now() - interval '10 seconds'
  loop
    perform public._age_finish(r.id);
  end loop;
  -- Uzun süre kuyrukta bekleyip dolmayan maçlar → iptal.
  update age_matches set phase = 'cancelled'
   where phase = 'queue' and created_at < now() - interval '5 minutes';
end;
$$;
revoke execute on function public.age_reap() from public, anon, authenticated;

-- Hazırlık→savaş geçişinin auth'suz (cron) sürümü.
create or replace function public._age_reap_prep(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare alive int;
begin
  update age_players p set eliminated_at = now()
   where p.match_id = p_match_id and p.eliminated_at is null
     and public._age_territory_count(p_match_id, p.player) = 0;
  select count(*) into alive from age_players where match_id = p_match_id and eliminated_at is null;
  if alive <= 1 then
    perform public._age_finish(p_match_id);
  else
    update age_matches
       set phase = 'war',
           war_ends_at = now() + (_age_const('war_ms') || ' milliseconds')::interval
     where id = p_match_id;
  end if;
end;
$$;
revoke execute on function public._age_reap_prep(uuid) from public, anon, authenticated;

-- pg_cron kaydı (blok guard'lı; yoksa sessizce atla).
do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'age-reap') then
    perform cron.unschedule('age-reap');
  end if;
  perform cron.schedule('age-reap', '* * * * *', 'select public.age_reap();');
  raise notice 'pg_cron: age-reap dakikalık kuruldu.';
exception when others then
  raise notice 'pg_cron kurulamadı (%) — panelden etkinleştirin.', sqlerrm;
end $$;

notify pgrst, 'reload schema';
