-- Add initialStock column to stock_reserves
ALTER TABLE "stock_reserves" ADD COLUMN "initialStock" INT NOT NULL DEFAULT 0;

-- Move existing producedQuantity (from mark-stock) to initialStock, reset producedQuantity
UPDATE "stock_reserves"
SET "initialStock" = "producedQuantity", "producedQuantity" = 0
WHERE "producedQuantity" > 0;
