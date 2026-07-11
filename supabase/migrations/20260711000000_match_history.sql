-- ════════════════════════════════════════════════════════════════════════════
-- Global "Son Maçlar" akışı: bitmiş EŞLEŞMELİ maçların kalıcı, minik özetleri.
-- SAF EK: mevcut _advance_or_finish / _apply_rating DEĞİŞMEZ; iki trigger'la
-- beslenir. match_history matches'a FK TUTMAZ → 15-dk reap onu SİLMEZ.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) round_results: tur kazananı (match-scoped, maçla birlikte silinir — snapshot
--    maç bitişinde alındığından reap'ten önce hep mevcut). _advance_or_finish'in
--    round_wins ARTIRAN update'inden trigger ile dolar.
create table if not exists public.round_results (
  match_id uuid not null references public.matches(id) on delete cascade,
  round int not null,
  winner uuid not null,
  primary key (match_id, round)
);
alter table public.round_results enable row level security;
revoke all on public.round_results from anon, authenticated;

create or replace function public._capture_round_result()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- old.current_round = az önce çözülen tur (finish dalı current_round'u değiştirmez,
  -- advance dalı SONRADAN +1 yapar; her iki durumda old = çözülen tur).
  if new.p1_round_wins > old.p1_round_wins then
    insert into round_results(match_id, round, winner)
      values (new.id, old.current_round, new.player1) on conflict do nothing;
  elsif new.p2_round_wins > old.p2_round_wins then
    insert into round_results(match_id, round, winner)
      values (new.id, old.current_round, new.player2) on conflict do nothing;
  end if;
  return null;
end; $$;

drop trigger if exists trg_capture_round_result on public.matches;
create trigger trg_capture_round_result
  after update of p1_round_wins, p2_round_wins on public.matches
  for each row execute function public._capture_round_result();

-- 2) match_history: kalıcı özet. match_id UNIQUE ama FK DEĞİL → reap silmez.
create table if not exists public.match_history (
  id bigint generated always as identity primary key,
  match_id uuid not null unique,
  ended_at timestamptz not null default now(),
  mode text not null,
  content_type text not null default 'number',
  win_target int not null default 1,
  player1 uuid not null,
  player2 uuid,
  player1_name text,
  player2_name text,
  winner uuid,
  result text,
  p1_round_wins int not null default 0,
  p2_round_wins int not null default 0,
  p1_rating_delta int,
  p2_rating_delta int,
  rounds jsonb not null default '[]'::jsonb
);
create index if not exists match_history_ended_idx on public.match_history (ended_at desc);
alter table public.match_history enable row level security;
revoke all on public.match_history from anon, authenticated;

-- 3) Snapshot: rating_applied true olunca (deltalar YAZILDIKTAN sonra) çağrılır.
create or replace function public._record_match_history(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  p1n text;
  p2n text;
  rj jsonb;
begin
  select * into m from matches where id = p_match_id;
  if not found or m.mode not in ('quick','protocol')
     or m.status <> 'finished' or m.winner is null then
    return;
  end if;

  select username into p1n from profiles where id = m.player1;
  select username into p2n from profiles where id = m.player2;

  -- Turlar: her tur için iki gizli + kazanan (round_results, yoksa maç kazananı).
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'round', r.round,
             'p1_secret', s1.digits,
             'p2_secret', s2.digits,
             'winner', case when coalesce(rr.winner, m.winner) = m.player1 then 1 else 2 end
           ) order by r.round), '[]'::jsonb)
    into rj
    from (select distinct round from secrets where match_id = m.id) r
    left join secrets s1 on s1.match_id = m.id and s1.round = r.round and s1.player = m.player1
    left join secrets s2 on s2.match_id = m.id and s2.round = r.round and s2.player = m.player2
    left join round_results rr on rr.match_id = m.id and rr.round = r.round;

  insert into match_history(match_id, ended_at, mode, content_type, win_target,
      player1, player2, player1_name, player2_name, winner, result,
      p1_round_wins, p2_round_wins, p1_rating_delta, p2_rating_delta, rounds)
    values (m.id, now(), m.mode, coalesce(m.content_type,'number'), coalesce(m.win_target,1),
      m.player1, m.player2, p1n, p2n, m.winner, m.result,
      coalesce(m.p1_round_wins,0), coalesce(m.p2_round_wins,0),
      m.p1_rating_delta, m.p2_rating_delta, rj)
    on conflict (match_id) do nothing;

  -- Rolling-30: yalnız en yeni 30 kayıt kalsın (cron gerekmez).
  delete from match_history
   where id not in (select id from match_history order by ended_at desc, id desc limit 30);
end; $$;

create or replace function public._on_rating_applied()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _record_match_history(new.id);
  return null;
end; $$;

drop trigger if exists trg_record_match_history on public.matches;
create trigger trg_record_match_history
  after update of rating_applied on public.matches
  for each row when (new.rating_applied and not old.rating_applied)
  execute function public._on_rating_applied();

-- 4) Okuma RPC: son 30, giriş yapan herkese açık. Bitmiş maç → gizli/isim
--    public-safe (zaten iki tarafa reveal ediliyor, tek maçlık). Ham uuid'ler
--    dışarı sızmaz; yalnız isim + p1_won (kazanan taraf) döner.
create or replace function public.get_recent_matches()
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(to_jsonb(h) order by h.ended_at desc), '[]'::jsonb)
  from (
    select match_id, ended_at, mode, content_type, win_target,
           player1_name, player2_name,
           (winner = player1) as p1_won,
           result, p1_round_wins, p2_round_wins,
           p1_rating_delta, p2_rating_delta, rounds
    from match_history
    order by ended_at desc
    limit 30
  ) h;
$$;
revoke execute on function public.get_recent_matches() from public, anon;
grant execute on function public.get_recent_matches() to authenticated;

notify pgrst, 'reload schema';
