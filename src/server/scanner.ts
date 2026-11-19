import path from "node:path";
import { pool } from "./db";
import { findSeriesCoverImage, getBooksRoot, listArchives, migrateLegacySeriesCover } from "./filesystem";
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

export async function runLibraryScan(jobId: string, workerId: string) {
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
  const claimedJob = await pool.query<{ cancelRequested: boolean }>(
    `UPDATE scan_jobs
     SET directory_id = $2, total = $3, progress = 0, updated_at = now()
     WHERE id = $1 AND worker_id = $4 AND status = 'running'
     RETURNING cancel_requested AS "cancelRequested"`,
    [jobId, directoryId, archives.length, workerId],
  );
  if (!claimedJob.rowCount) throw new Error("The scan worker no longer owns this job.");

  const existingChapters = await pool.query<{ sourcePath: string; seriesPath: string; chapterNumber: number }>(
    `SELECT chapter.source_path AS "sourcePath", series.source_path AS "seriesPath",
            chapter.chapter_number AS "chapterNumber"
     FROM chapters AS chapter
     JOIN series ON series.id = chapter.series_id
     WHERE series.directory_id = $1`,
    [directoryId],
  );
  const existingChaptersByPath = new Map(existingChapters.rows.map((chapter) => [chapter.sourcePath, chapter]));
  const reservedChapterNumbers = new Map<string, Set<number>>();
  for (const archivePath of archives) {
    const title = titleFromPath(root, archivePath);
    const seriesPath = path.dirname(archivePath) === root ? archivePath : path.join(root, title);
    const existing = existingChaptersByPath.get(archivePath);
    if (existing?.seriesPath === seriesPath) {
      const reserved = reservedChapterNumbers.get(seriesPath) ?? new Set<number>();
      reserved.add(existing.chapterNumber);
      reservedChapterNumbers.set(seriesPath, reserved);
    }
  }

  const errors: string[] = [];
  const chapterNumbers = new Map<string, Set<number>>();
  const archivePaths = new Set(archives);
  const seriesCoverImages = new Map<string, string | null>();
  const scannedSeriesPaths = new Set<string>();
  let cancelled = claimedJob.rows[0].cancelRequested;
  let scanned = 0;
  for (let index = 0; index < archives.length && !cancelled; index += 1) {
    const archivePath = archives[index];
    try {
      const images = await listArchiveImages(archivePath);
      if (!images.length) throw new Error("No supported image pages were found in this archive.");
      const title = titleFromPath(root, archivePath);
      const seriesPath = path.dirname(archivePath) === root ? archivePath : path.join(root, title);
      if (!seriesCoverImages.has(seriesPath)) {
        seriesCoverImages.set(seriesPath, await findSeriesCoverImage(seriesPath));
      }
      const coverImagePath = seriesCoverImages.get(seriesPath) ?? null;
      const chapterTitle = path.basename(archivePath, path.extname(archivePath));
      const usedNumbers = chapterNumbers.get(seriesPath) ?? new Set<number>();
      const existing = existingChaptersByPath.get(archivePath);
      const preserveNumber = existing?.seriesPath === seriesPath && !usedNumbers.has(existing.chapterNumber);
      let chapterNumber = preserveNumber ? existing.chapterNumber : numberFromName(chapterTitle, usedNumbers.size + 1);
      const reservedNumbers = reservedChapterNumbers.get(seriesPath);
      while (usedNumbers.has(chapterNumber) || (!preserveNumber && reservedNumbers?.has(chapterNumber))) chapterNumber += 1;
      usedNumbers.add(chapterNumber);
      chapterNumbers.set(seriesPath, usedNumbers);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const seriesResult = await client.query<{ id: string; custom_cover_path: string | null }>(
          `INSERT INTO series(title, source_path, directory_id, cover_path, cover_image_path)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(source_path) DO UPDATE SET title = COALESCE(series.title_override, EXCLUDED.title), directory_id = EXCLUDED.directory_id,
             cover_path = EXCLUDED.cover_path,
             cover_image_path = EXCLUDED.cover_image_path,
             updated_at = now()
           RETURNING id, custom_cover_path`,
          [title, seriesPath, directoryId, archivePath, coverImagePath],
        );
        const seriesId: string = seriesResult.rows[0].id;
        const legacyCoverPath = seriesResult.rows[0].custom_cover_path;
        const chapterValues = [seriesId, chapterNumber, chapterTitle, archivePath, images.length];
        const existingChapter = await client.query<{ id: string }>(
          `UPDATE chapters
           SET series_id = $1, chapter_number = $2, title = $3, source_path = $4, page_count = $5
           WHERE source_path = $4
           RETURNING id`,
          chapterValues,
        );
        let chapterId = existingChapter.rows[0]?.id;
        if (!chapterId) {
          const chapterAtNumber = await client.query<{ id: string; source_path: string }>(
            `SELECT id, source_path FROM chapters
             WHERE series_id = $1 AND chapter_number = $2
             FOR UPDATE`,
            [seriesId, chapterNumber],
          );
          const staleChapter = chapterAtNumber.rows[0];
          if (staleChapter && !archivePaths.has(staleChapter.source_path)) {
            const renamedChapter = await client.query<{ id: string }>(
              `UPDATE chapters
               SET title = $2, source_path = $3, page_count = $4
               WHERE id = $1
               RETURNING id`,
              [staleChapter.id, chapterTitle, archivePath, images.length],
            );
            chapterId = renamedChapter.rows[0]?.id;
          }
        }
        if (!chapterId) {
          const insertedChapter = await client.query<{ id: string }>(
            `INSERT INTO chapters(series_id, chapter_number, title, source_path, page_count)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            chapterValues,
          );
          chapterId = insertedChapter.rows[0].id;
        }
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

        if (legacyCoverPath && path.basename(legacyCoverPath).startsWith(".veylora-cover-")) {
          const coverClient = await pool.connect();
          try {
            await coverClient.query("BEGIN");
            const currentSeries = await coverClient.query<{ custom_cover_path: string | null }>(
              "SELECT custom_cover_path FROM series WHERE id = $1 FOR UPDATE",
              [seriesId],
            );
            if (currentSeries.rows[0]?.custom_cover_path === legacyCoverPath) {
              const migratedPath = await migrateLegacySeriesCover(seriesPath, legacyCoverPath, async (coverPath) => {
                const updated = await coverClient.query(
                  "UPDATE series SET cover_image_path = $2, custom_cover_path = NULL, updated_at = now() WHERE id = $1 AND custom_cover_path = $3",
                  [seriesId, coverPath, legacyCoverPath],
                );
                if (!updated.rowCount) throw new Error("The legacy cover reference changed during migration.");
                await coverClient.query("COMMIT");
              });
              if (migratedPath) seriesCoverImages.set(seriesPath, migratedPath);
              else await coverClient.query("COMMIT");
            } else {
              await coverClient.query("COMMIT");
            }
          } catch (error) {
            await coverClient.query("ROLLBACK").catch(() => undefined);
            throw error;
          } finally {
            coverClient.release();
          }
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      scannedSeriesPaths.add(seriesPath);
    } catch (error) {
      errors.push(`${path.relative(root, archivePath)}: ${error instanceof Error ? error.message : "Unable to read archive."}`);
    }
    const progress = await pool.query<{ cancelRequested: boolean }>(
      `UPDATE scan_jobs SET progress = $2, updated_at = now()
       WHERE id = $1 AND worker_id = $3 AND status = 'running'
       RETURNING cancel_requested AS "cancelRequested"`,
      [jobId, index + 1, workerId],
    );
    if (!progress.rowCount) throw new Error("The scan worker no longer owns this job.");
    scanned = index + 1;
    cancelled = progress.rows[0].cancelRequested;
  }

  const errorSummary = errors.length ? `${errors.length} archive(s) could not be indexed:\n${errors.slice(0, 100).join("\n")}` : null;
  if (!cancelled) {
    const finalState = await pool.query<{ cancelRequested: boolean }>(
      `SELECT cancel_requested AS "cancelRequested"
       FROM scan_jobs WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
      [jobId, workerId],
    );
    if (!finalState.rowCount) throw new Error("The scan worker no longer owns this job.");
    cancelled = finalState.rows[0].cancelRequested;
  }
  if (!cancelled && !errors.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM chapters AS chapter
         USING series
         WHERE chapter.series_id = series.id
           AND series.directory_id = $1
           AND NOT (chapter.source_path = ANY($2::text[]))`,
        [directoryId, archives],
      );
      await client.query(
        `DELETE FROM series
         WHERE directory_id = $1
           AND NOT (source_path = ANY($2::text[]))`,
        [directoryId, [...scannedSeriesPaths]],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.query(
    `UPDATE library_directories SET status = 'active', last_scanned_at = now() WHERE id = $1`,
    [directoryId],
  );
  return { scanned, errors, errorSummary, cancelled };
}
