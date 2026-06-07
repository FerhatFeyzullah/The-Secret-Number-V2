-- Faz 3 / Adım 3 düzeltme: get_my_hand salt-okunur işlemde patlıyordu.
--
-- KÖK SEBEP: get_my_hand `stable` olarak işaretli. PostgREST, stable/immutable
-- fonksiyonları SALT-OKUNUR (read-only) bir transaction'da çağırır. get_my_hand
-- ise _match_for_player'ı çağırıyordu; o da `select ... for update` (satır kilidi)
-- yapıyor. Salt-okunur transaction'da FOR UPDATE yasaktır (PG 25006:
-- "cannot execute SELECT FOR UPDATE in a read-only transaction") → RPC hata verir,
-- istemcide "Beklenmeyen bir hata" olarak yutulurdu. (psql'de read-write çağrıldığı
-- için Docker testlerinde görünmüyordu.)
--
-- ÇÖZÜM: get_my_hand artık üyelik kontrolünü KİLİTSİZ yapar (salt okuma; FOR UPDATE
-- yok) → read-only transaction'da güvenli. Ayrıca `not found` mantığı düzeltildi
-- (el satırı yoksa boş el döner) ve null'a karşı güvenli hale getirildi.
-- Gizlilik değişmedi: security definer + yalnız çağıranın satırı (RLS rakibe kapalı).

create or replace function public.get_my_hand(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  h public.protocol_hands;
  lvl int;
  has_hand boolean;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Üyelik kontrolü KİLİTSİZ (salt okuma — _match_for_player'ın FOR UPDATE'i yok).
  select * into m from matches where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;
  if uid <> m.player1 and (m.player2 is null or uid <> m.player2) then
    raise exception 'not_a_player';
  end if;

  select level into lvl from profiles where id = uid;

  select * into h from protocol_hands where match_id = p_match_id and player = uid;
  has_hand := found; -- el satırı var mı (profil select'i değil — eski hata buydu)

  if not has_hand then
    -- El henüz dağıtılmamış/yok: boş el (istemci yükleniyor/yeniden-dene gösterir).
    return jsonb_build_object('hand', '[]'::jsonb, 'selected', '[]'::jsonb,
                              'slots', _protocol_slots(coalesce(lvl, 1)));
  end if;

  return jsonb_build_object(
    'hand', coalesce(to_jsonb(h.hand), '[]'::jsonb),
    'selected', coalesce(to_jsonb(h.selected), '[]'::jsonb),
    'slots', _protocol_slots(coalesce(lvl, 1)));
end;
$$;
revoke execute on function public.get_my_hand(uuid) from public, anon;
grant execute on function public.get_my_hand(uuid) to authenticated;

-- PostgREST şema önbelleğini tazele (panelde yeni fonksiyon/tabloların görünmesi
-- için; cache bayatsa RPC "bulunamadı" hatası verir).
notify pgrst, 'reload schema';
