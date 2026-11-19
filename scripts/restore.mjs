import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import nextEnv from "@next/env";
import { getDatabaseTarget, getPostgresEnvironment, requireLocalBooksDatabase } from "./postgres-tools.mjs";

nextEnv.loadEnvConfig(process.cwd());
const execFile = promisify(execFileCallback);

try {
  if (!process.argv.includes("--confirm")) {
    throw new Error("Refusing to overwrite database objects. Re-run with `npm run db:restore -- <backup.dump> --confirm`.");
  }
  const backupPath = process.argv.slice(2).find((argument) => argument !== "--confirm");
  if (!backupPath) throw new Error("Provide the path to a custom-format PostgreSQL dump.");

  const target = getDatabaseTarget();
  requireLocalBooksDatabase(target);
  const resolvedBackupPath = path.resolve(backupPath);
  if (!(await stat(resolvedBackupPath)).isFile()) throw new Error("The backup path must be a regular file.");

  await execFile("pg_restore", [
    "--clean",
    "--if-exists",
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-acl",
    resolvedBackupPath,
  ], {
    env: getPostgresEnvironment(target.url, target.database),
    maxBuffer: 10 * 1024 * 1024,
  });
  console.info(`Database restored from ${resolvedBackupPath} into local ${target.url.hostname}/${target.database}.`);
  console.info("The schema and data now match the backup; run `npm run db:migrate` if the dump predates a required migration.");
} catch (error) {
  console.error("Database restore failed.", error);
  process.exitCode = 1;
}
