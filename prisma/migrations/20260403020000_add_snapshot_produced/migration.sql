-- Add produced field to month_snapshots (manufacturer-entered production, product-level)
ALTER TABLE "month_snapshots" ADD COLUMN "produced" INT NOT NULL DEFAULT 0;

-- Migrate existing producedQuantity from ProductionRequests to MonthSnapshot.produced
UPDATE month_snapshots ms
SET produced = COALESCE((
  SELECT MAX(pr."producedQuantity")
  FROM production_requests pr
  WHERE pr.iwasku = ms.iwasku AND pr."productionMonth" = ms.month
    AND pr."producedQuantity" > 0
), 0);
