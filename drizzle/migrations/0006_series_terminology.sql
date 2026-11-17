ALTER TABLE manga RENAME TO series;
ALTER TABLE series RENAME CONSTRAINT manga_pkey TO series_pkey;
ALTER TABLE series RENAME CONSTRAINT manga_source_path_key TO series_source_path_key;
ALTER TABLE series RENAME CONSTRAINT manga_status_check TO series_status_check;

ALTER INDEX manga_title_idx RENAME TO series_title_idx;
ALTER INDEX manga_status_idx RENAME TO series_status_idx;
ALTER INDEX manga_search_vector_idx RENAME TO series_search_vector_idx;
ALTER INDEX manga_title_trgm_idx RENAME TO series_title_trgm_idx;

ALTER TABLE chapters RENAME COLUMN manga_id TO series_id;
ALTER TABLE chapters RENAME CONSTRAINT chapters_manga_id_fkey TO chapters_series_id_fkey;
ALTER TABLE chapters RENAME CONSTRAINT chapters_manga_id_chapter_number_key TO chapters_series_number_idx;
ALTER INDEX chapters_manga_order_idx RENAME TO chapters_series_order_idx;

ALTER TABLE manga_authors RENAME TO series_authors;
ALTER TABLE series_authors RENAME COLUMN manga_id TO series_id;
ALTER TABLE series_authors RENAME CONSTRAINT manga_authors_pkey TO series_authors_pkey;
ALTER TABLE series_authors RENAME CONSTRAINT manga_authors_manga_id_fkey TO series_authors_series_id_fkey;
ALTER TABLE series_authors RENAME CONSTRAINT manga_authors_author_id_fkey TO series_authors_author_id_fkey;
ALTER INDEX manga_authors_author_idx RENAME TO series_authors_author_idx;

ALTER TABLE manga_genres RENAME TO series_genres;
ALTER TABLE series_genres RENAME COLUMN manga_id TO series_id;
ALTER TABLE series_genres RENAME CONSTRAINT manga_genres_pkey TO series_genres_pkey;
ALTER TABLE series_genres RENAME CONSTRAINT manga_genres_manga_id_fkey TO series_genres_series_id_fkey;
ALTER TABLE series_genres RENAME CONSTRAINT manga_genres_genre_id_fkey TO series_genres_genre_id_fkey;
ALTER INDEX manga_genres_genre_idx RENAME TO series_genres_genre_idx;

ALTER TABLE manga_tags RENAME TO series_tags;
ALTER TABLE series_tags RENAME COLUMN manga_id TO series_id;
ALTER TABLE series_tags RENAME CONSTRAINT manga_tags_pkey TO series_tags_pkey;
ALTER TABLE series_tags RENAME CONSTRAINT manga_tags_manga_id_fkey TO series_tags_series_id_fkey;
ALTER TABLE series_tags RENAME CONSTRAINT manga_tags_tag_id_fkey TO series_tags_tag_id_fkey;
ALTER INDEX manga_tags_tag_idx RENAME TO series_tags_tag_idx;

ALTER TABLE reading_progress RENAME COLUMN manga_id TO series_id;
ALTER TABLE reading_progress RENAME CONSTRAINT reading_progress_manga_id_fkey TO reading_progress_series_id_fkey;

ALTER TABLE reading_history RENAME COLUMN manga_id TO series_id;
ALTER TABLE reading_history RENAME CONSTRAINT reading_history_manga_id_fkey TO reading_history_series_id_fkey;

ALTER TABLE bookmarks RENAME COLUMN manga_id TO series_id;
ALTER TABLE bookmarks RENAME CONSTRAINT bookmarks_manga_id_fkey TO bookmarks_series_id_fkey;
ALTER INDEX bookmarks_manga_idx RENAME TO bookmarks_series_idx;

ALTER TABLE collection_manga RENAME TO collection_series;
ALTER TABLE collection_series RENAME COLUMN manga_id TO series_id;
ALTER TABLE collection_series RENAME CONSTRAINT collection_manga_pkey TO collection_series_pkey;
ALTER TABLE collection_series RENAME CONSTRAINT collection_manga_collection_id_fkey TO collection_series_collection_id_fkey;
ALTER TABLE collection_series RENAME CONSTRAINT collection_manga_manga_id_fkey TO collection_series_series_id_fkey;
ALTER INDEX collection_manga_manga_idx RENAME TO collection_series_series_idx;
