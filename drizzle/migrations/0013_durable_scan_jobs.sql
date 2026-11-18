ALTER TABLE scan_jobs
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN worker_id text,
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN completed_at timestamptz;

CREATE INDEX scan_jobs_claim_idx ON scan_jobs(status, available_at, created_at);
