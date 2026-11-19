CREATE TABLE auth_rate_limits (
  subject_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL CHECK (hit_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_rate_limits_window_idx ON auth_rate_limits(window_started_at);
