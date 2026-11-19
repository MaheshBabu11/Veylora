import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "@/server/db";
import { createAccount, createSession, hashPassword, sessionCookie } from "@/server/auth";
import { apiError, HttpError, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const credentialsSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9][a-z0-9._-]*$/),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    const credentials = credentialsSchema.parse(await readJson(request));
    await enforceRateLimit("registration", "instance", 20, 60 * 60);
    const passwordHash = await hashPassword(credentials.password);
    client = await pool.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    const userId = await createAccount(client, credentials.username, passwordHash);
    await client.query("COMMIT");
    transactionOpen = false;
    const token = await createSession(userId);
    const result = await pool.query<{ id: string; username: string }>(
      "SELECT id, username FROM users WHERE id = $1",
      [userId],
    );
    return Response.json(result.rows[0], {
      status: 201,
      headers: { "Set-Cookie": sessionCookie(token, process.env.NODE_ENV === "production") },
    });
  } catch (error) {
    if (client && transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      return apiError(new HttpError(409, "That username is already in use."), "register account");
    }
    return apiError(error, "register account");
  } finally {
    client?.release();
  }
}
