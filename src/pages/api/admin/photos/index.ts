import type { APIRoute } from 'astro';
import { createPhoto, listAdminPhotos, type AdminPhotoFilter } from '../../../../lib/db';
import { handle, json, parseJson } from '../../../../lib/api';
import { createPhotoSchema } from '../../../../lib/schemas';

export const prerender = false;

/** Library listing for the admin UI (drafts and stuck uploads included). */
export const GET: APIRoute = ({ url }) =>
  handle(async () => {
    const status = url.searchParams.get('status');
    const filter: AdminPhotoFilter = {
      categoryId: url.searchParams.get('category') || undefined,
      locationId: url.searchParams.get('location') || undefined,
      status: status === 'published' || status === 'draft' || status === 'uploading' ? status : undefined,
    };
    return json({ photos: await listAdminPhotos(filter) });
  });

/** Step 5 of the upload flow: create the row from browser-read metadata, return the id. */
export const POST: APIRoute = ({ request }) =>
  handle(async () => {
    const input = await parseJson(request, createPhotoSchema);
    const id = await createPhoto(input);
    return json({ id }, 201);
  });
