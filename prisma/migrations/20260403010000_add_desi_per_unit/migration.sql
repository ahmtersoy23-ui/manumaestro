-- Add desiPerUnit as a permanent per-unit desi value
ALTER TABLE "stock_reserves" ADD COLUMN "desiPerUnit" DOUBLE PRECISION;

-- Populate from existing data: targetDesi / targetQuantity where possible
UPDATE "stock_reserves"
SET "desiPerUnit" = "targetDesi" / "targetQuantity"
WHERE "targetQuantity" > 0 AND "targetDesi" IS NOT NULL AND "targetDesi" > 0;

-- For products where targetQuantity=0 but targetDesi still has the original value (ghost desi):
-- desiPerUnit = targetDesi / initialStock (since original target was fully covered by initialStock)
UPDATE "stock_reserves"
SET "desiPerUnit" = "targetDesi" / "initialStock"
WHERE "targetQuantity" = 0 AND "initialStock" > 0 AND "targetDesi" IS NOT NULL AND "targetDesi" > 0
  AND "desiPerUnit" IS NULL;

-- Now fix the ghost targetDesi: products fully stocked should have targetDesi = 0
UPDATE "stock_reserves"
SET "targetDesi" = 0
WHERE "targetQuantity" = 0 AND "targetDesi" > 0;
