-- Kanal sipariş no'su: çift kayıt (manuel + Wisersell otomatik) tespiti için.
-- Manuel girişte operatör kanal no'sunu (ör. S_IWAUS22055) yazar; Wisersell otomatik
-- kaydı bu numarayı channelOrderNumber'da tutar ama orderNumber'ı iç kodu (ör. 51199)
-- olur → mevcut unique(warehouse,marketplace,orderNumber) bunu yakalayamaz.

ALTER TABLE "outbound_orders" ADD COLUMN "channelOrderNumber" TEXT;

CREATE INDEX "outbound_orders_channelOrderNumber_idx" ON "outbound_orders"("channelOrderNumber");

-- Backfill mevcut kayıtlar:
-- MANUAL: kanal no = orderNumber (operatörün yazdığı paket-fişi no'su).
UPDATE "outbound_orders" SET "channelOrderNumber" = "orderNumber" WHERE "source" = 'MANUAL';

-- WISERSELL_AUTO: kanal no = adres notunun ilk satırı (= label_prefix+label_no, ör. S_IWAUS22055).
-- buildAddressNote ilk satıra labelBase'i koyar; boşsa NULLIF ile null bırakılır.
UPDATE "outbound_orders"
SET "channelOrderNumber" = NULLIF(TRIM(split_part("addressNote", E'\n', 1)), '')
WHERE "source" = 'WISERSELL_AUTO' AND "addressNote" IS NOT NULL;
