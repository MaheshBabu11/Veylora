CREATE TABLE upload_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status varchar(24) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  total integer NOT NULL CHECK (total BETWEEN 1 AND 100),
  payload jsonb NOT NULL,
  error text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  worker_id text,
  locked_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX upload_jobs_claim_idx ON upload_jobs(status, available_at, created_at);
CREATE INDEX upload_jobs_user_history_idx ON upload_jobs(user_id, created_at DESC);
