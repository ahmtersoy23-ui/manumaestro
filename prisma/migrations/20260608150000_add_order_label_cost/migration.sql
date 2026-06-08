-- Etiket bedeli (Veeqo book total_charge) — mutabakat + Kapandı export için.
-- İleriye dönük: yalnız bundan sonra alınan etiketlerde dolar; geçmiş etiketlerde NULL.
ALTER TABLE "order_labels" ADD COLUMN "cost" DECIMAL(10,2);
ALTER TABLE "order_labels" ADD COLUMN "costCurrency" TEXT;
