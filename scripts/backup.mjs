import { randomUUID } from "node:crypto";
import { chmod, link, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import nextEnv from "@next/env";
import { getDatabaseTarget, getPostgresEnvironment } from "./postgres-tools.mjs";

nextEnv.loadEnvConfig(process.cwd());
const execFile = promisify(execFileCallback);

let partialPath;
try {
  const { url, database } = getDatabaseTarget();
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const destination = path.resolve(process.argv[2] || path.join("backups", `veylora-${timestamp}.dump`));
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  partialPath = `${destination}.${randomUUID()}.partial`;

  await execFile("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    `--file=${partialPath}`,
  ], {
    env: getPostgresEnvironment(url, database),
    maxBuffer: 10 * 1024 * 1024,
  });
  await chmod(partialPath, 0o600);
  await link(partialPath, destination);
  await rm(partialPath);
  partialPath = undefined;
  console.info(`Database backup created: ${destination}`);
  console.info(`Source database: ${url.hostname}/${database}`);
} catch (error) {
  if (partialPath) await rm(partialPath, { force: true }).catch(() => undefined);
  console.error("Database backup failed.", error);
  process.exitCode = 1;
}
