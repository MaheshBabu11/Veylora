import Busboy from "busboy";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { assertSameOrigin, apiError, HttpError } from "@/server/http";
import { getBooksRoot, isWithinRoot } from "@/server/filesystem";
import { listArchiveImages } from "@/server/archive";
import { pool } from "@/server/db";
import { metadataSlug } from "@/server/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 100;
const MAX_FILE_BYTES = 2 * 1024 ** 3;
const MAX_REQUEST_BYTES = 4 * 1024 ** 3;
const IMAGE_ARCHIVE_EXTENSIONS = new Set([".cbz", ".zip"]);
const optionalAuthorSchema = z.string().trim().max(160).optional();
const optionalDescriptionSchema = z.string().trim().max(5000).optional();
const seriesIdSchema = z.string().uuid();

const seriesTitleSchema = z.string().trim().min(1).max(100).refine(
  (value) => value !== "." && value !== ".." && !value.startsWith(".") && !/[<>:"/\\|?*\u0000-\u001f]/.test(value) && !/[. ]$/.test(value),
  "Use a series name without path separators or filesystem-reserved characters.",
);

async function removeFiles(paths: string[]) {
  for (const filePath of paths) {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[upload] could not remove temporary file", error);
      }
    }
  }
}

async function receiveFiles(request: Request, root: string) {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(415, "Use a multipart form to upload archive files.");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "The total upload exceeds the 4 GiB request limit.");
  }
  if (!request.body) throw new HttpError(400, "The upload request has no body.");

  const parser = Busboy({
    headers: { "content-type": contentType },
    limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: MAX_FILES + 4, fieldSize: 5_000, parts: MAX_FILES * 2 + 4 },
  });
  const temporaryPaths: string[] = [];
  const fileStreams: Promise<void>[] = [];
  const chapterNumbers: string[] = [];
  const fields: Record<string, string> = {};
  const seenFields = new Set<string>();
  let totalBytes = 0;
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure ??= error;
  };

  parser.on("field", (name, value, info) => {
    if (info.nameTruncated || info.valueTruncated) {
      fail(new HttpError(400, "An upload form field is too long."));
    } else if (name === "chapterNumbers") {
      chapterNumbers.push(value);
    } else if (["seriesTitle", "seriesId", "authorName", "description", "genres"].includes(name) && !seenFields.has(name)) {
      seenFields.add(name);
      fields[name] = value;
    } else {
      fail(new HttpError(400, "The upload form contains an unexpected or duplicate field."));
    }
  });

  parser.on("file", (name, stream, info) => {
    const extension = path.extname(info.filename ?? "").toLowerCase();
    if (name !== "files" || !IMAGE_ARCHIVE_EXTENSIONS.has(extension)) {
      stream.resume();
      fail(new HttpError(400, "Upload only CBZ or ZIP archives."));
      return;
    }

    const temporaryPath = path.join(root, `.veylora-upload-${randomUUID()}${extension}`);
    temporaryPaths.push(temporaryPath);
    stream.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BYTES) {
        const error = new HttpError(413, "The total upload exceeds the 4 GiB request limit.");
        fail(error);
        parser.destroy(error);
      }
    });
    stream.on("limit", () => fail(new HttpError(413, "An archive exceeds the 2 GiB per-file limit.")));
    const writePromise = pipeline(stream, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
    writePromise.catch((error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error("Could not write an uploaded archive.");
      fail(normalizedError);
      if (!parser.destroyed) parser.destroy(normalizedError);
    });
    fileStreams.push(writePromise);
  });

  parser.on("filesLimit", () => fail(new HttpError(413, `Upload at most ${MAX_FILES} archives at a time.`)));
  parser.on("fieldsLimit", () => fail(new HttpError(400, "The upload form has too many fields.")));
  parser.on("partsLimit", () => fail(new HttpError(400, "The upload form has too many parts.")));

  try {
    const requestStream = Readable.from((async function* () {
      const reader = request.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    })());
    await pipeline(requestStream, parser);
    const results = await Promise.allSettled(fileStreams);
    const streamFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (streamFailure) throw streamFailure.reason;
    if (failure) throw failure;
    const files = temporaryPaths.map((filePath) => ({
      path: filePath,
      extension: path.extname(filePath).toLowerCase(),
    }));
    return { files, chapterNumbers, fields };
  } catch (error) {
    await Promise.allSettled(fileStreams);
    await removeFiles(temporaryPaths);
    if (failure) throw failure;
    throw error;
  }
}

export async function POST(request: Request) {
  const temporaryPaths: string[] = [];
  const createdPaths: string[] = [];
  try {
    assertSameOrigin(request);
    const root = await getBooksRoot();
    const upload = await receiveFiles(request, root);
    temporaryPaths.push(...upload.files.map((file) => file.path));

    const seriesId = upload.fields.seriesId ? seriesIdSchema.parse(upload.fields.seriesId) : undefined;
    if (!seriesId && upload.fields.seriesId) throw new HttpError(400, "The selected series is invalid.");
    if (!seriesId && !upload.fields.seriesTitle) throw new HttpError(400, "Choose an existing series or enter a name for a new one.");
    const title = seriesId ? undefined : seriesTitleSchema.parse(upload.fields.seriesTitle);
    const authorName = optionalAuthorSchema.parse(upload.fields.authorName) || undefined;
    const description = optionalDescriptionSchema.parse(upload.fields.description) || undefined;
    const genreNames = [...new Set((upload.fields.genres ?? "").split(",").map((genre) => genre.trim()).filter(Boolean))];
    if (seriesId && (authorName || description || genreNames.length > 0)) {
      throw new HttpError(400, "Series details can only be provided when creating a new series.");
    }
    if (genreNames.length > 20 || genreNames.some((genre) => genre.length > 64)) {
      throw new HttpError(400, "Enter at most 20 genres, each no longer than 64 characters.");
    }
    const numbers = z.array(z.coerce.number().int().min(1).max(2_147_483_647))
      .length(upload.files.length)
      .parse(upload.chapterNumbers);
    if (!upload.files.length) throw new HttpError(400, "Choose at least one CBZ or ZIP archive.");
    if (new Set(numbers).size !== numbers.length) {
      throw new HttpError(400, "Each uploaded archive must have a different chapter number.");
    }

    for (let index = 0; index < upload.files.length; index += 1) {
      try {
        const pages = await listArchiveImages(upload.files[index].path);
        if (!pages.length) throw new Error("No supported page images.");
      } catch {
        throw new HttpError(400, `Archive ${index + 1} is invalid or contains no supported page images.`);
      }
    }

    let targetTitle: string;
    let canonicalDirectory: string;
    let existingSeriesId: string | undefined;
    if (seriesId) {
      const selectedSeries = await pool.query(
        "SELECT id, title, source_path FROM series WHERE id = $1",
        [seriesId],
      );
      if (!selectedSeries.rows[0]) throw new HttpError(404, "The selected series was not found.");
      const sourcePath = selectedSeries.rows[0].source_path;
      if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) {
        throw new HttpError(409, "The selected series is not linked to a local archive folder.");
      }
      let directoryInfo;
      try {
        directoryInfo = await lstat(sourcePath);
        canonicalDirectory = await realpath(sourcePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new HttpError(409, "The selected series folder no longer exists in the configured books folder.");
        }
        throw error;
      }
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !isWithinRoot(root, canonicalDirectory)) {
        throw new HttpError(400, "The selected series folder must be inside the configured books folder.");
      }
      targetTitle = String(selectedSeries.rows[0].title);
      existingSeriesId = String(selectedSeries.rows[0].id);
    } else {
      if (!title) throw new HttpError(400, "Enter a name for the new series.");
      targetTitle = title;
      const requestedSeriesDirectory = path.join(root, targetTitle);
      await mkdir(requestedSeriesDirectory, { recursive: true, mode: 0o700 });
      const directoryInfo = await lstat(requestedSeriesDirectory);
      canonicalDirectory = await realpath(requestedSeriesDirectory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !isWithinRoot(root, canonicalDirectory)) {
        throw new HttpError(400, "The series folder must be a real directory inside the configured books folder.");
      }
    }

    const existingNumbers = new Set((await readdir(canonicalDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && IMAGE_ARCHIVE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => entry.name.match(/(?:chapter|ch|vol(?:ume)?)[ ._-]*(\d+)/i)?.[1])
      .filter((number): number is string => Boolean(number))
      .map(Number));

    for (let index = 0; index < upload.files.length; index += 1) {
      const { path: temporaryPath, extension } = upload.files[index];
      const chapterNumber = numbers[index];
      if (existingNumbers.has(chapterNumber)) {
        throw new HttpError(409, `Chapter ${chapterNumber} already exists in "${targetTitle}".`);
      }
      const target = path.join(canonicalDirectory, `Chapter ${String(chapterNumber).padStart(3, "0")}${extension}`);
      let destination: Awaited<ReturnType<typeof open>>;
      try {
        destination = await open(target, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new HttpError(409, `Chapter ${chapterNumber} already exists in "${targetTitle}".`);
        }
        throw error;
      }
      createdPaths.push(target);
      await pipeline(createReadStream(temporaryPath), destination.createWriteStream());
      existingNumbers.add(chapterNumber);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const directory = await client.query(
        `INSERT INTO library_directories(path, status)
         VALUES ($1, 'active')
         ON CONFLICT(path) DO UPDATE SET status = 'active'
         RETURNING id`,
        [root],
      );
      if (existingSeriesId) {
         const target = await client.query(
           "SELECT id FROM series WHERE id = $1 FOR UPDATE",
           [existingSeriesId],
         );
         if (!target.rows[0]) throw new HttpError(404, "The selected series was removed before the upload completed.");
      } else {
         const series = await client.query(
           `INSERT INTO series(title, description, source_path, directory_id, cover_path)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT(source_path) DO UPDATE SET
              title = COALESCE(series.title_override, EXCLUDED.title),
              description = CASE WHEN $6::boolean THEN EXCLUDED.description ELSE series.description END,
              directory_id = EXCLUDED.directory_id,
              cover_path = COALESCE(series.cover_path, EXCLUDED.cover_path),
              updated_at = now()
            RETURNING id`,
           [title, description ?? "", canonicalDirectory, directory.rows[0].id, createdPaths[0], Boolean(description)],
         );
         const seriesId: string = series.rows[0].id;

         if (authorName) {
           const author = await client.query(
             `INSERT INTO authors(name, slug)
              VALUES ($1, $2)
              ON CONFLICT(slug) DO UPDATE SET name = EXCLUDED.name
              RETURNING id`,
             [authorName, metadataSlug(authorName)],
           );
           await client.query(
             "INSERT INTO series_authors(series_id, author_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
             [seriesId, author.rows[0].id],
           );
         }

         for (const genreName of genreNames) {
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
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return Response.json({
      seriesTitle: targetTitle,
      uploaded: createdPaths.map((filePath, index) => ({
        chapterNumber: numbers[index],
        fileName: path.basename(filePath),
      })),
    }, { status: 201 });
  } catch (error) {
    await removeFiles(createdPaths);
    return apiError(error, "upload library archives");
  } finally {
    await removeFiles(temporaryPaths);
  }
}
