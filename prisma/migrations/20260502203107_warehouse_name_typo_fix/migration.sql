-- Typo fix: Summerset → Somerset (NJ State, Somerset County)
-- Geçmiş 20260429155453_warehouse_rename_ankara_seed migration'ında "Summerset" yazılmış,
-- doğrusu "Somerset". Idempotent: sadece typo'lu kayıt etkilenir.
UPDATE warehouses SET name = 'Somerset Depo' WHERE code = 'NJ' AND name = 'Summerset Depo';
