-- Depo (NJ_DEPO/CG_DEPO) konsolidasyon: karışık ürünlü KOLI/PALET (çıkış tarafı).
-- FBA tek-SKU shipment_boxes'tan ayrı. Varış patlatma ayrı faz (Gemi 71 sonrası).

CREATE TABLE IF NOT EXISTS "shipment_containers" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "width" DOUBLE PRECISION,
  "height" DOUBLE PRECISION,
  "depth" DOUBLE PRECISION,
  "weight" DOUBLE PRECISION,
  "labelPrinted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_containers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "shipment_containers_shipmentId_idx" ON "shipment_containers"("shipmentId");

CREATE TABLE IF NOT EXISTS "shipment_container_lines" (
  "id" TEXT NOT NULL,
  "containerId" TEXT NOT NULL,
  "shipmentItemId" TEXT NOT NULL,
  "iwasku" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "shipment_container_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "shipment_container_lines_containerId_idx" ON "shipment_container_lines"("containerId");
CREATE INDEX IF NOT EXISTS "shipment_container_lines_shipmentItemId_idx" ON "shipment_container_lines"("shipmentItemId");

ALTER TABLE "shipment_containers"
  ADD CONSTRAINT "shipment_containers_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_container_lines"
  ADD CONSTRAINT "shipment_container_lines_containerId_fkey"
  FOREIGN KEY ("containerId") REFERENCES "shipment_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backend pricelab rolüyle bağlanır — GRANT olmazsa 500 permission denied.
GRANT SELECT, INSERT, UPDATE, DELETE ON "shipment_containers" TO pricelab;
GRANT SELECT, INSERT, UPDATE, DELETE ON "shipment_container_lines" TO pricelab;
