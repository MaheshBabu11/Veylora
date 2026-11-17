import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Cross-origin requests are not allowed.");
  }
  if (!requestHost || originHost !== requestHost) throw new HttpError(403, "Cross-origin requests are not allowed.");
}

export function apiError(error: unknown, operation: string) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "Invalid request.", details: error.issues }, { status: 400 });
  }
  console.error(`[api] ${operation} failed`, error);
  return Response.json({ error: "The request could not be completed." }, { status: 500 });
}

export async function readJson(request: Request) {
  assertSameOrigin(request);
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}
