-- Realtime UPDATE iletimi için REPLICA IDENTITY FULL.
--
-- Supabase `postgres_changes`, RLS'li bir tabloda UPDATE/DELETE olayını bir aboneye
-- iletmeden önce RLS policy'sini WAL kaydı üzerinde değerlendirir. Policy PK-dışı
-- kolonlara bakıyorsa (ör. matches: player1/player2 = auth.uid()), DEFAULT replica
-- identity'de (yalnız PK) bu değerlendirme yapılamaz → olay İLETİLMEZ. Sonuç:
-- sıra-geçişi / eşleşme / hazırlık senkronu bozulur ("her iki tarafta da rakibe sıra",
-- "biri arıyor diğeri başladı"). INSERT tam kayıt taşıdığı için etkilenmez (tahmin
-- ekleme çalışır); asıl kıran UPDATE'lerdir.
--
-- Dashboard'dan realtime açınca Supabase bunu otomatik set eder; ama migration-only
-- kurulan yeni projede (bölge göçü) elle set edilmeli. clan_messages/clan_challenges
-- kendi migration'larında zaten FULL. `replica identity full` idempotenttir.

alter table public.matches replica identity full;
alter table public.guesses replica identity full;
alter table public.presence replica identity full;
alter table public.match_protocol_uses replica identity full;
