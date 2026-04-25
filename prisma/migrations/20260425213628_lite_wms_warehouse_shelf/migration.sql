-- CreateEnum
CREATE TYPE "StockMode" AS ENUM ('TOTALS_PRIMARY', 'SHELF_PRIMARY');

-- CreateEnum
CREATE TYPE "ShelfType" AS ENUM ('POOL', 'TEMP', 'NORMAL');

-- CreateEnum
CREATE TYPE "BoxStatus" AS ENUM ('SEALED', 'PARTIAL', 'EMPTY');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('INBOUND_FROM_SHIPMENT', 'INBOUND_MANUAL', 'TRANSFER', 'CROSS_WAREHOUSE_TRANSFER', 'BOX_OPEN', 'BOX_BREAK', 'OUTBOUND', 'REVERSAL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('SINGLE', 'FBA_PICKUP');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('DRAFT', 'SHIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShelfRole" AS ENUM ('VIEWER', 'PACKER', 'OPERATOR', 'MANAGER', 'ADMIN');

-- CreateTable
CREATE TABLE "warehouses" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stockMode" "StockMode" NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "shelves" (
    "id" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "shelfType" "ShelfType" NOT NULL DEFAULT 'NORMAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelf_stock" (
    "id" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "shelfId" TEXT NOT NULL,
    "iwasku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shelf_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelf_boxes" (
    "id" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "shelfId" TEXT NOT NULL,
    "shipmentBoxId" TEXT,
    "boxNumber" TEXT NOT NULL,
    "iwasku" TEXT NOT NULL,
    "fnsku" TEXT,
    "marketplaceCode" TEXT,
    "destination" TEXT NOT NULL DEFAULT 'DEPO',
    "quantity" INTEGER NOT NULL,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "status" "BoxStatus" NOT NULL DEFAULT 'SEALED',
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelf_boxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelf_movements" (
    "id" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "fromShelfId" TEXT,
    "toShelfId" TEXT,
    "iwasku" TEXT,
    "quantity" INTEGER,
    "shelfBoxId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "userId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reverseOfId" TEXT,

    CONSTRAINT "shelf_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_orders" (
    "id" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "marketplaceCode" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "description" TEXT,
    "status" "OutboundStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shippedById" TEXT,
    "shippedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_order_items" (
    "id" TEXT NOT NULL,
    "outboundOrderId" TEXT NOT NULL,
    "iwasku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "shelfId" TEXT,
    "shelfBoxId" TEXT,

    CONSTRAINT "outbound_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_shelf_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "role" "ShelfRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_shelf_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shelves_warehouseCode_shelfType_idx" ON "shelves"("warehouseCode", "shelfType");

-- CreateIndex
CREATE UNIQUE INDEX "shelves_warehouseCode_code_key" ON "shelves"("warehouseCode", "code");

-- CreateIndex
CREATE INDEX "shelf_stock_warehouseCode_iwasku_idx" ON "shelf_stock"("warehouseCode", "iwasku");

-- CreateIndex
CREATE UNIQUE INDEX "shelf_stock_shelfId_iwasku_key" ON "shelf_stock"("shelfId", "iwasku");

-- CreateIndex
CREATE UNIQUE INDEX "shelf_boxes_shipmentBoxId_key" ON "shelf_boxes"("shipmentBoxId");

-- CreateIndex
CREATE INDEX "shelf_boxes_warehouseCode_iwasku_idx" ON "shelf_boxes"("warehouseCode", "iwasku");

-- CreateIndex
CREATE INDEX "shelf_boxes_warehouseCode_status_idx" ON "shelf_boxes"("warehouseCode", "status");

-- CreateIndex
CREATE INDEX "shelf_boxes_boxNumber_idx" ON "shelf_boxes"("boxNumber");

-- CreateIndex
CREATE INDEX "shelf_movements_warehouseCode_createdAt_idx" ON "shelf_movements"("warehouseCode", "createdAt");

-- CreateIndex
CREATE INDEX "shelf_movements_type_idx" ON "shelf_movements"("type");

-- CreateIndex
CREATE INDEX "shelf_movements_reverseOfId_idx" ON "shelf_movements"("reverseOfId");

-- CreateIndex
CREATE INDEX "outbound_orders_warehouseCode_status_idx" ON "outbound_orders"("warehouseCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_orders_warehouseCode_marketplaceCode_orderNumber_key" ON "outbound_orders"("warehouseCode", "marketplaceCode", "orderNumber");

-- CreateIndex
CREATE INDEX "outbound_order_items_outboundOrderId_idx" ON "outbound_order_items"("outboundOrderId");

-- CreateIndex
CREATE INDEX "outbound_order_items_iwasku_idx" ON "outbound_order_items"("iwasku");

-- CreateIndex
CREATE INDEX "user_shelf_permissions_userId_idx" ON "user_shelf_permissions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_shelf_permissions_userId_warehouseCode_key" ON "user_shelf_permissions"("userId", "warehouseCode");

-- AddForeignKey
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_warehouseCode_fkey" FOREIGN KEY ("warehouseCode") REFERENCES "warehouses"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelf_stock" ADD CONSTRAINT "shelf_stock_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelf_boxes" ADD CONSTRAINT "shelf_boxes_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelf_movements" ADD CONSTRAINT "shelf_movements_reverseOfId_fkey" FOREIGN KEY ("reverseOfId") REFERENCES "shelf_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_outboundOrderId_fkey" FOREIGN KEY ("outboundOrderId") REFERENCES "outbound_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

