-- AlterTable
ALTER TABLE "outbound_orders" ADD COLUMN "addressNote" TEXT;

-- CreateTable
CREATE TABLE "outbound_order_item_allocations" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "shelfId" TEXT,
    "shelfBoxId" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "outbound_order_item_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbound_order_item_allocations_orderItemId_idx" ON "outbound_order_item_allocations"("orderItemId");

-- CreateIndex
CREATE INDEX "outbound_order_item_allocations_shelfId_idx" ON "outbound_order_item_allocations"("shelfId");

-- CreateIndex
CREATE INDEX "outbound_order_item_allocations_shelfBoxId_idx" ON "outbound_order_item_allocations"("shelfBoxId");

-- AddForeignKey
ALTER TABLE "outbound_order_item_allocations"
  ADD CONSTRAINT "outbound_order_item_allocations_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "outbound_order_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- GRANT (manumaestro runtime user'ı 'pricelab' — yeni tablolar için zorunlu)
GRANT ALL ON TABLE "outbound_order_item_allocations" TO pricelab;
