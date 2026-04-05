-- Add fnsku column to shipment_items for manual FNSKU entry
ALTER TABLE "shipment_items" ADD COLUMN "fnsku" VARCHAR;
