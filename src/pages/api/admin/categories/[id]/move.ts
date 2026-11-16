import type { APIRoute } from 'astro';
import { getAdminCategory, movePhotoInCategory } from '../../../../../lib/db';
import { ApiError, handle, json, notFound, parseJson } from '../../../../../lib/api';
import { moveSchema } from '../../../../../lib/schemas';

export const prerender = false;

/** `{ photoId, beforeId?, afterId? }`: place photoId after beforeId and before afterId (fractional position). */
export const POST: APIRoute = ({ params, request }) =>
  handle(async () => {
    const id = params.id ?? '';
    if (!(await getAdminCategory(id))) return notFound('No such category.');
    const { photoId, beforeId, afterId } = await parseJson(request, moveSchema);
    try {
      const position = await movePhotoInCategory(id, photoId, beforeId, afterId);
      return json({ ok: true, position });
    } catch (err) {
      throw new ApiError(400, 'invalid', (err as Error).message);
    }
  });
