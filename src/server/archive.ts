import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getCacheRoot, resolveBooksFile } from "./filesystem";

const execFile = promisify(execFileCallback);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);
const MAX_ARCHIVE_LIST_BYTES = 16 * 1024 * 1024;
const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const CACHE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;

export type ArchiveImage = { entry: string; contentType: string };

function safeArchiveEntry(entry: string) {
  const normalized = path.posix.normalize(entry.replaceAll("\\", "/"));
  return normalized !== "." && !normalized.startsWith("/") && normalized !== ".." && !normalized.startsWith("../") && !normalized.startsWith("-");
}

function contentTypeFor(entry: string) {
  switch (path.posix.extname(entry).toLowerCase()) {
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".avif": return "image/avif";
    case ".gif": return "image/gif";
    default: return "image/jpeg";
  }
}

export async function listArchiveImages(archivePath: string): Promise<ArchiveImage[]> {
  const safePath = await resolveBooksFile(archivePath);
  if (!/\.(cbz|zip)$/i.test(safePath)) {
    throw new Error("CBR archives are not supported on this system because no RAR reader is installed. Convert the file to CBZ or ZIP.");
  }
  const { stdout } = await execFile("unzip", ["-Z1", safePath], { timeout: 30_000, maxBuffer: MAX_ARCHIVE_LIST_BYTES });
  return stdout.split(/\r?\n/)
    .filter((entry) => safeArchiveEntry(entry) && IMAGE_EXTENSIONS.has(path.posix.extname(entry).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((entry) => ({ entry, contentType: contentTypeFor(entry) }));
}

async function pruneCache(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  const cached: { path: string; size: number; accessedAt: number }[] = [];
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".page")) continue;
    const fullPath = path.join(root, entry.name);
    const info = await stat(fullPath);
    total += info.size;
    cached.push({ path: fullPath, size: info.size, accessedAt: info.atimeMs });
  }
  if (total <= CACHE_LIMIT_BYTES) return;
  cached.sort((a, b) => a.accessedAt - b.accessedAt);
  for (const item of cached) {
    await unlink(item.path);
    total -= item.size;
    if (total <= CACHE_LIMIT_BYTES) break;
  }
}

export async function readArchiveImage(archivePath: string, entry: string) {
  if (!safeArchiveEntry(entry) || !IMAGE_EXTENSIONS.has(path.posix.extname(entry).toLowerCase())) {
    throw new Error("The requested archive entry is not a supported image.");
  }
  const safePath = await resolveBooksFile(archivePath);
  const archiveStat = await stat(safePath);
  const cacheRoot = await getCacheRoot();
  const key = createHash("sha256")
    .update(`${safePath}\0${archiveStat.size}\0${archiveStat.mtimeMs}\0${entry}`)
    .digest("hex");
  const cachedPath = path.join(cacheRoot, `${key}.page`);
  try {
    return await readFile(cachedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const { stdout } = await execFile("unzip", ["-p", safePath, entry], {
    encoding: "buffer",
    timeout: 30_000,
    maxBuffer: MAX_PAGE_BYTES,
  });
  const temporary = path.join(cacheRoot, `${key}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, stdout, { flag: "wx", mode: 0o600 });
    await rename(temporary, cachedPath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await pruneCache(cacheRoot);
  return stdout;
}
