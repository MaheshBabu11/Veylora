ALTER TABLE manga
  ADD COLUMN title_override text,
  ADD COLUMN cover_chapter_id uuid REFERENCES chapters(id) ON DELETE SET NULL,
  ADD COLUMN cover_page_number integer CHECK (cover_page_number IS NULL OR cover_page_number > 0);
