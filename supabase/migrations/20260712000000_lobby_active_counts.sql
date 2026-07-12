-- Lobi sayaçlarına AKTİF MAÇ ekle: her mod için kuyrukta bekleyen (waiting) sayının
-- YANINA, o modda ŞU AN oynanan (setup / protocol_select / active) maç adedi. Kart
-- başına iki canlı sayı gösterilir.
--
-- SAF EK: get_lobby_counts() genişletilir; eski 'quick'/'word'/'protocol' alanları
-- AYNI kalır → migration uygulanmadan da (yeni istemci) ya da eski istemci ile kırılmaz.
-- Tek RPC, mevcut 5 sn lobi polling'ine biner (ekstra istek yok). Aktif maçlar 2
-- kişilik → sayı "kaç MAÇ" demektir (oyuncu değil).
--
-- Kuyruk filtresi eskisiyle BİREBİR: created_at ≥ now()-2dk, room_code null,
-- is_friendly=false, player2 null (find_or_create_* eşleşme koşulları). Aktif filtre:
-- status in (setup, protocol_select, active) — bitmemiş maçlar — + PUBLIC matchmade
-- (room_code null, is_friendly=false), kuyrukla tutarlı. NOT: private PROTOKOL maçı
-- mode='protocol' olarak saklanır (private word/number ise mode='private'); room_code
-- filtresi olmadan private protokol maçları active_protocol'e sızardı. Dıştaki WHERE
-- taramayı yalnız bitmemiş satırlarla sınırlar (finished/cancelled/abandoned dışlanır).
-- Mod eşlemesi: quick = quick+number, word = quick+word, protocol = protocol.

create or replace function public.get_lobby_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'quick', count(*) filter (
      where status = 'waiting' and player2 is null and room_code is null
        and is_friendly = false and created_at >= now() - interval '2 minutes'
        and mode = 'quick' and content_type = 'number'),
    'word', count(*) filter (
      where status = 'waiting' and player2 is null and room_code is null
        and is_friendly = false and created_at >= now() - interval '2 minutes'
        and mode = 'quick' and content_type = 'word'),
    'protocol', count(*) filter (
      where status = 'waiting' and player2 is null and room_code is null
        and is_friendly = false and created_at >= now() - interval '2 minutes'
        and mode = 'protocol'),
    'active_quick', count(*) filter (
      where status in ('setup', 'protocol_select', 'active')
        and room_code is null and is_friendly = false
        and mode = 'quick' and content_type = 'number'),
    'active_word', count(*) filter (
      where status in ('setup', 'protocol_select', 'active')
        and room_code is null and is_friendly = false
        and mode = 'quick' and content_type = 'word'),
    'active_protocol', count(*) filter (
      where status in ('setup', 'protocol_select', 'active')
        and room_code is null and is_friendly = false
        and mode = 'protocol')
  )
  from public.matches
  where status in ('waiting', 'setup', 'protocol_select', 'active');
$$;

revoke execute on function public.get_lobby_counts() from public;
grant execute on function public.get_lobby_counts() to anon, authenticated;

notify pgrst, 'reload schema';
