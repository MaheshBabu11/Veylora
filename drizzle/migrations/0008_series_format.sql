ALTER TABLE series
  ADD COLUMN format varchar(24) NOT NULL DEFAULT 'Manga',
  ADD CONSTRAINT series_format_check
    CHECK (format IN ('Manga', 'Manhwa', 'Manhua', 'Webtoon', 'Comic', 'Other'));
