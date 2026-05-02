-- WMS Faz 1.3: Cycle counting (devirli sayım)
-- ABC sınıflandırmaya göre periyodik raf sayımı + audit-aware adjustment

-- 1. MovementType enum'a ADJUSTMENT ekle (REVERSAL'dan önce)
ALTER TYPE "MovementType" ADD VALUE 'ADJUSTMENT' BEFORE 'REVERSAL';

-- 2. Yeni enum'lar
CREATE TYPE "CycleCountStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY');
CREATE TYPE "CycleCountItemSource" AS ENUM ('STOCK', 'BOX');
CREATE TYPE "CycleCountResolution" AS ENUM ('ACCEPT', 'INVESTIGATE', 'IGNORE');

-- 3. CycleCountTask tablosu
CREATE TABLE "cycle_count_tasks" (
    "id" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "shelfId" TEXT NOT NULL,
    "abcClass" TEXT,
    "status" "CycleCountStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toleranceQty" INTEGER NOT NULL DEFAULT 0,
    "assignedToId" TEXT,
    "startedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_count_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cycle_count_tasks_warehouseCode_status_idx"
    ON "cycle_count_tasks"("warehouseCode", "status");
CREATE INDEX "cycle_count_tasks_shelfId_idx" ON "cycle_count_tasks"("shelfId");

ALTER TABLE "cycle_count_tasks" ADD CONSTRAINT "cycle_count_tasks_shelfId_fkey"
    FOREIGN KEY ("shelfId") REFERENCES "shelves"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. CycleCountItem tablosu
CREATE TABLE "cycle_count_items" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "iwasku" TEXT NOT NULL,
    "source" "CycleCountItemSource" NOT NULL,
    "shelfStockId" TEXT,
    "shelfBoxId" TEXT,
    "systemQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "diffQty" INTEGER,
    "resolution" "CycleCountResolution",
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "cycle_count_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cycle_count_items_taskId_idx" ON "cycle_count_items"("taskId");
CREATE INDEX "cycle_count_items_iwasku_idx" ON "cycle_count_items"("iwasku");

ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "cycle_count_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
