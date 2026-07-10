-- Lobi bekleme sayaçları: her mod kuyruğunda rakip bekleyen (waiting, player2
-- null) TAZE (≤2 dk) ve HERKESE AÇIK (room_code null, is_friendly=false) kayıt
-- sayısı. RLS matches_select_players istemciye yalnız kendi satırlarını okuttuğu
-- için kuyruk istemciden sayılamaz → SECURITY DEFINER RPC.
--
-- Filtre, find_or_create_quick_match / find_or_create_protocol_match eşleşme
-- koşullarıyla BİREBİR: created_at >= now()-2dk (bayat kuyruk eşleşmez → sayılmaz),
-- room_code null + is_friendly=false (özel/dostluk odaları kuyruğa girmez).
-- Mod eşlemesi: quick = quick+number, word = quick+word, protocol = protocol.

create or replace function public.get_lobby_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'quick',    count(*) filter (where mode = 'quick'    and content_type = 'number'),
    'word',     count(*) filter (where mode = 'quick'    and content_type = 'word'),
    'protocol', count(*) filter (where mode = 'protocol')
  )
  from public.matches
  where status = 'waiting'
    and player2 is null
    and room_code is null
    and is_friendly = false
    and created_at >= now() - interval '2 minutes';
$$;

revoke execute on function public.get_lobby_counts() from public;
grant execute on function public.get_lobby_counts() to anon, authenticated;

notify pgrst, 'reload schema';
