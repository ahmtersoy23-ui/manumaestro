-- Add type column to warehouse_weekly for PRODUCTION vs SHIPMENT tracking
ALTER TABLE "warehouse_weekly" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'PRODUCTION';

-- Update unique constraint to include type
ALTER TABLE "warehouse_weekly" DROP CONSTRAINT IF EXISTS "warehouse_weekly_iwasku_weekStart_key";
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_weekly_iwasku_weekStart_type_key" ON "warehouse_weekly"("iwasku", "weekStart", "type");
