-- Sevkiyat rezerve aggregation için partial index:
-- shipmentReserved hesabı her stok sorgusunda packed=true AND sent_at IS NULL satırlarını
-- iwasku başına toplar. Açık (kolide ama sevk edilmemiş) satır sayısı her zaman küçük
-- olduğu için partial index sorguyu indeks-taraması ile bitirir.

CREATE INDEX IF NOT EXISTS "shipment_items_open_iwasku_idx"
  ON "shipment_items" ("iwasku")
  WHERE "packed" = true AND "sentAt" IS NULL;
