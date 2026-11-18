import { z } from "zod";
import { pool } from "@/server/db";
import { createSession, sessionCookie, verifyPassword } from "@/server/auth";
import { apiError, HttpError, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const credentialsSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(32),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  try {
    const credentials = credentialsSchema.parse(await readJson(request));
    const result = await pool.query<{ id: string; username: string; password_hash: string | null }>(
      "SELECT id, username, password_hash FROM users WHERE username = $1",
      [credentials.username],
    );
    const user = result.rows[0];
    if (!user || !await verifyPassword(credentials.password, user.password_hash)) {
      throw new HttpError(401, "The username or password is incorrect.");
    }
    const token = await createSession(user.id);
    return Response.json(
      { id: user.id, username: user.username },
      { headers: { "Set-Cookie": sessionCookie(token, process.env.NODE_ENV === "production") } },
    );
  } catch (error) {
    return apiError(error, "sign in");
  }
}
