import Busboy from "busboy";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { getAuthenticatedUser } from "@/server/auth";
import { apiError, assertSameOrigin, HttpError } from "@/server/http";
import { getBooksRoot, isWithinRoot } from "@/server/filesystem";
import { pool } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 100;
const MAX_FILE_BYTES = 2 * 1024 ** 3;
const MAX_REQUEST_BYTES = 4 * 1024 ** 3;
const IMAGE_ARCHIVE_EXTENSIONS = new Set([".cbz", ".zip", ".cbr"]);
const optionalAuthorSchema = z.string().trim().max(160).optional();
const optionalDescriptionSchema = z.string().trim().max(5000).optional();
const seriesIdSchema = z.string().uuid();

const seriesTitleSchema = z.string().trim().min(1).max(100).refine(
  (value) => value !== "." && value !== ".." && !value.startsWith(".") && !/[<>:"/\\|?*\u0000-\u001f]/.test(value) && !/[. ]$/.test(value),
  "Use a series name without path separators or filesystem-reserved characters.",
);

async function removeFiles(paths: string[]) {
  await Promise.all(paths.map((filePath) => unlink(filePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[upload] could not remove staged archive", { filePath, error });
    }
  })));
}

async function getStagingDirectory(root: string) {
  const directory = path.join(root, ".veylora-upload-staging");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  const canonical = await realpath(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !isWithinRoot(root, canonical)) {
    throw new HttpError(400, "The upload staging folder must be a real directory inside the configured books folder.");
  }
  return canonical;
}

async function receiveFiles(request: Request, stagingDirectory: string) {
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
      fail(new HttpError(400, "Upload only CBZ, ZIP, or CBR archives."));
      return;
    }

    const stagedName = `${randomUUID()}${extension}`;
    const temporaryPath = path.join(stagingDirectory, stagedName);
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
      stagedName: path.basename(filePath),
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

async function assertUploadDestination(root: string, seriesId: string | undefined, title: string | undefined) {
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
    let canonicalDirectory: string;
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
    return { title: String(selectedSeries.rows[0].title), directory: canonicalDirectory };
  }

  if (!title) throw new HttpError(400, "Enter a name for the new series.");
  const directory = path.join(root, title);
  try {
    const info = await lstat(directory);
    const canonicalDirectory = await realpath(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || !isWithinRoot(root, canonicalDirectory)) {
      throw new HttpError(400, "The series folder must be a real directory inside the configured books folder.");
    }
    return { title, directory: canonicalDirectory };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { title, directory };
  }
}

export async function POST(request: Request) {
  let temporaryPaths: string[] = [];
  let queued = false;
  try {
    assertSameOrigin(request);
    const user = await getAuthenticatedUser(request);
    if (!user) throw new HttpError(401, "Please sign in to continue.");
    const root = await getBooksRoot();
    const stagingDirectory = await getStagingDirectory(root);
    const upload = await receiveFiles(request, stagingDirectory);
    temporaryPaths = upload.files.map(({ stagedName }) => path.join(stagingDirectory, stagedName));

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
    if (!upload.files.length) throw new HttpError(400, "Choose at least one CBZ, ZIP, or CBR archive.");
    if (new Set(numbers).size !== numbers.length) {
      throw new HttpError(400, "Each uploaded archive must have a different chapter number.");
    }

    const destination = await assertUploadDestination(root, seriesId, title);
    const existingNumbers = new Set((await readdir(destination.directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }))
      .filter((entry) => entry.isFile() && IMAGE_ARCHIVE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => entry.name.match(/(?:chapter|ch|vol(?:ume)?)[ ._-]*(\d+)/i)?.[1])
      .filter((number): number is string => Boolean(number))
      .map(Number));
    for (const number of numbers) {
      if (existingNumbers.has(number)) {
        throw new HttpError(409, `Chapter ${number} already exists in "${destination.title}".`);
      }
    }

    const jobId = randomUUID();
    const payload = {
      ...(seriesId ? { seriesId } : { seriesTitle: title }),
      ...(authorName ? { authorName } : {}),
      ...(description !== undefined ? { description } : {}),
      genreNames,
      chapters: upload.files.map((file, index) => ({
        stagedName: file.stagedName,
        extension: file.extension,
        chapterNumber: numbers[index],
      })),
    };
    const job = await pool.query<{ id: string }>(
      `INSERT INTO upload_jobs(id, user_id, status, progress, total, payload)
       VALUES ($1, $2, 'queued', 0, $3, $4::jsonb)
       RETURNING id`,
      [jobId, user.id, upload.files.length, JSON.stringify(payload)],
    );
    queued = true;
    return Response.json({ id: job.rows[0].id, status: "queued" }, { status: 202 });
  } catch (error) {
    if (!queued) await removeFiles(temporaryPaths);
    return apiError(error, "queue library archive upload");
  }
}
