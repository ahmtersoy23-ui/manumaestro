-- Ankara depo havuz rafları: giriş ve çıkış için POOL tipi 2 raf
-- Mekanizma kararı (lazy reconciliation vs anlık pre-pack) Faz 2'de verilecek;
-- şu an sadece raf yapısı kuruluyor.

INSERT INTO shelves (id, "warehouseCode", code, "shelfType", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'ANKARA', t.code, 'POOL', true, NOW(), NOW()
FROM (VALUES ('HAVUZ-GIRIS'), ('HAVUZ-CIKIS')) AS t(code)
ON CONFLICT ("warehouseCode", code) DO NOTHING;
