-- CreateTable
CREATE TABLE "user_stock_permissions" (
    "userId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "user_stock_permissions_userId_key" ON "user_stock_permissions"("userId");

-- AddForeignKey
ALTER TABLE "user_stock_permissions" ADD CONSTRAINT "user_stock_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "warehouse_stock" (
    "id" TEXT NOT NULL,
    "iwasku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "month" TEXT NOT NULL,
    "weekLabel" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_stock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_stock_iwasku_month_weekLabel_key" ON "warehouse_stock"("iwasku", "month", "weekLabel");

-- CreateIndex
CREATE INDEX "warehouse_stock_month_idx" ON "warehouse_stock"("month");

-- CreateIndex
CREATE INDEX "warehouse_stock_iwasku_idx" ON "warehouse_stock"("iwasku");

-- CreateTable
CREATE TABLE "month_snapshots" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "iwasku" TEXT NOT NULL,
    "totalRequested" INTEGER NOT NULL,
    "warehouseStock" INTEGER NOT NULL,
    "netProduction" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "month_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "month_snapshots_month_iwasku_key" ON "month_snapshots"("month", "iwasku");

-- CreateIndex
CREATE INDEX "month_snapshots_month_idx" ON "month_snapshots"("month");

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'MONTH_CLOSE';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_STOCK';
