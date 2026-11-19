import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, mkdir, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  hasArchivePromotionMarker,
  isArchivePromotionComplete,
  promoteStagedArchive,
  removeArchivePromotionMarker,
  removePromotedArchive,
} from "./archive-promotion";
import { listArchiveImages } from "./archive";
import { pool } from "./db";
import { findSeriesCoverImage, getBooksRoot, isWithinRoot } from "./filesystem";
import { metadataSlug } from "./metadata";

const POLL_INTERVAL_MS = 1_500;
const HEARTBEAT_INTERVAL_MS = 30_000;
const LEASE_INTERVAL_MS = 5 * 60_000;
const IMAGE_ARCHIVE_EXTENSIONS = new Set([".cbz", ".zip", ".cbr"]);

const uploadPayloadSchema = z.object({
  seriesId: z.string().uuid().optional(),
  seriesTitle: z.string().trim().min(1).max(100).optional(),
  authorName: z.string().max(160).optional(),
  description: z.string().max(5000).optional(),
  genreNames: z.array(z.string().min(1).max(64)).max(20),
  chapters: z.array(z.object({
    stagedName: z.string().regex(/^[0-9a-f-]{36}\.(cbz|zip|cbr)$/i),
    chapterNumber: z.number().int().min(1).max(2_147_483_647),
    extension: z.enum([".cbz", ".zip", ".cbr"]),
  })).min(1).max(100),
}).refine((payload) => Boolean(payload.seriesId) !== Boolean(payload.seriesTitle))
  .refine((payload) => new Set(payload.chapters.map(({ chapterNumber }) => chapterNumber)).size === payload.chapters.length);

type UploadPayload = z.infer<typeof uploadPayloadSchema>;
type ClaimedUploadJob = {
  id: string;
  user_id: string;
  payload: unknown;
};

const globalForWorker = globalThis as typeof globalThis & { veyloraUploadWorkerStarted?: boolean };

class UploadCancelled extends Error {}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

async function claimNextUploadJob(workerId: string): Promise<ClaimedUploadJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE upload_jobs
       SET status = 'failed', error = COALESCE(error, 'The upload worker stopped before this job could be recovered.'),
           worker_id = NULL, locked_at = NULL, completed_at = now(), updated_at = now()
       WHERE status = 'running' AND cancel_requested = false
         AND (locked_at IS NULL OR locked_at < now() - ($1 * interval '1 millisecond'))
         AND attempts >= max_attempts`,
      [LEASE_INTERVAL_MS],
    );
    const result = await client.query<ClaimedUploadJob>(
      `WITH next_job AS (
         SELECT id
         FROM upload_jobs
         WHERE (cancel_requested = true OR attempts < max_attempts)
           AND (
             (status = 'queued' AND available_at <= now())
             OR (status = 'running' AND (locked_at IS NULL OR locked_at < now() - ($2 * interval '1 millisecond')))
           )
         ORDER BY CASE WHEN cancel_requested THEN 0 WHEN status = 'queued' THEN 1 ELSE 2 END,
                  available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE upload_jobs AS job
       SET status = 'running', worker_id = $1, locked_at = now(),
           attempts = job.attempts + 1, started_at = COALESCE(job.started_at, now()),
           error = NULL, updated_at = now()
       FROM next_job
       WHERE job.id = next_job.id
       RETURNING job.id, job.user_id, job.payload`,
      [workerId, LEASE_INTERVAL_MS],
    );
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function uploadPaths(root: string, payload: UploadPayload) {
  const stagingDirectory = path.join(root, ".veylora-upload-staging");
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
  const stagingInfo = await lstat(stagingDirectory);
  const canonicalStagingDirectory = await realpath(stagingDirectory);
  if (!stagingInfo.isDirectory() || stagingInfo.isSymbolicLink() || !isWithinRoot(root, canonicalStagingDirectory)) {
    throw new Error("The upload staging folder must be a real directory inside the configured books folder.");
  }

  let directory: string;
  let seriesTitle = payload.seriesTitle;
  if (payload.seriesId) {
    const selected = await pool.query(
      "SELECT id, title, source_path FROM series WHERE id = $1",
      [payload.seriesId],
    );
    if (!selected.rows[0]) throw new Error("The selected series was not found.");
    const sourcePath = selected.rows[0].source_path;
    if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) {
      throw new Error("The selected series is not linked to a local archive folder.");
    }
    const info = await lstat(sourcePath);
    directory = await realpath(sourcePath);
    if (!info.isDirectory() || info.isSymbolicLink() || !isWithinRoot(root, directory)) {
      throw new Error("The selected series folder must be inside the configured books folder.");
    }
    seriesTitle = String(selected.rows[0].title);
  } else {
    const requestedDirectory = path.join(root, seriesTitle!);
    await mkdir(requestedDirectory, { recursive: true, mode: 0o700 });
    const info = await lstat(requestedDirectory);
    directory = await realpath(requestedDirectory);
    if (!info.isDirectory() || info.isSymbolicLink() || !isWithinRoot(root, directory)) {
      throw new Error("The series folder must be a real directory inside the configured books folder.");
    }
  }

  return {
    stagingDirectory: canonicalStagingDirectory,
    directory,
    seriesTitle: seriesTitle!,
  };
}

async function removeStagedFiles(stagingDirectory: string, payload: UploadPayload) {
  await Promise.all(payload.chapters.map(async ({ stagedName }) => {
    for (const remove of [
      () => unlink(path.join(stagingDirectory, stagedName)),
      () => removeArchivePromotionMarker(stagingDirectory, stagedName),
    ]) {
      try {
        await remove();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("[upload] could not remove staged archive data", { stagedName, error });
        }
      }
    }
  }));
}

async function removePromotedFiles(
  stagingDirectory: string,
  directory: string,
  payload: UploadPayload,
) {
  for (const chapter of payload.chapters) {
    const targetPath = path.join(directory, `Chapter ${String(chapter.chapterNumber).padStart(3, "0")}${chapter.extension}`);
    try {
      await removePromotedArchive(stagingDirectory, chapter.stagedName, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[upload] could not remove a cancelled archive", { targetPath, error });
      }
    }
  }
}

async function queueScanWithinTransaction(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(734210, 1)");
  const activeJob = await client.query(
    "SELECT id FROM scan_jobs WHERE status IN ('queued', 'running') LIMIT 1",
  );
  if (!activeJob.rowCount) {
    await client.query("INSERT INTO scan_jobs(status) VALUES ('queued')");
  }
  await client.query(
    `DELETE FROM scan_jobs
     WHERE status NOT IN ('queued', 'running')
       AND id NOT IN (SELECT id FROM scan_jobs ORDER BY created_at DESC LIMIT 20)`,
  );
}

async function cancellationRequested(jobId: string, workerId: string) {
  const result = await pool.query<{ cancel_requested: boolean }>(
    "SELECT cancel_requested FROM upload_jobs WHERE id = $1 AND worker_id = $2 AND status = 'running'",
    [jobId, workerId],
  );
  return result.rows[0]?.cancel_requested ?? true;
}

async function updateProgress(jobId: string, workerId: string, progress: number, total: number) {
  await pool.query(
    `UPDATE upload_jobs SET progress = $3, total = $4, locked_at = now(), updated_at = now()
     WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
    [jobId, workerId, progress, total],
  );
}

async function validateArchives(paths: string[], jobId: string, workerId: string) {
  for (let index = 0; index < paths.length; index += 1) {
    if (await cancellationRequested(jobId, workerId)) throw new UploadCancelled();
    const images = await listArchiveImages(paths[index]);
    if (!images.length) throw new Error(`Archive ${index + 1} contains no supported page images.`);
    await updateProgress(jobId, workerId, index + 1, paths.length);
  }
}

async function promoteArchives(
  stagingDirectory: string,
  directory: string,
  payload: UploadPayload,
  jobId: string,
  workerId: string,
) {
  const existing = new Set((await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && IMAGE_ARCHIVE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name.match(/(?:chapter|ch|vol(?:ume)?)[ ._-]*(\d+)/i)?.[1])
    .filter((number): number is string => Boolean(number))
    .map(Number));
  const seriesRecord = payload.seriesId
    ? { id: payload.seriesId }
    : (await pool.query<{ id: string }>("SELECT id FROM series WHERE source_path = $1", [directory])).rows[0];
  const chapterSources = new Map<number, string>();
  if (seriesRecord) {
    const storedChapters = await pool.query<{ chapter_number: number; source_path: string }>(
      "SELECT chapter_number, source_path FROM chapters WHERE series_id = $1",
      [seriesRecord.id],
    );
    for (const chapter of storedChapters.rows) chapterSources.set(chapter.chapter_number, chapter.source_path);
  }
  for (const [index, chapter] of payload.chapters.entries()) {
    if (await cancellationRequested(jobId, workerId)) throw new UploadCancelled();
    const targetPath = path.join(directory, `Chapter ${String(chapter.chapterNumber).padStart(3, "0")}${chapter.extension}`);
    const storedSource = chapterSources.get(chapter.chapterNumber);
    if (storedSource && storedSource !== targetPath) {
      throw new Error(`Chapter ${chapter.chapterNumber} already exists in "${path.basename(directory)}".`);
    }
    if (existing.has(chapter.chapterNumber)) {
      if (!await isArchivePromotionComplete(stagingDirectory, chapter.stagedName, targetPath)) {
        throw new Error(`Chapter ${chapter.chapterNumber} already exists in "${path.basename(directory)}".`);
      }
    } else {
      await promoteStagedArchive(stagingDirectory, chapter.stagedName, targetPath);
    }
    existing.add(chapter.chapterNumber);
    await updateProgress(jobId, workerId, index + 1, payload.chapters.length);
  }
}

async function saveSeriesMetadata(
  client: PoolClient,
  payload: UploadPayload,
  directory: string,
  root: string,
) {
  const libraryDirectory = await client.query(
    `INSERT INTO library_directories(path, status)
     VALUES ($1, 'active')
     ON CONFLICT(path) DO UPDATE SET status = 'active'
     RETURNING id`,
    [root],
  );
  const coverImagePath = await findSeriesCoverImage(directory);
  let seriesId = payload.seriesId;

  if (seriesId) {
    const target = await client.query("SELECT id FROM series WHERE id = $1 FOR UPDATE", [seriesId]);
    if (!target.rows[0]) throw new Error("The selected series was removed before the upload completed.");
    if (coverImagePath) {
      await client.query(
        "UPDATE series SET cover_image_path = $2, updated_at = now() WHERE id = $1",
        [seriesId, coverImagePath],
      );
    }
  } else {
    const firstChapter = payload.chapters[0];
    const firstArchive = path.join(directory, `Chapter ${String(firstChapter.chapterNumber).padStart(3, "0")}${firstChapter.extension}`);
    const series = await client.query(
      `INSERT INTO series(title, description, source_path, directory_id, cover_path, cover_image_path)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(source_path) DO UPDATE SET
         title = COALESCE(series.title_override, EXCLUDED.title),
         description = CASE WHEN $7::boolean THEN EXCLUDED.description ELSE series.description END,
         directory_id = EXCLUDED.directory_id,
         cover_path = COALESCE(series.cover_path, EXCLUDED.cover_path),
         cover_image_path = COALESCE(EXCLUDED.cover_image_path, series.cover_image_path),
         updated_at = now()
       RETURNING id`,
      [
        payload.seriesTitle,
        payload.description ?? "",
        directory,
        libraryDirectory.rows[0].id,
        firstArchive,
        coverImagePath,
        Boolean(payload.description),
      ],
    );
    seriesId = series.rows[0].id;

    if (payload.authorName) {
      const author = await client.query(
        `INSERT INTO authors(name, slug)
         VALUES ($1, $2)
         ON CONFLICT(slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [payload.authorName, metadataSlug(payload.authorName)],
      );
      await client.query(
        "INSERT INTO series_authors(series_id, author_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [seriesId, author.rows[0].id],
      );
    }

    for (const genreName of payload.genreNames) {
      const genre = await client.query(
        `INSERT INTO genres(name, slug)
         VALUES ($1, $2)
         ON CONFLICT(slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [genreName, metadataSlug(genreName)],
      );
      await client.query(
        "INSERT INTO series_genres(series_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [seriesId, genre.rows[0].id],
      );
    }
  }

  const title = payload.seriesTitle
    ?? (await client.query<{ title: string }>("SELECT title FROM series WHERE id = $1", [seriesId])).rows[0]?.title;
  if (!title) throw new Error("The uploaded series could not be found after metadata was saved.");
  return { seriesId, seriesTitle: title };
}

async function processUpload(job: ClaimedUploadJob, workerId: string) {
  const payload = uploadPayloadSchema.parse(job.payload);
  const root = await getBooksRoot();
  const stagingDirectory = await realpath(path.join(root, ".veylora-upload-staging"));
  if (!isWithinRoot(root, stagingDirectory)) throw new Error("The upload staging folder is outside the configured books folder.");
  if (await cancellationRequested(job.id, workerId)) {
    const stagedNames = payload.chapters.map(({ stagedName }) => stagedName);
    if (await hasArchivePromotionMarker(stagingDirectory, stagedNames)) {
      const { directory } = await uploadPaths(root, payload);
      await removePromotedFiles(stagingDirectory, directory, payload);
    }
    await removeStagedFiles(stagingDirectory, payload);
    await pool.query(
      `UPDATE upload_jobs
       SET status = 'cancelled', error = NULL, worker_id = NULL, locked_at = NULL,
           cancel_requested = false, completed_at = now(), updated_at = now()
       WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
      [job.id, workerId],
    );
    return;
  }
  const { directory } = await uploadPaths(root, payload);
  const stagedPaths = payload.chapters.map(({ stagedName }) => path.join(stagingDirectory, stagedName));

  try {
    if (await cancellationRequested(job.id, workerId)) throw new UploadCancelled();
    await validateArchives(stagedPaths, job.id, workerId);
    await promoteArchives(stagingDirectory, directory, payload, job.id, workerId);

    const client = await pool.connect();
    let completed = false;
    try {
      await client.query("BEGIN");
      const jobState = await client.query<{ cancel_requested: boolean }>(
        `SELECT cancel_requested FROM upload_jobs
         WHERE id = $1 AND worker_id = $2 AND status = 'running'
         FOR UPDATE`,
        [job.id, workerId],
      );
      if (!jobState.rows[0] || jobState.rows[0].cancel_requested) throw new UploadCancelled();

      const result = await saveSeriesMetadata(client, payload, directory, root);
        await queueScanWithinTransaction(client);
      await client.query(
        `UPDATE upload_jobs
         SET status = 'completed', progress = total, error = NULL, worker_id = NULL, locked_at = NULL,
             cancel_requested = false, completed_at = now(), updated_at = now()
         WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
        [job.id, workerId],
      );
      await client.query("COMMIT");
      completed = true;
      console.info("[upload] archive upload job completed", { jobId: job.id, userId: job.user_id, seriesId: result.seriesId });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (completed) await removeStagedFiles(stagingDirectory, payload);
  } catch (error) {
    if (error instanceof UploadCancelled) {
      await removePromotedFiles(stagingDirectory, directory, payload);
      await removeStagedFiles(stagingDirectory, payload);
      await pool.query(
        `UPDATE upload_jobs
         SET status = 'cancelled', error = NULL, worker_id = NULL, locked_at = NULL,
             cancel_requested = false, completed_at = now(), updated_at = now()
         WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
        [job.id, workerId],
      );
      return;
    }
    await removePromotedFiles(stagingDirectory, directory, payload);
    throw error;
  }
}

async function failUploadJob(job: ClaimedUploadJob, workerId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : "Unable to process the uploaded archives.").slice(0, 10_000);
  await pool.query(
    `UPDATE upload_jobs
     SET status = CASE
           WHEN cancel_requested THEN 'queued'
           WHEN attempts >= max_attempts THEN 'failed'
           ELSE 'queued'
         END,
         available_at = CASE WHEN cancel_requested OR attempts >= max_attempts
           THEN available_at
           ELSE now() + (LEAST(60, 5 * power(2, GREATEST(attempts - 1, 0)))::text || ' seconds')::interval
         END,
         error = CASE WHEN cancel_requested THEN NULL ELSE $2 END,
         worker_id = NULL, locked_at = NULL,
         completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
         updated_at = now()
     WHERE id = $1 AND worker_id = $3 AND status = 'running'`,
    [job.id, message, workerId],
  );
}

async function runClaimedJob(job: ClaimedUploadJob, workerId: string) {
  const heartbeat = setInterval(() => {
    void pool.query(
      `UPDATE upload_jobs SET locked_at = now(), updated_at = now()
       WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
      [job.id, workerId],
    ).catch((error: unknown) => console.error("[upload] could not renew upload job lease", { jobId: job.id, error }));
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  try {
    await processUpload(job, workerId);
  } catch (error) {
    console.error("[upload] upload job attempt failed", { jobId: job.id, error });
    await failUploadJob(job, workerId, error);
  } finally {
    clearInterval(heartbeat);
  }
}

async function workerLoop(workerId: string) {
  while (true) {
    try {
      const job = await claimNextUploadJob(workerId);
      if (job) {
        await runClaimedJob(job, workerId);
        continue;
      }
    } catch (error) {
      console.error("[upload] upload worker could not claim a job", error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function startLibraryUploadWorker() {
  if (globalForWorker.veyloraUploadWorkerStarted) return;
  globalForWorker.veyloraUploadWorkerStarted = true;
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  void workerLoop(workerId);
  console.info("[upload] durable upload worker started", { workerId });
}

export function isLibraryUploadWorkerStarted() {
  return globalForWorker.veyloraUploadWorkerStarted === true;
}
