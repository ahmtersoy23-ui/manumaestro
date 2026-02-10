-- Add productionMonth column to production_requests table
ALTER TABLE production_requests
ADD COLUMN "productionMonth" TEXT;

-- Migrate existing data: Extract YYYY-MM from requestDate
UPDATE production_requests
SET "productionMonth" = TO_CHAR("requestDate", 'YYYY-MM')
WHERE "productionMonth" IS NULL;

-- Make productionMonth NOT NULL
ALTER TABLE production_requests
ALTER COLUMN "productionMonth" SET NOT NULL;

-- Add index for productionMonth
CREATE INDEX "production_requests_productionMonth_idx" ON production_requests("productionMonth");

-- Add composite index for category + productionMonth
CREATE INDEX "production_requests_productCategory_productionMonth_idx" ON production_requests("productCategory", "productionMonth");
