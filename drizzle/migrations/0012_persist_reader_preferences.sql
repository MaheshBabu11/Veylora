ALTER TABLE user_preferences
  ADD COLUMN reader_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
