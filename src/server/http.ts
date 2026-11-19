import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly headers?: HeadersInit) {
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
    return Response.json({ error: error.message }, { status: error.status, headers: error.headers });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "Invalid request.", details: error.issues }, { status: 400 });
  }
  console.error(`[api] ${operation} failed`, error);
  return Response.json({ error: "The request could not be completed." }, { status: 500 });
}

export async function readJson(request: Request) {
  assertSameOrigin(request);
  const maxBytes = 64 * 1024;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError(413, "The JSON request body exceeds the 64 KiB limit.");
  }
  if (!request.body) throw new HttpError(400, "Request body must be valid JSON.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "The JSON request body exceeds the 64 KiB limit.");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Request body must be valid JSON.");
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}
