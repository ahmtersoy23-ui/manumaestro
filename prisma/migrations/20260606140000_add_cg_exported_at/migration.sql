-- CG (CastleGate) MCF Excel'i bir kez alınsın: alınan siparişleri işaretle,
-- "Tümünü Seç"/export tekrar dahil etmesin (çift Wayfair MCF önleme).
ALTER TABLE "outbound_orders" ADD COLUMN "cgExportedAt" TIMESTAMP(3);
