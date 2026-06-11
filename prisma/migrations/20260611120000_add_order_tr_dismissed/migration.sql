-- CreateTable: Mobilya siparişinde "TR" seçilince board'dan gizlenen adaylar (yerel işaret; Wisersell'e dokunulmaz)
CREATE TABLE "order_tr_dismissed" (
    "wisersellOrderId" INTEGER NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedById" TEXT NOT NULL,
    "recipientName" TEXT,
    "orderCode" TEXT,
    CONSTRAINT "order_tr_dismissed_pkey" PRIMARY KEY ("wisersellOrderId")
);
