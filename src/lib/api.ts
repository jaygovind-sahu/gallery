/**
 * Small helpers for the JSON admin API: consistent error shape `{ error: { code, message } }`.
 */
import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

export function notFound(what = 'Not found'): Response {
  return errorResponse(404, 'not_found', what);
}

/** Parse and validate a JSON body; throws ApiError(400) on bad input. */
export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, 'bad_json', 'Request body must be JSON.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new ApiError(400, 'invalid', `${path}${issue?.message ?? 'Invalid request.'}`);
  }
  return result.data;
}

/** Wrap a handler so thrown ApiErrors become JSON responses and anything else a 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message);
    console.error(err);
    return errorResponse(500, 'internal', err instanceof Error ? err.message : 'Internal error.');
  });
}
