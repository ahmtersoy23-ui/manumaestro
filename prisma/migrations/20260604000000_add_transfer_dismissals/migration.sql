-- Somerset→Fairfield transfer önerisini "yok say" işaretleri.
-- dismissedAt o ürünün son tetikleyici olayından (Fairfield çıkışı / koli kırma)
-- sonra ise öneri gizlenir; yeni olay olursa öneri tekrar belirir.

CREATE TABLE IF NOT EXISTS "transfer_dismissals" (
  "id" TEXT NOT NULL,
  "iwasku" TEXT NOT NULL,
  "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dismissedById" TEXT NOT NULL,

  CONSTRAINT "transfer_dismissals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "transfer_dismissals_iwasku_key" ON "transfer_dismissals"("iwasku");

-- ManuMaestro backend pricelab rolüyle bağlanır — GRANT olmazsa 500 permission denied.
GRANT SELECT, INSERT, UPDATE, DELETE ON "transfer_dismissals" TO pricelab;
