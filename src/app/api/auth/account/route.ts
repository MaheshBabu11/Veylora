import { z } from "zod";
import { getRequestUser, updateAccountCredentials, sessionCookie } from "@/server/auth";
import { apiError, HttpError, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accountSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9][a-z0-9._-]*$/),
  newPassword: z.union([z.literal(""), z.string().min(8).max(128)]).optional(),
});

export async function PUT(request: Request) {
  try {
    const user = getRequestUser(request);
    const input = accountSchema.parse(await readJson(request));
    const updated = await updateAccountCredentials(user.id, input);
    return Response.json(
      { id: updated.id, username: updated.username },
      { headers: { "Set-Cookie": sessionCookie(updated.token, process.env.NODE_ENV === "production") } },
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return apiError(new HttpError(409, "That username is already in use."), "update account");
    }
    return apiError(error, "update account");
  }
}
