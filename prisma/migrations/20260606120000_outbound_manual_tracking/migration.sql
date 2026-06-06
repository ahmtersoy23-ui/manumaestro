-- CG (CastleGate) / etiketsiz akış: Wayfair MCF raporundan elle girilen tracking.
-- SHIPPING etiketi olmayan siparişlerde (Wayfair fiziksel sevkiyatı yapar) external-close + platform-close
-- için tracking kaynağı bu kolon olur.

-- AlterTable
ALTER TABLE "outbound_orders" ADD COLUMN "manualTracking" TEXT;
