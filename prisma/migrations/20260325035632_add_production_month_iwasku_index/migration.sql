-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "production_requests_productionMonth_iwasku_idx" ON "production_requests"("productionMonth", "iwasku");
