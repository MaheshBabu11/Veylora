import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as getSession } from "@/app/api/auth/session/route";
import { GET as listCollections, POST as createCollection } from "@/app/api/collections/route";
import { POST as queueScan, GET as getScan } from "@/app/api/library/scan/route";
import { POST as queueUpload } from "@/app/api/library/upload/route";
import { GET as getUpload } from "@/app/api/library/uploads/[id]/route";
import { POST as cancelUpload } from "@/app/api/library/uploads/[id]/cancel/route";
import { GET as getProgress, POST as saveProgress } from "@/app/api/reading-progress/route";
import { GET as listSeries } from "@/app/api/series/route";

const { Pool } = pg;
const database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const userAgentHeaders = { "x-veylora-user-id": "", "x-veylora-username": "" };

function jsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("authenticated library workflows", () => {
  let userId = "";
  let username = "";
  let cookie = "";
  let seriesId = "";
  let chapterId = "";
  let seriesDirectory = "";
  let longestSeriesId = "";
  let searchableSeriesId = "";

  beforeAll(async () => {
    username = `test-${randomUUID().slice(0, 8)}`;
    const registration = await register(jsonRequest("/api/auth/register", "POST", {
      username,
      password: "integration-password",
    }));
    expect(registration.status).toBe(201);
    const user = await registration.json() as { id: string; username: string };
    userId = user.id;
    cookie = registration.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toMatch(/^veylora_session=/);

    seriesDirectory = path.join(process.env.VEYLORA_BOOKS_DIR!, "Test Series");
    await mkdir(seriesDirectory, { recursive: true });
    const series = await database.query<{ id: string }>(
      "INSERT INTO series(title, source_path) VALUES ($1, $2) RETURNING id",
      ["Test Series", seriesDirectory],
    );
    seriesId = series.rows[0].id;
    const chapter = await database.query<{ id: string }>(
      "INSERT INTO chapters(series_id, chapter_number, title, source_path, page_count) VALUES ($1, 1, 'Chapter 1', $2, 5) RETURNING id",
      [seriesId, path.join(seriesDirectory, "Chapter 1.cbz")],
    );
    chapterId = chapter.rows[0].id;

    const alpha = await database.query<{ id: string }>(
      "INSERT INTO series(title, source_path) VALUES ('Alpha Integration', $1) RETURNING id",
      [path.join(process.env.VEYLORA_BOOKS_DIR!, "Alpha Integration")],
    );
    searchableSeriesId = alpha.rows[0].id;
    const longest = await database.query<{ id: string }>(
      "INSERT INTO series(title, source_path) VALUES ('Zulu Integration', $1) RETURNING id",
      [path.join(process.env.VEYLORA_BOOKS_DIR!, "Zulu Integration")],
    );
    longestSeriesId = longest.rows[0].id;
    await database.query(
      "INSERT INTO chapters(series_id, chapter_number, title, source_path, page_count) VALUES ($1, 1, 'Alpha chapter', $2, 1)",
      [alpha.rows[0].id, path.join(process.env.VEYLORA_BOOKS_DIR!, "Alpha.cbz")],
    );
    for (const chapterNumber of [1, 2, 3]) {
      await database.query(
        "INSERT INTO chapters(series_id, chapter_number, title, source_path, page_count) VALUES ($1, $2, $3, $4, 1)",
        [longestSeriesId, chapterNumber, `Zulu chapter ${chapterNumber}`, path.join(process.env.VEYLORA_BOOKS_DIR!, `Zulu-${chapterNumber}.cbz`)],
      );
    }
    const author = await database.query<{ id: string }>(
      "INSERT INTO authors(name, slug) VALUES ('Integration Author', 'integration-author') RETURNING id",
    );
    await database.query("INSERT INTO series_authors(series_id, author_id) VALUES ($1, $2)", [searchableSeriesId, author.rows[0].id]);
    const genre = await database.query<{ id: string }>(
      "INSERT INTO genres(name, slug) VALUES ('Integration Genre', 'integration-genre') RETURNING id",
    );
    await database.query("INSERT INTO series_genres(series_id, genre_id) VALUES ($1, $2)", [searchableSeriesId, genre.rows[0].id]);
  });

  it("registers, signs in, and resolves a session", async () => {
    const loginResponse = await login(jsonRequest("/api/auth/login", "POST", {
      username,
      password: "integration-password",
    }));
    expect(loginResponse.status).toBe(200);
    cookie = loginResponse.headers.get("set-cookie")?.split(";")[0] ?? cookie;

    const session = await getSession(new Request("http://localhost/api/auth/session", {
      headers: { cookie },
    }));
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({ id: userId, username });
  });

  it("creates and lists a user-owned collection", async () => {
    const headers = { ...userAgentHeaders, "x-veylora-user-id": userId, "x-veylora-username": username };
    const created = await createCollection(jsonRequest("/api/collections", "POST", {
      name: "Integration Collection",
      description: "Created by the integration workflow.",
      seriesIds: [seriesId],
    }, headers));
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      name: "Integration Collection",
      series_ids: [seriesId],
    });

    const listed = await listCollections(new Request("http://localhost/api/collections", { headers }));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Integration Collection", series_ids: [seriesId] }),
    ]));
  });

  it("saves reading progress and returns it for the same user", async () => {
    const headers = { ...userAgentHeaders, "x-veylora-user-id": userId, "x-veylora-username": username };
    const saved = await saveProgress(jsonRequest("/api/reading-progress", "POST", {
      chapterId,
      page: 3,
    }, headers));
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ seriesId, chapterId, page: 3 });

    const progress = await getProgress(new Request("http://localhost/api/reading-progress", { headers }));
    expect(progress.status).toBe(200);
    await expect(progress.json()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ series_id: seriesId, last_chapter_id: chapterId, last_page: 3 }),
    ]));
  });

  it("deduplicates active scans and returns their persisted status", async () => {
    const first = await queueScan(jsonRequest("/api/library/scan", "POST", {}));
    const second = await queueScan(jsonRequest("/api/library/scan", "POST", {}));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstJob = await first.json() as { id: string; status: string };
    const secondJob = await second.json() as { id: string; status: string };
    expect(secondJob).toEqual(firstJob);
    expect(firstJob.status).toBe("queued");

    const active = await getScan();
    await expect(active.json()).resolves.toMatchObject({ id: firstJob.id, status: "queued" });
  });

  it("paginates without a total-result cap and sorts across the full filtered result set", async () => {
    const headers = { "x-veylora-user-id": userId, "x-veylora-username": username };
    const firstPage = await listSeries(new Request("http://localhost/api/series?sort=title&limit=1&offset=0", { headers }));
    const secondPage = await listSeries(new Request("http://localhost/api/series?sort=title&limit=1&offset=1", { headers }));
    const first = await firstPage.json() as { items: Array<{ id: string; title: string }>; total: number; offset: number };
    const second = await secondPage.json() as { items: Array<{ id: string; title: string }>; total: number; offset: number };
    expect(first.total).toBe(3);
    expect(first.offset).toBe(0);
    expect(second.offset).toBe(1);
    expect(first.items[0].title).toBe("Alpha Integration");
    expect(second.items[0].title).toBe("Test Series");

    const byChapters = await listSeries(new Request("http://localhost/api/series?sort=chapters&limit=1", { headers }));
    await expect(byChapters.json()).resolves.toMatchObject({ items: [expect.objectContaining({ id: longestSeriesId })] });
    const byProgress = await listSeries(new Request("http://localhost/api/series?sort=progress&limit=1", { headers }));
    await expect(byProgress.json()).resolves.toMatchObject({ items: [expect.objectContaining({ id: seriesId })] });

    for (const searchTerm of ["Integration%20Author", "Integration%20Genre"]) {
      const search = await listSeries(new Request(`http://localhost/api/series?q=${searchTerm}`, { headers }));
      await expect(search.json()).resolves.toMatchObject({
        items: [expect.objectContaining({ id: searchableSeriesId })],
        total: 1,
      });
    }
  });

  it("queues an archive upload, exposes its status, and records cancellation", async () => {
    const form = new FormData();
    form.append("seriesId", seriesId);
    form.append("chapterNumbers", "2");
    form.append("files", new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]), "Chapter 2.cbz");
    const uploaded = await queueUpload(new Request("http://localhost/api/library/upload", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", cookie },
      body: form,
    }));
    expect(uploaded.status).toBe(202);
    const job = await uploaded.json() as { id: string; status: string };
    expect(job.status).toBe("queued");

    const uploadStatus = await getUpload(
      new Request(`http://localhost/api/library/uploads/${job.id}`, { headers: { cookie } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    await expect(uploadStatus.json()).resolves.toMatchObject({ id: job.id, status: "queued", total: 1 });

    const cancelled = await cancelUpload(
      jsonRequest(`/api/library/uploads/${job.id}/cancel`, "POST", {}, { cookie }),
      { params: Promise.resolve({ id: job.id }) },
    );
    await expect(cancelled.json()).resolves.toMatchObject({ id: job.id, status: "queued" });
    const row = await database.query<{ cancel_requested: boolean }>(
      "SELECT cancel_requested FROM upload_jobs WHERE id = $1 AND user_id = $2",
      [job.id, userId],
    );
    expect(row.rows[0].cancel_requested).toBe(true);
  });
});
