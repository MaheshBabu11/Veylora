CREATE TABLE library_directories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text NOT NULL UNIQUE,
  status varchar(24) NOT NULL DEFAULT 'active',
  last_scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE manga (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status varchar(24) NOT NULL DEFAULT 'Plan to read' CHECK (status IN ('Reading', 'Plan to read', 'Completed', 'On hold')),
  favorite boolean NOT NULL DEFAULT false,
  cover_path text,
  source_path text NOT NULL UNIQUE,
  directory_id uuid REFERENCES library_directories(id) ON DELETE SET NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manga_title_idx ON manga(title);
CREATE INDEX manga_status_idx ON manga(status);
CREATE INDEX manga_search_vector_idx ON manga USING gin(search_vector);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX manga_title_trgm_idx ON manga USING gin(title gin_trgm_ops);

CREATE TABLE chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manga_id uuid NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  chapter_number integer NOT NULL,
  title text NOT NULL,
  source_path text NOT NULL UNIQUE,
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manga_id, chapter_number)
);
CREATE INDEX chapters_manga_order_idx ON chapters(manga_id, chapter_number);

CREATE TABLE chapter_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number > 0),
  archive_entry text NOT NULL,
  width integer,
  height integer,
  UNIQUE (chapter_id, page_number)
);

CREATE TABLE authors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE, bio text NOT NULL DEFAULT '');
CREATE TABLE manga_authors (
  manga_id uuid NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  PRIMARY KEY (manga_id, author_id)
);
CREATE INDEX manga_authors_author_idx ON manga_authors(author_id);
CREATE TABLE genres (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE);
CREATE TABLE manga_genres (
  manga_id uuid NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  genre_id uuid NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (manga_id, genre_id)
);
CREATE INDEX manga_genres_genre_idx ON manga_genres(genre_id);
CREATE TABLE tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE);
CREATE TABLE manga_tags (
  manga_id uuid NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (manga_id, tag_id)
);
CREATE INDEX manga_tags_tag_idx ON manga_tags(tag_id);

CREATE TABLE user_preferences (
  user_id text PRIMARY KEY DEFAULT 'local',
  theme varchar(16) NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
  reader_mode varchar(16) NOT NULL DEFAULT 'vertical' CHECK (reader_mode IN ('vertical', 'single')),
  direction varchar(8) NOT NULL DEFAULT 'rtl' CHECK (direction IN ('rtl', 'ltr')),
  language varchar(16) NOT NULL DEFAULT 'en',
  default_view varchar(16) NOT NULL DEFAULT 'grid' CHECK (default_view IN ('grid', 'list')),
  shortcuts jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reading_progress (
  user_id text NOT NULL DEFAULT 'local',
  manga_id uuid NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  last_chapter_id uuid REFERENCES chapters(id) ON DELETE SET NULL,
  last_page integer NOT NULL DEFAULT 1 CHECK (last_page > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, manga_id)
);
CREATE INDEX reading_progress_updated_idx ON reading_progress(updated_at DESC);
CREATE TABLE reading_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'local',
  manga_id uuid NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reading_history_user_date_idx ON reading_history(user_id, read_at DESC);
CREATE INDEX reading_history_chapter_idx ON reading_history(chapter_id);
CREATE TABLE bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'local',
  manga_id uuid NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES chapters(id) ON DELETE CASCADE,
  page_number integer CHECK (page_number IS NULL OR page_number > 0),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookmarks_user_idx ON bookmarks(user_id);
CREATE INDEX bookmarks_manga_idx ON bookmarks(manga_id);
CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL DEFAULT 'local',
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE TABLE collection_manga (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  manga_id uuid NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, manga_id)
);
CREATE INDEX collection_manga_manga_idx ON collection_manga(manga_id);
CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status varchar(24) NOT NULL DEFAULT 'queued',
  source_path text NOT NULL,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_jobs_status_idx ON import_jobs(status, created_at);
CREATE TABLE scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status varchar(24) NOT NULL DEFAULT 'queued',
  directory_id uuid REFERENCES library_directories(id) ON DELETE SET NULL,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  total integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_jobs_status_idx ON scan_jobs(status, created_at);
