import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAdminPhoto, setPhotoOriginal } from '../../../../../lib/db';
import { handle, json, notFound, ApiError } from '../../../../../lib/api';
import { isUploadMime, originalKey } from '../../../../../lib/images';
import { storeOriginal } from '../../../../../lib/originals';

export const prerender = false;

/**
 * Replace the original: raw body → new R2 version key, bump `version`, refresh dimensions and ThumbHash
 * (sent by the browser as headers), keep every other field. The old object is deleted after the row is updated.
 */
export const PUT: APIRoute = ({ params, request }) =>
  handle(async () => {
    const id = params.id ?? '';
    const photo = await getAdminPhoto(id);
    if (!photo) return notFound('No such photo.');

    const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!isUploadMime(contentType)) throw new ApiError(415, 'unsupported_type', 'Only JPEG, PNG and WebP are accepted.');

    const version = photo.version + 1;
    const key = originalKey(id, version, contentType);
    const hint = {
      width: Number(request.headers.get('x-width')) || photo.width,
      height: Number(request.headers.get('x-height')) || photo.height,
      orientation: Number(request.headers.get('x-exif-orientation')) || null,
    };
    const placeholder = request.headers.get('x-placeholder') || null;

    const stored = await storeOriginal(request, key, hint);
    await setPhotoOriginal(id, { ...stored, r2Key: key, version, placeholder });
    if (photo.r2Key !== key) await env.ORIGINALS.delete(photo.r2Key);

    return json({ photo: await getAdminPhoto(id), unverified: stored.unverified });
  });
