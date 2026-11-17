import { randomUUID } from "node:crypto";
import { open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "@/server/db";
import { readArchiveImage } from "@/server/archive";
import { apiError, assertSameOrigin, HttpError } from "@/server/http";
import { getBooksRoot, isWithinRoot, resolveBooksFile } from "@/server/filesystem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_COVER_BYTES = 20 * 1024 * 1024;

function imageType(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", contentType: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: ".jpg", contentType: "image/jpeg" };
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) {
    return { extension: ".gif", contentType: "image/gif" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { extension: ".webp", contentType: "image/webp" };
  }
  return null;
}

function coverResponse(bytes: Buffer, contentType: string) {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function removeTemporaryCover(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[cover] could not remove uploaded image", error);
    }
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await context.params);
    const result = await pool.query(
      `SELECT m.custom_cover_path, m.source_path AS series_path,
         CASE WHEN selected_page.archive_entry IS NOT NULL THEN selected_chapter.source_path ELSE fallback.source_path END AS source_path,
         COALESCE(selected_page.archive_entry, fallback.archive_entry) AS archive_entry
       FROM series m
       LEFT JOIN chapters selected_chapter
         ON selected_chapter.id = m.cover_chapter_id AND selected_chapter.series_id = m.id
       LEFT JOIN chapter_pages selected_page
         ON selected_page.chapter_id = selected_chapter.id AND selected_page.page_number = m.cover_page_number
       LEFT JOIN LATERAL (
         SELECT c.source_path, p.archive_entry
         FROM chapters c
         JOIN chapter_pages p ON p.chapter_id = c.id
         WHERE c.series_id = m.id
         ORDER BY c.chapter_number, p.page_number
         LIMIT 1
       ) fallback ON true
       WHERE m.id = $1`,
      [id],
    );
    if (!result.rowCount) throw new HttpError(404, "Title not found.");
    const row = result.rows[0];
    if (row.custom_cover_path) {
      try {
        const coverPath = await resolveBooksFile(row.custom_cover_path as string);
        const seriesPath = await realpath(row.series_path as string);
        if (path.dirname(coverPath) !== seriesPath || !path.basename(coverPath).startsWith(".veylora-cover-")) {
          throw new HttpError(403, "The configured cover image is outside its series directory.");
        }
        const image = await readFile(coverPath);
        const contentType = imageType(image)?.contentType;
        if (!contentType) throw new HttpError(415, "The configured cover image is not a supported image.");
        return coverResponse(image, contentType);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (!row.archive_entry) throw new HttpError(404, "Cover image not found.");
    const image = await readArchiveImage(row.source_path as string, row.archive_entry as string);
    const extension = (row.archive_entry as string).split(".").at(-1)?.toLowerCase();
    const contentType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "avif" ? "image/avif" : extension === "gif" ? "image/gif" : "image/jpeg";
    return coverResponse(image, contentType);
  } catch (error) {
    return apiError(error, "serve series cover");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let uploadedPath: string | undefined;
  let client: PoolClient | undefined;
  let transactionStarted = false;
  let committed = false;
  try {
    assertSameOrigin(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(await context.params);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      throw new HttpError(415, "Upload a cover image using a multipart form.");
    }
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_COVER_BYTES + 1024 * 1024) {
      throw new HttpError(413, "Cover images must be 20 MiB or smaller.");
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "The cover upload form could not be read.");
    }
    if (Array.from(form.keys()).some((key) => key !== "cover") || form.getAll("cover").length !== 1) {
      throw new HttpError(400, "Provide exactly one cover image.");
    }
    const file = form.get("cover");
    if (!(file instanceof File) || !file.size) throw new HttpError(400, "Choose an image file to upload.");
    if (file.size > MAX_COVER_BYTES) throw new HttpError(413, "Cover images must be 20 MiB or smaller.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type) throw new HttpError(415, "Choose a JPEG, PNG, WebP, or GIF image.");

    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const seriesResult = await client.query(
      "SELECT source_path, custom_cover_path FROM series WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!seriesResult.rowCount) throw new HttpError(404, "Title not found.");
    const booksRoot = await getBooksRoot();
    const seriesPath = await realpath(seriesResult.rows[0].source_path as string);
    if (!isWithinRoot(booksRoot, seriesPath)) {
      throw new HttpError(403, "The series directory is outside the configured books directory.");
    }

    uploadedPath = path.join(seriesPath, `.veylora-cover-${randomUUID()}${type.extension}`);
    const handle = await open(/*turbopackIgnore: true*/ uploadedPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    await client.query(
      "UPDATE series SET custom_cover_path = $2, updated_at = now() WHERE id = $1",
      [id, uploadedPath],
    );
    await client.query("COMMIT");
    committed = true;

    const previousPath = seriesResult.rows[0].custom_cover_path;
    if (typeof previousPath === "string"
      && path.dirname(path.resolve(previousPath)) === seriesPath
      && path.basename(previousPath).startsWith(".veylora-cover-")) {
      await removeTemporaryCover(previousPath);
    }
    return Response.json({ coverUrl: `/api/series/${id}/cover` }, { status: 201 });
  } catch (error) {
    if (client && transactionStarted && !committed) {
      await client.query("ROLLBACK");
    }
    if (uploadedPath && !committed) await removeTemporaryCover(uploadedPath);
    return apiError(error, "upload series cover");
  } finally {
    client?.release();
  }
}
