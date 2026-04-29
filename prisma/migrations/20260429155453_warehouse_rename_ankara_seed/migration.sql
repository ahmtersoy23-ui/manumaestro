-- Depo isim güncellemeleri (kodlar değişmedi — backend referansları korunur)
UPDATE warehouses SET name = 'Summerset Depo' WHERE code = 'NJ';
UPDATE warehouses SET name = 'Fairfield Depo' WHERE code = 'SHOWROOM';

-- Ankara depo raf seed: 18 raf × 3 kat = 54 hücre (hibrit format)
-- A duvarı: A1-1 .. A10-3 (10 raf × 3 kat = 30 hücre)
-- B duvarı: B1-1 .. B8-3 (8 raf × 3 kat = 24 hücre)
INSERT INTO shelves (id, "warehouseCode", code, "shelfType", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'ANKARA', t.code, 'NORMAL', true, NOW(), NOW()
FROM (VALUES
  ('A1-1'), ('A1-2'), ('A1-3'),
  ('A2-1'), ('A2-2'), ('A2-3'),
  ('A3-1'), ('A3-2'), ('A3-3'),
  ('A4-1'), ('A4-2'), ('A4-3'),
  ('A5-1'), ('A5-2'), ('A5-3'),
  ('A6-1'), ('A6-2'), ('A6-3'),
  ('A7-1'), ('A7-2'), ('A7-3'),
  ('A8-1'), ('A8-2'), ('A8-3'),
  ('A9-1'), ('A9-2'), ('A9-3'),
  ('A10-1'), ('A10-2'), ('A10-3'),
  ('B1-1'), ('B1-2'), ('B1-3'),
  ('B2-1'), ('B2-2'), ('B2-3'),
  ('B3-1'), ('B3-2'), ('B3-3'),
  ('B4-1'), ('B4-2'), ('B4-3'),
  ('B5-1'), ('B5-2'), ('B5-3'),
  ('B6-1'), ('B6-2'), ('B6-3'),
  ('B7-1'), ('B7-2'), ('B7-3'),
  ('B8-1'), ('B8-2'), ('B8-3')
) AS t(code)
ON CONFLICT ("warehouseCode", code) DO NOTHING;
