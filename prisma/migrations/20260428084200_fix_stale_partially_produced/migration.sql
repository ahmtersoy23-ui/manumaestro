-- Fix stale PARTIALLY_PRODUCED / REQUESTED / IN_PRODUCTION requests that should be COMPLETED.
-- Bu kayıtlar waterfallComplete'in early-exit'i nedeniyle DB'de eski statüde kaldı:
-- producedQuantity gönderildi ama değişmediği için recompute atlandı. Artık her save'de
-- waterfall çağrılıyor, ama tarihsel kayıtları bir defaya mahsus düzeltmek gerekiyor.

UPDATE production_requests pr
SET status = 'COMPLETED'
FROM month_snapshots ms
WHERE ms.month = pr.production_month
  AND ms.iwasku = pr.iwasku
  AND pr.status IN ('PARTIALLY_PRODUCED', 'REQUESTED', 'IN_PRODUCTION')
  AND (ms.warehouse_stock + ms.produced) >= ms.total_requested;
