-- AddColumn: Konsolidasyon paleti varışta Fairfield POOL'una patlatıldı işareti (idempotency)
ALTER TABLE "shipment_containers" ADD COLUMN "arrivedAt" TIMESTAMP(3);
