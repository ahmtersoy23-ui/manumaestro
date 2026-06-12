-- Çok-depolu (split) sevk: bir Wisersell siparişi → N alt-OutboundOrder (her depo bir parça).
-- wisersellOrderId artık unique DEĞİL. Idempotency:
--   @@unique([warehouseCode, marketplaceCode, orderNumber]) (her parça farklı depo)
--   + kod seviyesi findChannelDuplicate guard.
DROP INDEX IF EXISTS "outbound_orders_wisersellOrderId_key";
CREATE INDEX IF NOT EXISTS "outbound_orders_wisersellOrderId_idx" ON "outbound_orders"("wisersellOrderId");
