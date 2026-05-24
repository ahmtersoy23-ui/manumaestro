-- StockPulse → ManuMaestro köprüsü: ProductionSuggestion modeli + STOCKPULSE entryType + depo marketplace'leri.

-- 1. EntryType enum'una STOCKPULSE ekle
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'STOCKPULSE';

-- 2. SuggestionStatus enum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED', 'EXPIRED');

-- 3. production_suggestions tablosu
CREATE TABLE "production_suggestions" (
  "id"                TEXT NOT NULL,
  "iwasku"            TEXT NOT NULL,
  "productName"       TEXT NOT NULL,
  "productCategory"   TEXT NOT NULL,
  "productSize"       DOUBLE PRECISION,
  "marketplaceId"     TEXT NOT NULL,
  "productionMonth"   TEXT NOT NULL,
  "suggestedQty"      INTEGER NOT NULL,
  "formulaVersion"    TEXT NOT NULL,
  "reasoning"         TEXT,
  "l30"               INTEGER NOT NULL,
  "l90"               INTEGER NOT NULL,
  "l180"              INTEGER NOT NULL,
  "status"            "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "acceptedRequestId" TEXT,
  "syncedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt"         TIMESTAMP(3),
  "decidedById"       TEXT,

  CONSTRAINT "production_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_suggestions_iwasku_marketplaceId_productionMonth_key"
  ON "production_suggestions"("iwasku", "marketplaceId", "productionMonth");

CREATE INDEX "production_suggestions_status_productionMonth_idx"
  ON "production_suggestions"("status", "productionMonth");

CREATE INDEX "production_suggestions_marketplaceId_status_idx"
  ON "production_suggestions"("marketplaceId", "status");

ALTER TABLE "production_suggestions"
  ADD CONSTRAINT "production_suggestions_marketplaceId_fkey"
  FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "production_suggestions"
  ADD CONSTRAINT "production_suggestions_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. pricelab user'a GRANT (memory feedback_manumaestro_prisma_grant.md)
GRANT ALL ON TABLE "production_suggestions" TO pricelab;

-- 5. Depo marketplace seed (NJ_DEPO + UK_DEPO + EU_NL_DEPO).
-- Mevcut detaylı marketplace'ler (Shopify/Walmart/CITI/Bol/Kaufland) manuel girişler için korunur.
-- V2 akışı bu konsolide depo'lara tek satır olarak yazar.
INSERT INTO "marketplaces" ("id", "name", "code", "marketplaceType", "region", "isCustom", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'US NJ Depo (StockPulse)',  'NJ_DEPO',    'CUSTOM', 'US', true, true, NOW(), NOW()),
  (gen_random_uuid(), 'UK Depo (StockPulse)',     'UK_DEPO',    'CUSTOM', 'UK', true, true, NOW(), NOW()),
  (gen_random_uuid(), 'EU NL Depo (StockPulse)',  'EU_NL_DEPO', 'CUSTOM', 'NL', true, true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
