/**
 * Prisma Client Instances
 * - prisma: Main ManuMaestro database
 * - productDb: External product database (pricelab_db)
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Declare global type for dev environment
declare global {
  var prisma: PrismaClient | undefined;
}

// Create connection pool and adapter
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  // Explicitly disable env variable fallback
  user: undefined,
  database: undefined,
  password: undefined,
  host: undefined,
  port: undefined,
});
const adapter = new PrismaPg(pool);

// Main database client (manumaestro_db)
export const prisma = globalThis.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// Product database client (pricelab_db)
// Separate connection for products database
const productPool = new Pool({
  connectionString: process.env.PRODUCT_DB_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  user: undefined,
  database: undefined,
  password: undefined,
  host: undefined,
  port: undefined,
});

export async function queryProductDb(query: string, params: (string | number | boolean | null)[] = []) {
  const client = await productPool.connect();
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// DataBridge database client (databridge_db) — Wisersell raw_orders için read-only.
// Production-pipeline endpoint pazar yeri-bazlı L30/L90 hesabında kullanır.
const databridgePool = new Pool({
  connectionString: process.env.DATABRIDGE_DB_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  user: undefined,
  database: undefined,
  password: undefined,
  host: undefined,
  port: undefined,
});

export async function queryDataBridge(query: string, params: (string | number | boolean | null | string[])[] = []) {
  const client = await databridgePool.connect();
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// CargoLens database client (cargolens_db) — read-only.
// Veeqo etiket modalı kıyas paneli: rate_cards (TR→US FedEx tarifesi) + us_shipments
// (FedEx Izmir US-içi geçmiş maliyet).
const cargolensPool = new Pool({
  connectionString: process.env.CARGOLENS_DB_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  user: undefined,
  database: undefined,
  password: undefined,
  host: undefined,
  port: undefined,
});

export async function queryCargolens(query: string, params: (string | number | boolean | null)[] = []) {
  const client = await cargolensPool.connect();
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// Graceful shutdown: close all connection pools (register once)
if (!(globalThis as Record<string, unknown>).__dbCleanupRegistered) {
  (globalThis as Record<string, unknown>).__dbCleanupRegistered = true;
  const cleanup = async () => {
    await productPool.end().catch(() => {});
    await databridgePool.end().catch(() => {});
    await cargolensPool.end().catch(() => {});
    await pool.end().catch(() => {});
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}
