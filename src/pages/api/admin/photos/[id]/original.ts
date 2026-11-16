import type { APIRoute } from 'astro';
import { getAdminPhoto, markPhotoReady } from '../../../../../lib/db';
import { handle, json, notFound } from '../../../../../lib/api';
import { storeOriginal } from '../../../../../lib/originals';

export const prerender = false;

/** Step 6 of the upload flow: raw body → R2, verify with the Images binding, mark the row ready. */
export const PUT: APIRoute = ({ params, request }) =>
  handle(async () => {
    const id = params.id ?? '';
    const photo = await getAdminPhoto(id);
    if (!photo) return notFound('No such photo.');

    const orientation = Number(request.headers.get('x-exif-orientation')) || null;
    const stored = await storeOriginal(request, photo.r2Key, { width: photo.width, height: photo.height, orientation });
    await markPhotoReady(id, stored);
    return json({ id, status: 'ready', width: stored.width, height: stored.height, bytes: stored.bytes, unverified: stored.unverified, unverifiedReason: stored.unverifiedReason });
  });
