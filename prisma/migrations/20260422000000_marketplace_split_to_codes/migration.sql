-- Mevcut stock_reserves.marketplaceSplit region keyli (US/EU/UK/CA/AU).
-- Yeni format marketplace.code keyli (AMZN_US, WAYFAIR_US, BOL_NL, ...).
-- Şu ana kadar girilen tüm talepler Amazon için girilmiş olduğundan,
-- region key'lerini Amazon karşılıklarına dönüştürüyoruz.
--
-- Kontrol edilmiş: 2026-04-22 itibarıyla 371 kayıtta yalnızca US/EU/UK/CA/AU key'leri mevcut.

UPDATE stock_reserves
SET "marketplaceSplit" = (
  SELECT jsonb_object_agg(
    CASE key
      WHEN 'US' THEN 'AMZN_US'
      WHEN 'EU' THEN 'AMZN_EU'
      WHEN 'UK' THEN 'AMZN_UK'
      WHEN 'CA' THEN 'AMZN_CA'
      WHEN 'AU' THEN 'AMZN_AU'
      ELSE key
    END,
    value
  )
  FROM jsonb_each("marketplaceSplit")
)
WHERE "marketplaceSplit" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_object_keys("marketplaceSplit") AS k(key)
    WHERE k.key IN ('US', 'EU', 'UK', 'CA', 'AU')
  );
