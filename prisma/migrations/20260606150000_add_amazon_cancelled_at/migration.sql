-- Amazon'da iptal edilmiş ama Wisersell'e yansımamış siparişleri işaretlemek için
-- (SP-API canlı kontrol). Board'da "İptal (Amazon)" rozeti + operatör "Listeden Düş".
ALTER TABLE "outbound_orders" ADD COLUMN "amazonCancelledAt" TIMESTAMP(3);
