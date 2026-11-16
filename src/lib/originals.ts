/**
 * Receiving an original: stream the body into R2, verify it with the Images binding, return the facts.
 * Shared by `PUT photos/:id/original` and `PUT photos/:id/replace`.
 */
import { env } from 'cloudflare:workers';
import { ApiError } from './api';
import { isUploadMime, MAX_UPLOAD_BYTES, type UploadMime } from './images';
import { reconcileDimensions, type BrowserHint } from './originals-pure';

export interface StoredOriginal {
  key: string;
  mime: UploadMime;
  bytes: number;
  width: number;
  height: number;
  /** True when the Images binding could not inspect the file (local dev only) and browser values were kept. */
  unverified: boolean;
  /** Why verification was skipped (dev only). */
  unverifiedReason?: string;
}

function isProduction(request: Request): boolean {
  try {
    return new URL(request.url).hostname === new URL(env.SITE_URL).hostname;
  } catch {
    return true;
  }
}

/**
 * Store the request body at `key`. Throws ApiError on bad type/size or a non-image; the caller decides
 * whether to delete the object (this function already deletes it when verification fails).
 */
export async function storeOriginal(request: Request, key: string, hint: BrowserHint): Promise<StoredOriginal> {
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!isUploadMime(contentType)) throw new ApiError(415, 'unsupported_type', 'Only JPEG, PNG and WebP are accepted.');

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, 'too_large', 'Files must be 100 MB or smaller.');
  }
  if (!request.body) throw new ApiError(400, 'empty', 'Request body is empty.');

  // R2 needs a known length to stream; buffer only when the client didn't send Content-Length.
  const body: ReadableStream | ArrayBuffer =
    Number.isFinite(declared) && declared > 0 ? request.body : await request.arrayBuffer();
  if (body instanceof ArrayBuffer && body.byteLength > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, 'too_large', 'Files must be 100 MB or smaller.');
  }

  await env.ORIGINALS.put(key, body, { httpMetadata: { contentType } });

  const stored = await env.ORIGINALS.get(key);
  if (!stored) throw new ApiError(500, 'storage', 'Upload did not land in storage.');
  if (stored.size > MAX_UPLOAD_BYTES) {
    await env.ORIGINALS.delete(key);
    throw new ApiError(413, 'too_large', 'Files must be 100 MB or smaller.');
  }

  // Trust only the Images binding for format and dimensions (docs/DESIGN.md, "Uploads").
  let info: ImageInfoResponse | null = null;
  let unverifiedReason: string | undefined;
  try {
    info = await env.IMAGES.info(stored.body);
  } catch (err) {
    const code = (err as { code?: number }).code;
    // 9412 is the production "not an image" code; the local binding (sharp) says "unsupported image format".
    if (code === 9412 || /unsupported image format|not an image/i.test((err as Error).message ?? '')) {
      await env.ORIGINALS.delete(key);
      throw new ApiError(415, 'not_an_image', 'The file is not a readable image.');
    }
    if (isProduction(request)) {
      await env.ORIGINALS.delete(key);
      throw new ApiError(502, 'images_unavailable', `Could not inspect the image: ${(err as Error).message}`);
    }
    unverifiedReason = `${(err as Error).name ?? 'Error'}${code ? ` ${code}` : ''}: ${(err as Error).message}`;
    console.warn('[dev] Images binding could not inspect the upload, keeping browser dimensions:', unverifiedReason);
  }

  if (info && !('width' in info)) {
    await env.ORIGINALS.delete(key);
    throw new ApiError(415, 'unsupported_type', 'SVG is not accepted.');
  }
  if (info && info.format !== contentType) {
    await env.ORIGINALS.delete(key);
    throw new ApiError(415, 'type_mismatch', `The file is ${info.format}, not ${contentType}.`);
  }

  const dims = info ? reconcileDimensions(info.width, info.height, hint) : { width: hint.width, height: hint.height };
  return { key, mime: contentType, bytes: stored.size, width: dims.width, height: dims.height, unverified: !info, unverifiedReason };
}
