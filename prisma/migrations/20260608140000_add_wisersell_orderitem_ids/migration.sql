-- Wisersell orderitem id'leri: üretim durumu (Beklemede/Teslim Edildi/Yeni) yazmak için.
-- Onay anında candidate'tan doldurulur; çıkış (Teslim Edildi) candidate temizlendikten saatler
-- sonra olduğundan id'yi sipariş kaydında tutarız. Postgres integer[] (Prisma Int[]), default boş.
ALTER TABLE "outbound_orders" ADD COLUMN "wisersellOrderItemIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
