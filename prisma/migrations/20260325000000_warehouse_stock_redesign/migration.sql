-- Warehouse Stock Redesign: monthly entries → continuous inventory

-- CreateTable: warehouse_products (one row per product)
CREATE TABLE "warehouse_products" (
    "id" TEXT NOT NULL,
    "iwasku" TEXT NOT NULL,
    "eskiStok" INTEGER NOT NULL DEFAULT 0,
    "ilaveStok" INTEGER NOT NULL DEFAULT 0,
    "cikis" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_products_iwasku_key" ON "warehouse_products"("iwasku");

-- Migrate data: move initial stock from old table to new
INSERT INTO "warehouse_products" ("id", "iwasku", "eskiStok", "ilaveStok", "cikis", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "iwasku", "quantity", 0, 0, "createdAt", "updatedAt"
FROM "warehouse_stock"
WHERE "weekLabel" IS NULL
ON CONFLICT ("iwasku") DO UPDATE SET "eskiStok" = EXCLUDED."eskiStok";

-- CreateTable: warehouse_weekly (weekly production entries)
CREATE TABLE "warehouse_weekly" (
    "id" TEXT NOT NULL,
    "iwasku" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_weekly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_weekly_iwasku_weekStart_key" ON "warehouse_weekly"("iwasku", "weekStart");

-- CreateIndex
CREATE INDEX "warehouse_weekly_iwasku_idx" ON "warehouse_weekly"("iwasku");

-- AddForeignKey
ALTER TABLE "warehouse_weekly" ADD CONSTRAINT "warehouse_weekly_iwasku_fkey" FOREIGN KEY ("iwasku") REFERENCES "warehouse_products"("iwasku") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropTable: old warehouse_stock
DROP TABLE "warehouse_stock";
