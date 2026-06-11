-- Stok push: Amazon handling time (lead_time_to_ship_max_days) için config + standart + state alanları.
-- Hepsi nullable (additive, güvenli). null = handling gönderilmez (mevcut/Amazon default kalır).

ALTER TABLE "stock_push_config" ADD COLUMN "handlingDays" INTEGER;
ALTER TABLE "stock_push_settings" ADD COLUMN "standardHandlingDays" INTEGER;
ALTER TABLE "stock_push_state" ADD COLUMN "lastHandling" INTEGER;
