-- Matchmaking/oda çağrılarındaki seq-scan'i gider: matches(player1) + matches(player2) indeksi.
--
-- SORUN: Her matchmaking/oda RPC'si (find_or_create_quick_match, find_or_create_
-- protocol_match, create_private_room, join_private_room, leave_match, _cancel_
-- unstarted_matchmade, …) "kendi bayat maçımı temizle" için
--   update/select matches ... where (player1 = uid or player2 = uid) and status in (…)
-- çalıştırıyor. Bu predikat 24 call-site'ta geçiyor ama matches'te player1/player2
-- üzerinde HİÇBİR index yoktu → her çağrı TÜM matches tablosunu SEQ SCAN ediyordu.
-- Tablo büyüdükçe (biriken cancelled/finished maçlar) her matchmaking çağrısı yavaşlar;
-- free-tier düşük compute'ta eşzamanlı çağrılar birbirini yavaşlatır → matchmaking stall.
--
-- ÇÖZÜM: player1 ve player2 üzerine birer btree index. Planner "player1=uid OR
-- player2=uid" için iki indeksi bitmap-OR'lar → seq-scan yerine index scan. Ucuz,
-- risksiz, geriye uyumlu; ayrıca "player1=uid or player2=uid" filtreli tüm sorgulara
-- (geçmiş/temizlik) yarar. `if not exists` → idempotent.

create index if not exists matches_player1_idx on public.matches (player1);
create index if not exists matches_player2_idx on public.matches (player2);
