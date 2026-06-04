-- Wisersell sipariş yönlendirme otomasyonu — outbound_orders alanları + OutboundSource enum.
-- Otomatik oluşan siparişleri (WISERSELL_AUTO) izlemek, idempotency (wisersellOrderId @unique)
-- ve external-close sonrası kapanışı (wisersellClosedAt) işaretlemek için.

-- CreateEnum
CREATE TYPE "OutboundSource" AS ENUM ('MANUAL', 'WISERSELL_AUTO');

-- AlterTable
ALTER TABLE "outbound_orders"
  ADD COLUMN "source" "OutboundSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "wisersellOrderId" INTEGER,
  ADD COLUMN "wisersellReadyAt" TIMESTAMP(3),
  ADD COLUMN "wisersellClosedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "outbound_orders_wisersellOrderId_key" ON "outbound_orders"("wisersellOrderId");
