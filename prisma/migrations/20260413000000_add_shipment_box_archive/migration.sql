-- CreateTable
CREATE TABLE "shipment_box_archive" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "shipmentName" TEXT NOT NULL,
    "destinationTab" TEXT NOT NULL,
    "shippingMethod" TEXT NOT NULL,
    "boxNumber" TEXT NOT NULL,
    "iwasku" TEXT,
    "fnsku" TEXT,
    "productName" TEXT,
    "productCategory" TEXT,
    "marketplaceCode" TEXT,
    "destination" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "depth" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_box_archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_box_archive_shipmentId_idx" ON "shipment_box_archive"("shipmentId");
CREATE INDEX "shipment_box_archive_shipmentName_idx" ON "shipment_box_archive"("shipmentName");
CREATE INDEX "shipment_box_archive_iwasku_idx" ON "shipment_box_archive"("iwasku");
CREATE INDEX "shipment_box_archive_closedAt_idx" ON "shipment_box_archive"("closedAt");
