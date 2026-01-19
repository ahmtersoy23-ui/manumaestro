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
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Create connection pool and adapter
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
  user: undefined,
  database: undefined,
  password: undefined,
  host: undefined,
  port: undefined,
});

export async function queryProductDb(query: string, params: any[] = []) {
  const client = await productPool.connect();
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}
