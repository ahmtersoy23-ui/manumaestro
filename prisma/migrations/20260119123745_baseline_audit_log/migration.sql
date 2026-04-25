-- Baseline: AuditAction enum ve audit_logs tablosu (init migration'da eksikti)
-- Lokal DB'de zaten mevcut (db push ile yaratılmıştı), shadow DB için idempotent.
-- 20260324000000_add_warehouse_stock'taki ALTER TYPE'ların çalışabilmesi için bu önce uygulanmalı.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditAction') THEN
    CREATE TYPE "AuditAction" AS ENUM (
      'CREATE_REQUEST',
      'UPDATE_REQUEST',
      'DELETE_REQUEST',
      'CREATE_MARKETPLACE',
      'UPDATE_MARKETPLACE',
      'DELETE_MARKETPLACE',
      'UPDATE_PRODUCTION',
      'LOGIN',
      'LOGOUT',
      'BULK_UPLOAD',
      'EXPORT_DATA',
      'ACCESS_DENIED',
      'ROUTE_TO_SHIPMENT'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "userName"     TEXT NOT NULL,
  "userEmail"    TEXT NOT NULL,
  "action"       "AuditAction" NOT NULL,
  "entityType"   TEXT,
  "entityId"     TEXT,
  "description"  TEXT NOT NULL,
  "metadata"     JSONB,
  "ipAddress"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx"               ON "audit_logs"("userId");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx"               ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx"            ON "audit_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_entityType_entityId_idx"  ON "audit_logs"("entityType","entityId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'audit_logs_userId_fkey' AND table_name = 'audit_logs'
  ) THEN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END$$;
