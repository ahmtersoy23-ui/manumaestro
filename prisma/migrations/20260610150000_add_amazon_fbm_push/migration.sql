-- Stok push (kanal-bazli): kova konfigurasyonu + ayarlar + son-push state.
-- Ilk kanal AMAZON_US; sonra SHOPIFY_US/WALMART_US ayni tablolara eklenir.

-- CreateEnum
CREATE TYPE "StockPushMode" AS ENUM ('STOCK', 'ZERO');

-- CreateTable
CREATE TABLE "stock_push_config" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'AMAZON_US',
    "iwasku" TEXT NOT NULL,
    "mode" "StockPushMode" NOT NULL,
    "warehouses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "percent" INTEGER NOT NULL DEFAULT 100,
    "floorX" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_push_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_push_config_channel_iwasku_key" ON "stock_push_config"("channel", "iwasku");

-- CreateIndex
CREATE INDEX "stock_push_config_channel_idx" ON "stock_push_config"("channel");

-- CreateTable
CREATE TABLE "stock_push_settings" (
    "channel" TEXT NOT NULL DEFAULT 'AMAZON_US',
    "standardQty" INTEGER NOT NULL DEFAULT 11,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_push_settings_pkey" PRIMARY KEY ("channel")
);

-- CreateTable
CREATE TABLE "stock_push_state" (
    "channel" TEXT NOT NULL,
    "marketplaceSku" TEXT NOT NULL,
    "iwasku" TEXT NOT NULL,
    "lastQty" INTEGER NOT NULL,
    "lastPushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_push_state_pkey" PRIMARY KEY ("channel", "marketplaceSku")
);

-- CreateIndex
CREATE INDEX "stock_push_state_channel_iwasku_idx" ON "stock_push_state"("channel", "iwasku");

-- Amazon US settings satirini olustur (dry-run + disabled baslangic)
INSERT INTO "stock_push_settings" ("channel", "standardQty", "enabled", "dryRun", "updatedAt")
VALUES ('AMAZON_US', 11, false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("channel") DO NOTHING;
