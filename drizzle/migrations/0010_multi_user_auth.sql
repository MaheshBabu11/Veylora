CREATE TABLE users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users(id, username)
VALUES ('local', 'local')
ON CONFLICT(id) DO NOTHING;

CREATE TABLE user_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_user_idx ON user_sessions(user_id);
CREATE INDEX user_sessions_expiry_idx ON user_sessions(expires_at);

CREATE TABLE user_series (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  status varchar(24) NOT NULL DEFAULT 'Plan to read'
    CHECK (status IN ('Reading', 'Plan to read', 'Completed', 'On hold')),
  favorite boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, series_id)
);
CREATE INDEX user_series_status_idx ON user_series(user_id, status);

INSERT INTO user_series(user_id, series_id, status, favorite)
SELECT 'local', id, status, favorite FROM series
ON CONFLICT(user_id, series_id) DO NOTHING;

CREATE TABLE library_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  auto_scan boolean NOT NULL DEFAULT true
);
INSERT INTO library_settings(singleton, auto_scan)
SELECT true, COALESCE(
  (SELECT auto_scan FROM user_preferences WHERE user_id = 'local'),
  true
)
ON CONFLICT(singleton) DO NOTHING;

ALTER TABLE user_preferences DROP COLUMN auto_scan;
ALTER TABLE series DROP COLUMN status, DROP COLUMN favorite;
