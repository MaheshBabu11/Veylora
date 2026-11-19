import { createHash } from "node:crypto";
import { pool } from "./db";
import { HttpError } from "./http";

const globalForRateLimit = globalThis as typeof globalThis & { veyloraRateLimitChecks?: number };

export async function enforceRateLimit(
  scope: string,
  subject: string,
  maxAttempts: number,
  windowSeconds: number,
) {
  const subjectHash = createHash("sha256").update(`${scope}\0${subject}`).digest("hex");
  const result = await pool.query<{ hit_count: number; window_started_at: Date }>(
    `INSERT INTO auth_rate_limits(subject_hash, hit_count)
     VALUES ($1, 1)
     ON CONFLICT(subject_hash) DO UPDATE SET
       window_started_at = CASE
         WHEN auth_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN now()
         ELSE auth_rate_limits.window_started_at
       END,
       hit_count = CASE
         WHEN auth_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN 1
         ELSE auth_rate_limits.hit_count + 1
       END,
       updated_at = now()
     RETURNING hit_count, window_started_at`,
    [subjectHash, windowSeconds],
  );
  const bucket = result.rows[0];
  if (bucket.hit_count > maxAttempts) {
    const expiresAt = bucket.window_started_at.getTime() + windowSeconds * 1_000;
    const retryAfter = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1_000));
    throw new HttpError(429, "Too many attempts. Try again later.", { "Retry-After": String(retryAfter) });
  }

  globalForRateLimit.veyloraRateLimitChecks = (globalForRateLimit.veyloraRateLimitChecks ?? 0) + 1;
  if (globalForRateLimit.veyloraRateLimitChecks % 100 === 0) {
    await pool.query("DELETE FROM auth_rate_limits WHERE window_started_at < now() - interval '1 day'");
  }
}
