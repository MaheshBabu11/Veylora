import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import pg from "pg";
import { afterAll } from "vitest";

const { Pool } = pg;
let adminPool: InstanceType<typeof Pool> | undefined;
let applicationPool: InstanceType<typeof Pool> | undefined;
let schemaName: string | undefined;
let booksRoot: string | undefined;
let cacheRoot: string | undefined;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalBooksDirectory = process.env.VEYLORA_BOOKS_DIR;
const originalCacheDirectory = process.env.VEYLORA_CACHE_DIR;

async function initializeIntegrationDatabase() {
  const originalNodeEnvironment = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "development");
  try {
    nextEnv.loadEnvConfig(process.cwd(), true);
  } finally {
    if (originalNodeEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnvironment);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set DATABASE_URL (including credentials if required) to the local `books` database before integration tests.");
  }

  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || databaseName !== "books") {
    throw new Error("Integration tests are restricted to the local `books` database.");
  }

  adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
  const extension = await adminPool.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
  if (!extension.rowCount) {
    throw new Error("The local `books` database must have its application migrations applied before integration tests.");
  }

  schemaName = `veylora_test_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);

  const testUrl = new URL(databaseUrl);
  const existingOptions = testUrl.searchParams.get("options") || "";
  testUrl.searchParams.set("options", `${existingOptions} -csearch_path=${schemaName},public`.trim());
  process.env.DATABASE_URL = testUrl.toString();

  booksRoot = await mkdtemp(path.join(os.tmpdir(), "veylora-integration-"));
  process.env.VEYLORA_BOOKS_DIR = booksRoot;
  cacheRoot = await mkdtemp(path.join(os.tmpdir(), "veylora-integration-cache-"));
  process.env.VEYLORA_CACHE_DIR = cacheRoot;

  const migrationPool = new Pool({ connectionString: testUrl.toString(), max: 1 });
  const migrationsDirectory = path.resolve(process.cwd(), "drizzle/migrations");
  try {
    await migrationPool.query(`CREATE TABLE _veylora_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrations) {
      const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
      const client = await migrationPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO _veylora_migrations(name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Integration test migration ${name} failed.`, { cause: error });
      } finally {
        client.release();
      }
    }
  } finally {
    await migrationPool.end();
  }

  const applicationDatabase = await import("../../src/server/db");
  applicationPool = applicationDatabase.pool;
}

afterAll(async () => {
  if (applicationPool) await applicationPool.end();
  if (adminPool) {
    if (schemaName) await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
  }
  if (booksRoot) await rm(booksRoot, { recursive: true, force: true });
  if (cacheRoot) await rm(cacheRoot, { recursive: true, force: true });

  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalBooksDirectory === undefined) delete process.env.VEYLORA_BOOKS_DIR;
  else process.env.VEYLORA_BOOKS_DIR = originalBooksDirectory;
  if (originalCacheDirectory === undefined) delete process.env.VEYLORA_CACHE_DIR;
  else process.env.VEYLORA_CACHE_DIR = originalCacheDirectory;
});

await initializeIntegrationDatabase();
