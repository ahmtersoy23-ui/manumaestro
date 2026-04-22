-- Reserve drift düzeltmesi: split_total = initialStock + targetQuantity invariant'ını sağla
--
-- Sebep: Eski reserve PATCH admin split'i azalttığında target'ı split toplamına eşitliyordu
-- ama initialStock'a dokunmuyordu. Sonuç: initialStock > 0 ve split < target+initial olan
-- "kirli" kayıtlar (2026-04-22 itibarıyla 16 kayıt, toplam 321 adet drift).
--
-- Kural: split_total < initialStock ise → initialStock = split_total, targetQuantity = 0
--        split_total >= initialStock ise → initialStock korunur, targetQuantity = split_total - initialStock
-- targetDesi de yeni targetQuantity × desiPerUnit üzerinden hesaplanır.

WITH split_agg AS (
  SELECT
    sr.id,
    COALESCE((
      SELECT SUM((v)::int)
      FROM jsonb_each_text(sr."marketplaceSplit") e(k, v)
    ), 0) AS split_total
  FROM stock_reserves sr
),
to_fix AS (
  SELECT sr.id, sr."initialStock", sr."targetQuantity", sr."desiPerUnit", sa.split_total
  FROM stock_reserves sr
  JOIN split_agg sa ON sa.id = sr.id
  WHERE sa.split_total <> sr."initialStock" + sr."targetQuantity"
)
UPDATE stock_reserves sr
SET
  "initialStock" = LEAST(tf.split_total, tf."initialStock"),
  "targetQuantity" = GREATEST(0, tf.split_total - tf."initialStock"),
  "targetDesi" = GREATEST(0, tf.split_total - tf."initialStock") * COALESCE(tf."desiPerUnit", 0)
FROM to_fix tf
WHERE sr.id = tf.id;
