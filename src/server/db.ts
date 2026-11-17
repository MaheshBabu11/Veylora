import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as typeof globalThis & { veyloraPool?: Pool };

export const pool = globalForDb.veyloraPool ?? new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/books",
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

if (process.env.NODE_ENV !== "production") globalForDb.veyloraPool = pool;

export const db = drizzle(pool, { schema });
