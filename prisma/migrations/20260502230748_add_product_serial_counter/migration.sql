-- CreateTable
CREATE TABLE "product_serial_counters" (
    "iwasku" TEXT NOT NULL,
    "lastSerial" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_serial_counters_pkey" PRIMARY KEY ("iwasku")
);
