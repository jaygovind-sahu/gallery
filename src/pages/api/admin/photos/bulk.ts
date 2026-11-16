import type { APIRoute } from 'astro';
import { bulkUpdatePhotos, deletePhotos } from '../../../../lib/db';
import { handle, json, parseJson } from '../../../../lib/api';
import { bulkPhotoSchema } from '../../../../lib/schemas';
import { deleteOriginals } from './[id]/index';

export const prerender = false;

/** Bulk publish / unpublish / add or remove category / set location / delete. */
export const POST: APIRoute = ({ request }) =>
  handle(async () => {
    const input = await parseJson(request, bulkPhotoSchema);
    if (input.action === 'delete') {
      await deleteOriginals(input.ids);
      await deletePhotos(input.ids);
    } else {
      await bulkUpdatePhotos(input);
    }
    return json({ ok: true, count: input.ids.length });
  });
