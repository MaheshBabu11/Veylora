import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createExtractorFromFile } from "node-unrar-js";
import sharp from "sharp";
import { getCacheRoot, resolveBooksFile } from "./filesystem";

const execFile = promisify(execFileCallback);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);
const MAX_ARCHIVE_LIST_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 20 * 1024 ** 3;
const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const CACHE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;
export const ARCHIVE_IMAGE_WIDTHS = [640, 960, 1280, 1920] as const;
export type ArchiveImageWidth = typeof ARCHIVE_IMAGE_WIDTHS[number];
const variantOperations = new Map<string, Promise<Buffer>>();

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

async function validateZipArchive(safePath: string) {
  const { stdout } = await execFile("unzip", ["-Z", "-v", safePath], {
    timeout: 30_000,
    maxBuffer: MAX_ARCHIVE_LIST_BYTES,
  });
  const entries = stdout.match(/Central directory entry #\d+:/g) ?? [];
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("The ZIP archive contains too many entries.");
  const sizes = [...stdout.matchAll(/uncompressed size:\s*(\d+)\s+bytes/gi)];
  if (sizes.length !== entries.length) throw new Error("The ZIP archive entry sizes could not be validated.");
  let expandedBytes = 0;
  for (const [, value] of sizes) {
    const size = Number(value);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("The ZIP archive contains an invalid entry size.");
    expandedBytes += size;
    if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw new Error("The ZIP archive expands beyond the 20 GiB limit.");
    }
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
      let expandedBytes = 0;
      for (const header of fileHeaders) {
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error("The RAR archive contains too many entries.");
        const expandedSize = Number(header.unpSize);
        if (!Number.isSafeInteger(expandedSize) || expandedSize < 0) {
          throw new Error("The RAR archive contains an invalid entry size.");
        }
        expandedBytes += expandedSize;
        if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
          throw new Error("The RAR archive expands beyond the 20 GiB limit.");
        }
        if (header.flags.directory || header.flags.encrypted || !safeArchiveEntry(header.name)) continue;
        if (IMAGE_EXTENSIONS.has(path.posix.extname(header.name.replaceAll("\\", "/")).toLowerCase())) {
          images.push({ entry: header.name, contentType: contentTypeFor(header.name) });
        }
      }
      if (arcHeader.flags.volume) throw new Error("Multi-volume RAR archives are not supported.");
      return images.sort((left, right) => left.entry.localeCompare(right.entry, undefined, { numeric: true }));
    });
  }
  if (!/\.(cbz|zip)$/i.test(safePath)) {
    throw new Error("Only CBZ, ZIP, and CBR archives are supported.");
  }
  await validateZipArchive(safePath);
  const { stdout } = await execFile("unzip", ["-Z1", safePath], { timeout: 30_000, maxBuffer: MAX_ARCHIVE_LIST_BYTES });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("The ZIP archive contains too many entries.");
  return entries
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

async function readOrCreateCachedImage(cacheRoot: string, key: string, create: () => Promise<Buffer>) {
  const cachedPath = path.join(cacheRoot, `${key}.page`);
  try {
    return await readFile(cachedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const data = await create();
  if (data.byteLength > MAX_PAGE_BYTES) throw new Error("The requested archive image exceeds the 32 MiB page limit.");
  const temporary = path.join(cacheRoot, `${key}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await rename(temporary, cachedPath);
  } catch (error) {
    await unlink(temporary).catch((cleanupError: unknown) => {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
  await pruneCache(cacheRoot);
  return data;
}

export async function readArchiveImage(archivePath: string, entry: string, width?: ArchiveImageWidth) {
  if (!safeArchiveEntry(entry) || !IMAGE_EXTENSIONS.has(path.posix.extname(entry).toLowerCase())) {
    throw new Error("The requested archive entry is not a supported image.");
  }
  const safePath = await resolveBooksFile(archivePath);
  const archiveStat = await stat(safePath);
  const cacheRoot = await getCacheRoot();
  const key = createHash("sha256")
    .update(`${safePath}\0${archiveStat.size}\0${archiveStat.mtimeMs}\0${entry}`)
    .digest("hex");
  const original = await readOrCreateCachedImage(cacheRoot, key, async () => /\.cbr$/i.test(safePath)
    ? readRarImage(safePath, entry)
    : (await execFile("unzip", ["-p", safePath, entry], {
      encoding: "buffer",
      timeout: 30_000,
      maxBuffer: MAX_PAGE_BYTES,
    })).stdout);

  if (width === undefined || path.posix.extname(entry).toLowerCase() === ".gif") return original;
  const variantKey = createHash("sha256").update(`${key}\0webp\0${width}`).digest("hex");
  const existingOperation = variantOperations.get(variantKey);
  if (existingOperation) return existingOperation;

  const operation = readOrCreateCachedImage(cacheRoot, variantKey, async () => sharp(original, {
    limitInputPixels: 100_000_000,
    sequentialRead: true,
  }).resize({ width, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer());
  variantOperations.set(variantKey, operation);
  try {
    return await operation;
  } finally {
    if (variantOperations.get(variantKey) === operation) variantOperations.delete(variantKey);
  }
}
