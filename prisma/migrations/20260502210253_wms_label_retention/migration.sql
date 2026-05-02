-- WMS Faz 1.6: Etiket retention + tracking number
-- Kargo etiketleri 14 gün sonra arşivlenecek (file silinir, DB ref kalır + trackingNumber).

ALTER TABLE "order_labels" ADD COLUMN "trackingNumber" TEXT;
ALTER TABLE "order_labels" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "order_labels_archivedAt_idx" ON "order_labels"("archivedAt");
