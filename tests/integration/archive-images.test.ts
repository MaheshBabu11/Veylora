import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getPage } from "@/app/api/series/[id]/chapters/[chapterId]/pages/[pageNumber]/route";
import { clearPageCache, getStorageStats } from "@/server/filesystem";

const { Pool } = pg;
const database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const execFile = promisify(execFileCallback);
const booksRoot = process.env.VEYLORA_BOOKS_DIR!;
let archivePath = "";
let fixtureDirectory = "";
let pngBytes: Buffer;
let gifBytes: Buffer;
let seriesId = "";
let chapterId = "";

beforeAll(async () => {
  const seriesDirectory = path.join(booksRoot, `Responsive Images ${process.pid}`);
  fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), "veylora-image-fixture-"));
  await mkdir(seriesDirectory, { recursive: true });
  archivePath = path.join(seriesDirectory, "Chapter 1.cbz");
  pngBytes = await sharp({
    create: { width: 1600, height: 2400, channels: 3, background: { r: 120, g: 80, b: 40 } },
  }).png().toBuffer();
  gifBytes = await sharp({
    create: { width: 80, height: 120, channels: 3, background: { r: 40, g: 120, b: 80 } },
  }).gif().toBuffer();
  await writeFile(path.join(fixtureDirectory, "page.png"), pngBytes);
  await writeFile(path.join(fixtureDirectory, "animation.gif"), gifBytes);
  await execFile("zip", ["-q", archivePath, "page.png", "animation.gif"], { cwd: fixtureDirectory });
  await rm(fixtureDirectory, { recursive: true, force: true });

  const series = await database.query<{ id: string }>(
    "INSERT INTO series(title, source_path) VALUES ($1, $2) RETURNING id",
    [`Responsive Images ${process.pid}`, seriesDirectory],
  );
  seriesId = series.rows[0].id;
  const chapter = await database.query<{ id: string }>(
    "INSERT INTO chapters(series_id, chapter_number, title, source_path, page_count) VALUES ($1, 1, 'Chapter 1', $2, 2) RETURNING id",
    [seriesId, archivePath],
  );
  chapterId = chapter.rows[0].id;
  await database.query(
    `INSERT INTO chapter_pages(chapter_id, page_number, archive_entry)
     VALUES ($1, 1, 'page.png'), ($1, 2, 'animation.gif')`,
    [chapterId],
  );
});

afterAll(async () => {
  await clearPageCache();
  await database.end();
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

function pageRequest(pageNumber: number, width?: number) {
  const query = width === undefined ? "" : `?width=${width}`;
  return getPage(new Request(`http://localhost/api/series/${seriesId}/chapters/${chapterId}/pages/${pageNumber}${query}`), {
    params: Promise.resolve({ id: seriesId, chapterId, pageNumber: String(pageNumber) }),
  });
}

describe("responsive archive page images", () => {
  it("serves bounded WebP variants and keeps them inside the shared clearable cache", async () => {
    const invalidWidth = await pageRequest(1, 641);
    expect(invalidWidth.status).toBe(400);

    const original = await pageRequest(1);
    expect(original.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await original.arrayBuffer())).toEqual(pngBytes);

    const variant = await pageRequest(1, 640);
    expect(variant.headers.get("content-type")).toBe("image/webp");
    const variantBytes = Buffer.from(await variant.arrayBuffer());
    await expect(sharp(variantBytes).metadata()).resolves.toMatchObject({ format: "webp", width: 640, height: 960 });

    const gif = await pageRequest(2, 960);
    expect(gif.headers.get("content-type")).toBe("image/gif");
    expect(Buffer.from(await gif.arrayBuffer())).toEqual(gifBytes);

    const stats = await getStorageStats();
    expect(stats.cacheBytes).toBeGreaterThan(pngBytes.byteLength + variantBytes.byteLength);
    expect(await clearPageCache()).toBeGreaterThanOrEqual(3);
    expect((await getStorageStats()).cacheBytes).toBe(0);
  });
});
