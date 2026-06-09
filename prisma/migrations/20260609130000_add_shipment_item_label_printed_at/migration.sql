-- AddColumn: Fairfield EAN ürün etiketi basıldı işareti (depo görsel takibi)
ALTER TABLE "shipment_items" ADD COLUMN "labelPrintedAt" TIMESTAMP(3);
