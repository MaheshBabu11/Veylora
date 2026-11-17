import { z } from "zod";
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

const selectPreferences = `SELECT user_id AS "userId", theme, reader_mode AS "readerMode", direction, auto_scan AS "autoScan", language,
  default_view AS "defaultView", shortcuts FROM user_preferences WHERE user_id = 'local'`;

export async function GET() {
  try {
    await pool.query("INSERT INTO user_preferences(user_id) VALUES ('local') ON CONFLICT(user_id) DO NOTHING");
    const result = await pool.query(selectPreferences);
    return Response.json(result.rows[0], { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "get preferences");
  }
}

export async function PUT(request: Request) {
  try {
    const preferences = preferencesSchema.parse(await readJson(request));
    const fieldMap: Record<string, string> = {
      theme: "theme", readerMode: "reader_mode", direction: "direction", autoScan: "auto_scan", language: "language",
      defaultView: "default_view", shortcuts: "shortcuts",
    };
    const values: unknown[] = [];
    const fields = Object.entries(preferences).map(([field, value]) => {
      values.push(value);
      return `${fieldMap[field]} = $${values.length}`;
    });
    const result = await pool.query(
      `INSERT INTO user_preferences(user_id) VALUES ('local') ON CONFLICT(user_id) DO UPDATE
       SET ${fields.join(", ")}, updated_at = now()
       RETURNING user_id AS "userId", theme, reader_mode AS "readerMode", direction, auto_scan AS "autoScan", language,
         default_view AS "defaultView", shortcuts`,
      values,
    );
    return Response.json(result.rows[0]);
  } catch (error) {
    return apiError(error, "save preferences");
  }
}
