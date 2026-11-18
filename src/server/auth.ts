import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { HttpError } from "./http";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "veylora_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;

export type AuthUser = { id: string; username: string };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(request: Request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === SESSION_COOKIE) return valueParts.join("=") || null;
  }
  return null;
}

export async function getAuthenticatedUser(request: Request): Promise<AuthUser | null> {
  const token = readCookie(request);
  if (!token) return null;
  const result = await pool.query<AuthUser>(
    `SELECT u.id, u.username
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.password_hash IS NOT NULL`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}

export function getRequestUser(request: Request): AuthUser {
  const id = request.headers.get("x-veylora-user-id");
  const username = request.headers.get("x-veylora-username");
  if (!id || !username) throw new HttpError(401, "Please sign in to continue.");
  return { id, username };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64) as Buffer;
  return `$scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string | null) {
  if (!storedHash) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[1] !== "scrypt" || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{128}$/.test(parts[3])) {
    return false;
  }
  const expected = Buffer.from(parts[3], "hex");
  const actual = await scrypt(password, Buffer.from(parts[2], "hex"), expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await pool.query("DELETE FROM user_sessions WHERE expires_at <= now()");
  await pool.query(
    `INSERT INTO user_sessions(token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
    [hashToken(token), userId, SESSION_DURATION_SECONDS],
  );
  return token;
}

export async function updateAccountCredentials(
  userId: string,
  input: { currentPassword: string; username: string; newPassword?: string },
) {
  const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; username: string; password_hash: string | null }>(
      "SELECT id, username, password_hash FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const user = result.rows[0];
    if (!user || !await verifyPassword(input.currentPassword, user.password_hash)) {
      throw new HttpError(400, "Current password is incorrect.");
    }
    if (user.username === input.username && !passwordHash) {
      throw new HttpError(400, "Enter a new username or password to save a change.");
    }

    await client.query(
      "UPDATE users SET username = $2, password_hash = COALESCE($3, password_hash) WHERE id = $1",
      [userId, input.username, passwordHash],
    );
    const token = randomBytes(32).toString("base64url");
    await client.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
    await client.query(
      `INSERT INTO user_sessions(token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
      [hashToken(token), userId, SESSION_DURATION_SECONDS],
    );
    await client.query("COMMIT");
    return { id: user.id, username: input.username, token };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createAccount(client: PoolClient, username: string, passwordHash: string) {
  await client.query("SELECT pg_advisory_xact_lock(734210, 2)");
  const legacyAccount = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE id = 'local' AND password_hash IS NULL FOR UPDATE",
  );
  if (legacyAccount.rowCount) {
    await client.query(
      "UPDATE users SET username = $1, password_hash = $2 WHERE id = 'local'",
      [username, passwordHash],
    );
    return "local";
  }

  const id = randomUUID();
  await client.query(
    "INSERT INTO users(id, username, password_hash) VALUES ($1, $2, $3)",
    [id, username, passwordHash],
  );
  return id;
}

export async function revokeSession(request: Request) {
  const token = readCookie(request);
  if (token) await pool.query("DELETE FROM user_sessions WHERE token_hash = $1", [hashToken(token)]);
}

export function sessionCookie(token: string, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie(secure: boolean) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
