import { pool } from "./db";
import { HttpError } from "./http";
import { SERIES_FORMATS } from "@/types/library";

export type SeriesFilters = {
  userId: string;
  query?: string;
  status?: string;
  genre?: string;
  featuredOnly?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
  id?: string;
};

const userSeriesJoin = "FROM series m LEFT JOIN user_series us ON us.user_id = $1 AND us.series_id = m.id";

const seriesSql = `
  SELECT m.id, m.title, m.format, m.description,
    COALESCE(us.status, 'Plan to read') AS status, COALESCE(us.favorite, false) AS favorite,
    m.featured, m.created_at, m.updated_at,
    m.cover_path, COALESCE(array_to_string(authors.names, ', '), 'Unknown author') AS author,
    COALESCE(genres.names, ARRAY[]::text[]) AS genres,
    COALESCE(genres.ids, ARRAY[]::text[]) AS genre_ids,
    m.cover_chapter_id, m.cover_page_number,
    COALESCE(chapter_stats.chapter_count, 0)::int AS chapters,
    COALESCE(progress.chapter_number, 0)::int AS read_chapters,
    progress.chapter_id AS last_chapter_id,
    history.read_at AS last_read
  ${userSeriesJoin}
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT a.name ORDER BY a.name) AS names
    FROM series_authors ma JOIN authors a ON a.id = ma.author_id WHERE ma.series_id = m.id
  ) authors ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT g.name ORDER BY g.name) AS names,
      array_agg(DISTINCT g.id::text ORDER BY g.id::text) AS ids
    FROM series_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.series_id = m.id
  ) genres ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS chapter_count FROM chapters c WHERE c.series_id = m.id
  ) chapter_stats ON true
  LEFT JOIN LATERAL (
    SELECT c.id AS chapter_id, c.chapter_number FROM reading_progress rp
    JOIN chapters c ON c.id = rp.last_chapter_id
    WHERE rp.user_id = $1 AND rp.series_id = m.id
  ) progress ON true
  LEFT JOIN LATERAL (
    SELECT h.read_at FROM reading_history h
    WHERE h.user_id = $1 AND h.series_id = m.id ORDER BY h.read_at DESC LIMIT 1
  ) history ON true`;

const colorSets = [
  ["#283f6a", "#d8dfff", "moon"], ["#9b5b58", "#ffe2c9", "flower"],
  ["#537b78", "#e5f1cf", "mountain"], ["#c87845", "#ffdb9e", "sun"],
  ["#554d76", "#d7c8f3", "city"], ["#3d7880", "#c6f2e9", "ocean"],
] as const;

export function toSeries(row: Record<string, unknown>) {
  const format = SERIES_FORMATS.find((candidate) => candidate === row.format);
  if (!format) throw new Error(`Unknown series format "${String(row.format)}".`);
  const colorIndex = [...String(row.id)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % colorSets.length;
  const [color, accent, art] = colorSets[colorIndex];
  const chapterCount = Number(row.chapters ?? 0);
  const readChapters = Number(row.read_chapters ?? 0);
  const updatedAt = new Date(String(row.updated_at));
  return {
    id: String(row.id),
    title: String(row.title),
    format,
    subtitle: String(row.description || "Local archive"),
    author: String(row.author || "Unknown author"),
    genres: Array.isArray(row.genres) ? row.genres.map(String) : [],
    genreIds: Array.isArray(row.genre_ids) ? row.genre_ids.map(String) : [],
    status: String(row.status),
    featured: Boolean(row.featured),
    chapters: chapterCount,
    readChapters,
    updated: updatedAt.toLocaleDateString(),
    lastRead: row.last_read ? new Date(String(row.last_read)).toLocaleString() : undefined,
    color,
    accent,
    art,
    rating: "—",
    description: String(row.description || "No description has been added."),
    coverUrl: `/api/series/${String(row.id)}/cover?v=${encodeURIComponent(String(row.updated_at))}`,
    coverChapterId: row.cover_chapter_id ? String(row.cover_chapter_id) : undefined,
    coverPageNumber: row.cover_page_number == null ? undefined : Number(row.cover_page_number),
    favorite: Boolean(row.favorite),
    lastChapterId: row.last_chapter_id ? String(row.last_chapter_id) : undefined,
  };
}

export async function listSeries(filters: SeriesFilters) {
  const userId = filters.userId;
  const query = filters.query?.trim() || null;
  const status = filters.status || null;
  const genre = filters.genre || null;
  const featuredOnly = filters.featuredOnly ?? null;
  const id = filters.id || null;
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const sort = filters.sort === "title" ? "m.title ASC"
    : filters.sort === "updated" ? "m.updated_at DESC"
      : filters.sort === "last-read" ? "history.read_at DESC NULLS LAST, m.title ASC"
        : "m.created_at DESC";
  const filterSql = `WHERE ($2::text IS NULL OR m.search_vector @@ plainto_tsquery('simple', $2) OR m.title ILIKE '%' || $2 || '%')
    AND ($3::text IS NULL OR COALESCE(us.status, 'Plan to read') = $3)
    AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM series_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.series_id = m.id AND g.name = $4))
    AND ($5::uuid IS NULL OR m.id = $5)
    AND ($6::boolean IS NULL OR m.featured = $6)`;
  const params = [userId, query, status, genre, id, featuredOnly];
  const countResult = await pool.query(`SELECT count(*)::int AS total ${userSeriesJoin} ${filterSql}`, params);
  const result = await pool.query(`${seriesSql} ${filterSql} ORDER BY ${sort} LIMIT $7 OFFSET $8`, [...params, limit, offset]);
  return { items: result.rows.map(toSeries), total: countResult.rows[0].total as number, limit, offset };
}

export async function getSeries(id: string, userId: string) {
  const result = await listSeries({ id, limit: 1, userId });
  if (!result.items.length) throw new HttpError(404, "Title not found.");
  return result.items[0];
}

export async function listChapters(seriesId: string, userId: string) {
  const seriesExists = await pool.query("SELECT 1 FROM series WHERE id = $1", [seriesId]);
  if (!seriesExists.rowCount) throw new HttpError(404, "Title not found.");
  const result = await pool.query(
    `SELECT c.id, c.chapter_number, c.title, c.page_count, c.created_at, rp.last_page,
      COALESCE(rp.updated_at, history.read_at) AS last_read
     FROM chapters c LEFT JOIN reading_progress rp ON rp.last_chapter_id = c.id AND rp.user_id = $2
     LEFT JOIN LATERAL (
       SELECT h.read_at FROM reading_history h
       WHERE h.user_id = $2 AND h.chapter_id = c.id
       ORDER BY h.read_at DESC LIMIT 1
     ) history ON true
     WHERE c.series_id = $1 ORDER BY c.chapter_number`,
    [seriesId, userId],
  );
  return result.rows;
}

export async function getChapterPages(seriesId: string, chapterId: string) {
  const chapter = await pool.query("SELECT id FROM chapters WHERE id = $1 AND series_id = $2", [chapterId, seriesId]);
  if (!chapter.rowCount) throw new HttpError(404, "Chapter not found.");
  const result = await pool.query(
    "SELECT page_number, archive_entry FROM chapter_pages WHERE chapter_id = $1 ORDER BY page_number",
    [chapterId],
  );
  return result.rows.map((row) => ({
    pageNumber: row.page_number as number,
    url: `/api/series/${seriesId}/chapters/${chapterId}/pages/${row.page_number}`,
  }));
}
