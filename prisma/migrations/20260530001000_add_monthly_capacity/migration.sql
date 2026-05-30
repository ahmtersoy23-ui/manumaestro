-- Aylık üretim kapasitesi tablosu.
-- Sezon sayfasının "Ayarlar" tab'ından operatör günlük desi + çalışma günü girer.
-- İleride sezonsal allocator + üst sınır kriteri bu rakamı tavan olarak kullanır.

CREATE TABLE IF NOT EXISTS "monthly_capacity" (
  "id" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "dailyDesi" INTEGER NOT NULL DEFAULT 500,
  "workingDays" INTEGER NOT NULL DEFAULT 22,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,

  CONSTRAINT "monthly_capacity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "monthly_capacity_month_key" ON "monthly_capacity"("month");

ALTER TABLE "monthly_capacity"
  ADD CONSTRAINT "monthly_capacity_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
