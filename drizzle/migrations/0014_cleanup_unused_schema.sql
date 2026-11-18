DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tags) THEN
    RAISE EXCEPTION 'Cannot drop unused tags table because it contains data';
  END IF;
  IF EXISTS (SELECT 1 FROM series_tags) THEN
    RAISE EXCEPTION 'Cannot drop unused series_tags table because it contains data';
  END IF;
  IF EXISTS (SELECT 1 FROM import_jobs) THEN
    RAISE EXCEPTION 'Cannot drop unused import_jobs table because it contains data';
  END IF;
END $$;

DROP TABLE series_tags;
DROP TABLE tags;
DROP TABLE import_jobs;

DELETE FROM scan_jobs
WHERE status NOT IN ('queued', 'running')
  AND id NOT IN (SELECT id FROM scan_jobs ORDER BY created_at DESC LIMIT 20);
