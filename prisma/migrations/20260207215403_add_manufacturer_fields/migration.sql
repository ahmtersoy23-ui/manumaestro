-- CreateEnum
CREATE TYPE "RequestPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "WorkflowStage" AS ENUM ('REQUESTED', 'CUTTING', 'ASSEMBLY', 'QUALITY_CHECK', 'PACKAGING', 'READY_TO_SHIP');

-- AlterTable
ALTER TABLE "production_requests" ADD COLUMN "manufacturerNotes" TEXT,
ADD COLUMN "producedQuantity" INTEGER,
ADD COLUMN "productSize" DOUBLE PRECISION,
ADD COLUMN "workflowStage" "WorkflowStage",
ADD COLUMN "productionMonth" TEXT NOT NULL,
ADD COLUMN "priority" "RequestPriority" NOT NULL DEFAULT 'MEDIUM';

-- CreateIndex
CREATE INDEX "production_requests_createdAt_idx" ON "production_requests"("createdAt");

-- CreateIndex
CREATE INDEX "production_requests_enteredById_idx" ON "production_requests"("enteredById");

-- CreateIndex
CREATE INDEX "production_requests_productCategory_idx" ON "production_requests"("productCategory");

-- CreateIndex
CREATE INDEX "production_requests_productionMonth_idx" ON "production_requests"("productionMonth");

-- CreateIndex
CREATE INDEX "production_requests_workflowStage_idx" ON "production_requests"("workflowStage");

-- CreateIndex
CREATE INDEX "production_requests_productCategory_workflowStage_idx" ON "production_requests"("productCategory", "workflowStage");

-- CreateIndex
CREATE INDEX "production_requests_priority_idx" ON "production_requests"("priority");

-- CreateIndex
CREATE INDEX "production_requests_productCategory_productionMonth_idx" ON "production_requests"("productCategory", "productionMonth");

-- CreateIndex
CREATE INDEX "production_requests_marketplaceId_productionMonth_idx" ON "production_requests"("marketplaceId", "productionMonth");

-- CreateIndex
CREATE INDEX "production_requests_status_productionMonth_idx" ON "production_requests"("status", "productionMonth");
