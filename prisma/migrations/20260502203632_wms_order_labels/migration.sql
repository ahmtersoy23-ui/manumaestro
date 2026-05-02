-- WMS Faz 1.1: Sipariş etiket yüklemeleri (kargo PDF, FNSKU PDF, vb.)
-- OutboundOrder bağlı etiket dosyaları, opsiyonel ShipmentBox bağlantısı (FBA_PICKUP FNSKU).

CREATE TYPE "OrderLabelType" AS ENUM ('SHIPPING', 'FNSKU', 'OTHER');

CREATE TABLE "order_labels" (
    "id" TEXT NOT NULL,
    "outboundOrderId" TEXT NOT NULL,
    "shipmentBoxId" TEXT,
    "type" "OrderLabelType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt" TIMESTAMP(3),
    "printedById" TEXT,
    "notes" TEXT,

    CONSTRAINT "order_labels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_labels_outboundOrderId_type_idx" ON "order_labels"("outboundOrderId", "type");
CREATE INDEX "order_labels_shipmentBoxId_idx" ON "order_labels"("shipmentBoxId");

ALTER TABLE "order_labels" ADD CONSTRAINT "order_labels_outboundOrderId_fkey"
    FOREIGN KEY ("outboundOrderId") REFERENCES "outbound_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
