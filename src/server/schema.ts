import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const libraryDirectories = pgTable("library_directories", {
  id: uuid("id").primaryKey().defaultRandom(),
  path: text("path").notNull().unique(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const series = pgTable("series", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  format: varchar("format", { length: 24 }).notNull().default("Manga"),
  description: text("description").notNull().default(""),
  status: varchar("status", { length: 24 }).notNull().default("Plan to read"),
  favorite: boolean("favorite").notNull().default(false),
  featured: boolean("featured").notNull().default(false),
  coverPath: text("cover_path"),
  customCoverPath: text("custom_cover_path"),
  titleOverride: text("title_override"),
  coverChapterId: uuid("cover_chapter_id"),
  coverPageNumber: integer("cover_page_number"),
  sourcePath: text("source_path").notNull().unique(),
  directoryId: uuid("directory_id").references(() => libraryDirectories.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("series_title_idx").on(table.title), index("series_status_idx").on(table.status)]);

export const chapters = pgTable("chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  title: text("title").notNull(),
  sourcePath: text("source_path").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("chapters_series_number_idx").on(table.seriesId, table.chapterNumber),
  uniqueIndex("chapters_source_path_idx").on(table.sourcePath),
  index("chapters_series_order_idx").on(table.seriesId, table.chapterNumber),
]);

export const chapterPages = pgTable("chapter_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  chapterId: uuid("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  archiveEntry: text("archive_entry").notNull(),
  width: integer("width"),
  height: integer("height"),
}, (table) => [uniqueIndex("chapter_pages_order_idx").on(table.chapterId, table.pageNumber)]);

export const authors = pgTable("authors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  bio: text("bio").notNull().default(""),
});

export const seriesAuthors = pgTable("series_authors", {
  seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => authors.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.seriesId, table.authorId] }), index("series_authors_author_idx").on(table.authorId)]);

export const genres = pgTable("genres", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const seriesGenres = pgTable("series_genres", {
  seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  genreId: uuid("genre_id").notNull().references(() => genres.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.seriesId, table.genreId] }), index("series_genres_genre_idx").on(table.genreId)]);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const seriesTags = pgTable("series_tags", {
  seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.seriesId, table.tagId] }), index("series_tags_tag_idx").on(table.tagId)]);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().default("local"),
  theme: varchar("theme", { length: 16 }).notNull().default("dark"),
  readerMode: varchar("reader_mode", { length: 16 }).notNull().default("vertical"),
  direction: varchar("direction", { length: 8 }).notNull().default("rtl"),
  autoScan: boolean("auto_scan").notNull().default(true),
  language: varchar("language", { length: 16 }).notNull().default("en"),
  defaultView: varchar("default_view", { length: 16 }).notNull().default("grid"),
  shortcuts: jsonb("shortcuts").notNull().default({}),
  updatedAt: updatedAt(),
});

export const readingProgress = pgTable("reading_progress", {
  userId: text("user_id").notNull().default("local"),
  seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  lastChapterId: uuid("last_chapter_id").references(() => chapters.id, { onDelete: "set null" }),
  lastPage: integer("last_page").notNull().default(1),
  updatedAt: updatedAt(),
}, (table) => [primaryKey({ columns: [table.userId, table.seriesId] }), index("reading_progress_updated_idx").on(table.updatedAt)]);

export const readingHistory = pgTable("reading_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().default("local"),
  seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  chapterId: uuid("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("reading_history_user_date_idx").on(table.userId, table.readAt), index("reading_history_chapter_idx").on(table.chapterId)]);

export const bookmarks = pgTable("bookmarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().default("local"),
  seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number"),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
}, (table) => [index("bookmarks_user_idx").on(table.userId), index("bookmarks_series_idx").on(table.seriesId)]);

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().default("local"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("collections_user_name_idx").on(table.userId, table.name)]);

export const collectionSeries = pgTable("collection_series", {
  collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
  seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  addedAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.collectionId, table.seriesId] }), index("collection_series_series_idx").on(table.seriesId)]);

export const importJobs = pgTable("import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: varchar("status", { length: 24 }).notNull().default("queued"),
  sourcePath: text("source_path").notNull(),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("import_jobs_status_idx").on(table.status, table.createdAt)]);

export const scanJobs = pgTable("scan_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: varchar("status", { length: 24 }).notNull().default("queued"),
  directoryId: uuid("directory_id").references(() => libraryDirectories.id, { onDelete: "set null" }),
  progress: integer("progress").notNull().default(0),
  total: integer("total").notNull().default(0),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("scan_jobs_status_idx").on(table.status, table.createdAt)]);
