ALTER TABLE scan_jobs DROP CONSTRAINT scan_jobs_progress_check;
ALTER TABLE scan_jobs ADD CONSTRAINT scan_jobs_progress_nonnegative CHECK (progress >= 0);
