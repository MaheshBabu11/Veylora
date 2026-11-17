import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createExtractorFromFile } from "node-unrar-js";
import { getCacheRoot, resolveBooksFile } from "./filesystem";

const execFile = promisify(execFileCallback);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);
const MAX_ARCHIVE_LIST_BYTES = 16 * 1024 * 1024;
const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const CACHE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;

export type ArchiveImage = { entry: string; contentType: string };

declare global {
  var __veyloraRarOperationQueue: Promise<void> | undefined;
}

function withRarOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = (globalThis.__veyloraRarOperationQueue ??= Promise.resolve()).then(operation);
  globalThis.__veyloraRarOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}

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
  if (/\.cbr$/i.test(safePath)) {
    return withRarOperation(async () => {
      const extractor = await createExtractorFromFile({ filepath: safePath });
      const { arcHeader, fileHeaders } = extractor.getFileList();
      const images: ArchiveImage[] = [];
      let entryCount = 0;
      for (const header of fileHeaders) {
        entryCount += 1;
        if (entryCount > 100_000) continue;
        if (header.flags.directory || header.flags.encrypted || !safeArchiveEntry(header.name)) continue;
        if (IMAGE_EXTENSIONS.has(path.posix.extname(header.name.replaceAll("\\", "/")).toLowerCase())) {
          images.push({ entry: header.name, contentType: contentTypeFor(header.name) });
        }
      }
      if (entryCount > 100_000) throw new Error("The RAR archive contains too many entries.");
      if (arcHeader.flags.volume) throw new Error("Multi-volume RAR archives are not supported.");
      return images.sort((left, right) => left.entry.localeCompare(right.entry, undefined, { numeric: true }));
    });
  }
  if (!/\.(cbz|zip)$/i.test(safePath)) {
    throw new Error("Only CBZ, ZIP, and CBR archives are supported.");
  }
  const { stdout } = await execFile("unzip", ["-Z1", safePath], { timeout: 30_000, maxBuffer: MAX_ARCHIVE_LIST_BYTES });
  return stdout.split(/\r?\n/)
    .filter((entry) => safeArchiveEntry(entry) && IMAGE_EXTENSIONS.has(path.posix.extname(entry).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((entry) => ({ entry, contentType: contentTypeFor(entry) }));
}

async function readRarImage(archivePath: string, entry: string) {
  const selectedSize = await withRarOperation(async () => {
    const extractor = await createExtractorFromFile({ filepath: archivePath });
    const { arcHeader, fileHeaders } = extractor.getFileList();
    let size: number | undefined;
    for (const header of fileHeaders) {
      if (header.name === entry && !header.flags.directory && !header.flags.encrypted) {
        size = header.unpSize;
      }
    }
    if (arcHeader.flags.volume) throw new Error("Multi-volume RAR archives are not supported.");
    return size;
  });
  if (selectedSize === undefined) throw new Error("The requested image was not found in the RAR archive.");
  if (selectedSize > MAX_PAGE_BYTES) throw new Error("The requested archive image exceeds the 32 MiB page limit.");

  const cacheRoot = await getCacheRoot();
  const temporaryDirectory = await mkdtemp(path.join(cacheRoot, ".veylora-rar-"));
  const extractedPath = path.join(temporaryDirectory, "page.bin");
  try {
    await withRarOperation(async () => {
      const fileExtractor = await createExtractorFromFile({
        filepath: archivePath,
        targetPath: temporaryDirectory,
        filenameTransform: () => "page.bin",
      });
      const files = [...fileExtractor.extract({ files: [entry] }).files];
      if (files.length !== 1) throw new Error("The requested image could not be extracted from the RAR archive.");
    });
    const imageStat = await stat(extractedPath);
    if (imageStat.size > MAX_PAGE_BYTES) throw new Error("The requested archive image exceeds the 32 MiB page limit.");
    return await readFile(extractedPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
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

  const data = /\.cbr$/i.test(safePath)
    ? await readRarImage(safePath, entry)
    : (await execFile("unzip", ["-p", safePath, entry], {
      encoding: "buffer",
      timeout: 30_000,
      maxBuffer: MAX_PAGE_BYTES,
    })).stdout;
  const temporary = path.join(cacheRoot, `${key}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await rename(temporary, cachedPath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await pruneCache(cacheRoot);
  return data;
}
