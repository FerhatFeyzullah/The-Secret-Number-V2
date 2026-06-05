-- Online 1v1: belirleme fazı "hazır" işareti — sızdırmayan ready bayrakları
-- Supabase SQL editöründe de doğrudan çalıştırılabilir (idempotent).
--
-- Gerekçe: belirleme ekranında "rakip kilitledi mi" bilgisi gerekiyor. secrets
-- tablosu realtime'a TAMAMEN kapalı (gizli sayı asla sızmamalı), bu yüzden
-- "hazır" sinyalini secrets'tan dinleyemeyiz. Çözüm: matches'a yalnızca BOOLEAN
-- hazır bayrakları ekle ve set_secret bunları güncellesin. Realtime ile yalnızca
-- "hazır mı" gider; sayının KENDİSİ hiçbir koşulda matches'a yazılmaz/sızmaz.

-- 1) Bayraklar -------------------------------------------------------------------
alter table public.matches
  add column if not exists player1_ready boolean not null default false;
alter table public.matches
  add column if not exists player2_ready boolean not null default false;

-- 2) set_secret: sayıyı kaydet + çağıranın hazır bayrağını set et --------------
-- Tek kişi yazınca matches GÜNCELLENİR (yalnızca bayrak) ki rakip realtime ile
-- "hazır" görsün. İki kişi de yazınca oyun başlar (mevcut davranış korunur).

create or replace function public.set_secret(p_match_id uuid, p_digits text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  cnt int;
begin
  m := _match_for_player(p_match_id);

  if m.status <> 'setup' then
    raise exception 'not_in_setup';
  end if;
  if m.setup_deadline is not null and now() > m.setup_deadline then
    raise exception 'setup_expired';
  end if;
  if not is_valid_secret(p_digits) then
    raise exception 'invalid_digits';
  end if;

  insert into secrets (match_id, player, digits)
  values (m.id, uid, p_digits)
  on conflict (match_id, player) do update set digits = excluded.digits;

  select count(*) into cnt from secrets where match_id = m.id;

  -- İki oyuncu da yazdıysa oyunu başlat. Maç satırı kilitli olduğundan
  -- eşzamanlı iki set_secret çağrısı serileşir; geçiş tam bir kez olur.
  if cnt = 2 then
    update matches
       set status = 'active',
           current_turn = case when random() < 0.5 then player1 else player2 end,
           turn_started_at = now(),
           clock1_ms = 60000,
           clock2_ms = 60000,
           setup_deadline = null,
           player1_ready = true,
           player2_ready = true
     where id = m.id;
    return jsonb_build_object('match_id', m.id, 'status', 'active');
  end if;

  -- Tek kişi yazdı: yalnızca çağıranın hazır bayrağını set et (sayı SIZMAZ).
  -- Bu UPDATE realtime'da rakibe "hazır" sinyali olarak gider.
  if uid = m.player1 then
    update matches set player1_ready = true where id = m.id;
  else
    update matches set player2_ready = true where id = m.id;
  end if;

  return jsonb_build_object('match_id', m.id, 'status', 'setup');
end;
$$;

-- Grant migration 2'de verildi; create or replace bunu korur.

-- 3) Doğrulama (panelde elle denenebilir) ---------------------------------------
--
--   -- Tek kişi yazınca matches'ta yalnızca bayrak değişir, status setup kalır;
--   -- realtime rakibe "hazır" taşır ama sayı matches'ta YOKTUR:
--   select set_secret('MATCH_ID', '123');   -- status=setup
--   select status, player1_ready, player2_ready from public.matches
--     where id = 'MATCH_ID';                  -- setup, ilgili bayrak true
--   -- secrets hâlâ istemciye kapalı:
--   select * from public.secrets;            -- permission denied
