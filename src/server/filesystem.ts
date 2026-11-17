import { lstat, mkdir, readdir, realpath, stat, statfs, unlink } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BOOKS_ROOT = "/mnt/data/Docker/books";

export function getConfiguredBooksRoot() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.VEYLORA_BOOKS_DIR || DEFAULT_BOOKS_ROOT);
}

export async function getBooksRoot() {
  const configured = getConfiguredBooksRoot();
  const canonical = await realpath(/*turbopackIgnore: true*/ configured);
  const info = await lstat(canonical);
  if (!info.isDirectory()) throw new Error("The configured books path is not a directory.");
  return canonical;
}

export function isWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveBooksFile(candidate: string) {
  const root = await getBooksRoot();
  const canonical = await realpath(candidate);
  if (!isWithinRoot(root, canonical)) throw new Error("The requested file is outside the configured books directory.");
  const info = await lstat(canonical);
  if (!info.isFile()) throw new Error("The requested path is not a regular file.");
  return canonical;
}

export async function listArchives(root: string) {
  const found: string[] = [];
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop()!;
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (child.name.startsWith(".")) continue;
      const fullPath = path.join(directory, child.name);
      if (child.isDirectory()) queue.push(fullPath);
      else if (child.isFile() && /\.(cbz|zip|cbr)$/i.test(child.name)) found.push(fullPath);
      if (found.length > 100_000) throw new Error("Library scan stopped: more than 100,000 archives were found.");
    }
  }
  return found.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export async function getCacheRoot() {
  const cacheRoot = path.resolve(/*turbopackIgnore: true*/ process.env.VEYLORA_CACHE_DIR || path.join(process.cwd(), "storage", "cache"));
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  return cacheRoot;
}

export async function clearPageCache() {
  const cacheRoot = await getCacheRoot();
  const entries = await readdir(/*turbopackIgnore: true*/ cacheRoot, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".page")) continue;
    await unlink(/*turbopackIgnore: true*/ path.join(cacheRoot, entry.name));
    removed += 1;
  }
  return removed;
}

export async function getStorageStats() {
  const root = await getBooksRoot();
  const cacheRoot = await getCacheRoot();
  const archives: string[] = [];
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop()!;
    for (const child of await readdir(directory, { withFileTypes: true })) {
      if (child.name.startsWith(".")) continue;
      const fullPath = path.join(directory, child.name);
      if (child.isDirectory()) queue.push(fullPath);
      else if (child.isFile() && /\.(cbz|zip|cbr)$/i.test(child.name)) archives.push(fullPath);
    }
  }
  const archiveStats = await Promise.all(archives.map((archive) => stat(/*turbopackIgnore: true*/ archive)));
  const cacheEntries = await readdir(/*turbopackIgnore: true*/ cacheRoot, { withFileTypes: true });
  const cacheStats = await Promise.all(cacheEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".page")).map((entry) => stat(/*turbopackIgnore: true*/ path.join(cacheRoot, entry.name))));
  const disk = await statfs(root);
  return {
    archiveCount: archives.length,
    archiveBytes: archiveStats.reduce((total, info) => total + info.size, 0),
    cacheBytes: cacheStats.reduce((total, info) => total + info.size, 0),
    availableBytes: Number(disk.bavail) * Number(disk.bsize),
    booksRoot: root,
  };
}
