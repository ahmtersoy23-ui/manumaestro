-- Add missing single-column FK indexes flagged in audit 2026-05-12 (H6).
-- Prisma'nın @@index([col1, col2]) composite'leri tek başına FK lookup'ları
-- karşılamaz (PostgreSQL leftmost prefix kuralı). Tek-kolon FK index'leri
-- "kullanıcı X'in tüm hareketleri" gibi tipik audit sorgularını
-- sequential scan'den kurtarır.
--
-- CONCURRENTLY kullanılmadı: migration deploy'da transaction içinde
-- çalışıyor, CREATE INDEX CONCURRENTLY transaction-incompatible. Tablolar
-- şu an küçük (<10K satır) — lock window <100ms beklenir. Büyürse
-- gelecek migration manuel CONCURRENTLY ile yapılmalı.

-- ShelfMovement
CREATE INDEX "shelf_movements_userId_idx" ON "shelf_movements"("userId");
CREATE INDEX "shelf_movements_fromShelfId_idx" ON "shelf_movements"("fromShelfId");
CREATE INDEX "shelf_movements_toShelfId_idx" ON "shelf_movements"("toShelfId");

-- OutboundOrder
CREATE INDEX "outbound_orders_createdById_idx" ON "outbound_orders"("createdById");
CREATE INDEX "outbound_orders_shippedById_idx" ON "outbound_orders"("shippedById");

-- OrderLabel
CREATE INDEX "order_labels_uploadedById_idx" ON "order_labels"("uploadedById");
CREATE INDEX "order_labels_printedById_idx" ON "order_labels"("printedById");

-- CycleCountTask
CREATE INDEX "cycle_count_tasks_assignedToId_idx" ON "cycle_count_tasks"("assignedToId");
CREATE INDEX "cycle_count_tasks_completedById_idx" ON "cycle_count_tasks"("completedById");
