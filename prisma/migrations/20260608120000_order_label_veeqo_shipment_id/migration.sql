-- Veeqo etiket iadesi/iptali için remote_shipment_id (cancel anahtarı).
-- DELETE /shipping/api/v1/shipments/{veeqoShipmentId} ile Veeqo'da void+iade.
ALTER TABLE "order_labels" ADD COLUMN "veeqoShipmentId" TEXT;
