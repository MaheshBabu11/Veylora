import { z } from "zod";
import { getRequestUser } from "@/server/auth";
import { pool } from "@/server/db";
import { apiError, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const preferencesSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).optional(),
  readerMode: z.enum(["vertical", "single"]).optional(),
  direction: z.enum(["rtl", "ltr"]).optional(),
  autoScan: z.boolean().optional(),
  language: z.string().min(2).max(16).optional(),
  defaultView: z.enum(["grid", "list"]).optional(),
  shortcuts: z.record(z.string(), z.string()).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one preference is required.");

const selectPreferences = `SELECT p.user_id AS "userId", p.theme, p.reader_mode AS "readerMode", p.direction,
  s.auto_scan AS "autoScan", p.language, p.default_view AS "defaultView", p.shortcuts
  FROM user_preferences p CROSS JOIN library_settings s WHERE p.user_id = $1 AND s.singleton = true`;

export async function GET(request: Request) {
  try {
    const { id: userId } = getRequestUser(request);
    await pool.query("INSERT INTO user_preferences(user_id) VALUES ($1) ON CONFLICT(user_id) DO NOTHING", [userId]);
    const result = await pool.query(selectPreferences, [userId]);
    return Response.json(result.rows[0], { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get preferences");
  }
}

export async function PUT(request: Request) {
  const client = await pool.connect();
  try {
    const { id: userId } = getRequestUser(request);
    const preferences = preferencesSchema.parse(await readJson(request));
    const { autoScan, ...userPreferences } = preferences;
    const fieldMap: Record<string, string> = {
      theme: "theme", readerMode: "reader_mode", direction: "direction", language: "language",
      defaultView: "default_view", shortcuts: "shortcuts",
    };
    const values: unknown[] = [userId];
    const fields = Object.entries(userPreferences).map(([field, value]) => {
      values.push(value);
      return `${fieldMap[field]} = $${values.length}`;
    });

    await client.query("BEGIN");
    if (fields.length) {
      await client.query(
        `INSERT INTO user_preferences(user_id) VALUES ($1) ON CONFLICT(user_id) DO UPDATE
         SET ${fields.join(", ")}, updated_at = now()`,
        values,
      );
    } else {
      await client.query("INSERT INTO user_preferences(user_id) VALUES ($1) ON CONFLICT(user_id) DO NOTHING", [userId]);
    }
    if (autoScan !== undefined) {
      await client.query("UPDATE library_settings SET auto_scan = $1 WHERE singleton = true", [autoScan]);
    }
    const result = await client.query(selectPreferences, [userId]);
    await client.query("COMMIT");
    return Response.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return apiError(error, "save preferences");
  } finally {
    client.release();
  }
}
