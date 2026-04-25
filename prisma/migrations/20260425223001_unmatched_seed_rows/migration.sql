-- CreateEnum
CREATE TYPE "UnmatchedStatus" AS ENUM ('PENDING', 'RESOLVED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ResolutionType" AS ENUM ('SKU_MASTER', 'PRODUCTS', 'LOCAL_ALIAS', 'PSEUDO', 'SKIP');

-- CreateTable
CREATE TABLE "unmatched_seed_rows" (
    "id" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawLookup" TEXT NOT NULL,
    "description" TEXT,
    "shelfCode" TEXT NOT NULL,
    "boxNumber" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "UnmatchedStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedIwasku" TEXT,
    "resolutionType" "ResolutionType",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unmatched_seed_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unmatched_seed_rows_warehouseCode_status_idx" ON "unmatched_seed_rows"("warehouseCode", "status");

-- CreateIndex
CREATE INDEX "unmatched_seed_rows_rawLookup_idx" ON "unmatched_seed_rows"("rawLookup");
