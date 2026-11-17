import path from "node:path";
import { pool } from "./db";
import { getBooksRoot, listArchives } from "./filesystem";
import { listArchiveImages } from "./archive";

function titleFromPath(root: string, archivePath: string) {
  const relative = path.relative(root, archivePath);
  const segments = relative.split(path.sep);
  return segments.length > 1 ? segments[0] : path.basename(archivePath, path.extname(archivePath));
}

function numberFromName(name: string, fallback: number) {
  const match = name.match(/(?:chapter|ch|vol(?:ume)?)[ ._-]*(\d+)/i);
  return match ? Number(match[1]) : fallback;
}

export async function runLibraryScan(jobId: string) {
  const root = await getBooksRoot();
  const archives = await listArchives(root);
  const directory = await pool.query(
    `INSERT INTO library_directories(path, status, last_scanned_at)
     VALUES ($1, 'scanning', now())
     ON CONFLICT(path) DO UPDATE SET status = 'scanning'
     RETURNING id`,
    [root],
  );
  const directoryId: string = directory.rows[0].id;
  await pool.query(
    `UPDATE scan_jobs SET directory_id = $2, total = $3, progress = 0, status = 'running', updated_at = now() WHERE id = $1`,
    [jobId, directoryId, archives.length],
  );

  const errors: string[] = [];
  const chapterNumbers = new Map<string, Set<number>>();
  for (let index = 0; index < archives.length; index += 1) {
    const archivePath = archives[index];
    try {
      const images = await listArchiveImages(archivePath);
      if (!images.length) throw new Error("No supported image pages were found in this archive.");
      const title = titleFromPath(root, archivePath);
      const seriesPath = path.dirname(archivePath) === root ? archivePath : path.join(root, title);
      const chapterTitle = path.basename(archivePath, path.extname(archivePath));
      const usedNumbers = chapterNumbers.get(seriesPath) ?? new Set<number>();
      let chapterNumber = numberFromName(chapterTitle, usedNumbers.size + 1);
      while (usedNumbers.has(chapterNumber)) chapterNumber += 1;
      usedNumbers.add(chapterNumber);
      chapterNumbers.set(seriesPath, usedNumbers);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const seriesResult = await client.query(
          `INSERT INTO series(title, source_path, directory_id, cover_path)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT(source_path) DO UPDATE SET title = COALESCE(series.title_override, EXCLUDED.title), directory_id = EXCLUDED.directory_id,
             cover_path = EXCLUDED.cover_path, updated_at = now()
           RETURNING id`,
          [title, seriesPath, directoryId, archivePath],
        );
        const seriesId: string = seriesResult.rows[0].id;
        const chapterResult = await client.query(
          `INSERT INTO chapters(series_id, chapter_number, title, source_path, page_count)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(source_path) DO UPDATE SET series_id = EXCLUDED.series_id,
             chapter_number = EXCLUDED.chapter_number, title = EXCLUDED.title, page_count = EXCLUDED.page_count
           RETURNING id`,
          [seriesId, chapterNumber, chapterTitle, archivePath, images.length],
        );
        const chapterId: string = chapterResult.rows[0].id;
        await client.query("DELETE FROM chapter_pages WHERE chapter_id = $1", [chapterId]);
        for (let offset = 0; offset < images.length; offset += 250) {
          const batch = images.slice(offset, offset + 250);
          const params: unknown[] = [];
          const values = batch.map((image, itemIndex) => {
            params.push(chapterId, offset + itemIndex + 1, image.entry);
            const base = itemIndex * 3;
            return `($${base + 1}, $${base + 2}, $${base + 3})`;
          });
          await client.query(
            `INSERT INTO chapter_pages(chapter_id, page_number, archive_entry) VALUES ${values.join(", ")}`,
            params,
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      errors.push(`${path.relative(root, archivePath)}: ${error instanceof Error ? error.message : "Unable to read archive."}`);
    }
    await pool.query("UPDATE scan_jobs SET progress = $2, updated_at = now() WHERE id = $1", [jobId, index + 1]);
  }

  const errorSummary = errors.length ? `${errors.length} archive(s) could not be indexed:\n${errors.slice(0, 100).join("\n")}` : null;
  await pool.query(
    `UPDATE library_directories SET status = 'active', last_scanned_at = now() WHERE id = $1`,
    [directoryId],
  );
  await pool.query(
    `UPDATE scan_jobs SET status = $2, progress = total, error = $3, updated_at = now() WHERE id = $1`,
    [jobId, errors.length ? "completed_with_errors" : "completed", errorSummary],
  );
  return { scanned: archives.length, errors };
}
