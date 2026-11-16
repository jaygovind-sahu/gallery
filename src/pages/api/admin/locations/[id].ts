import type { APIRoute } from 'astro';
import { deleteLocation, getLocation, mergeLocation, slugTaken, updateLocation } from '../../../../lib/db';
import { ApiError, handle, json, notFound, parseJson } from '../../../../lib/api';
import { patchLocationSchema } from '../../../../lib/schemas';

export const prerender = false;

export const GET: APIRoute = ({ params }) =>
  handle(async () => {
    const location = await getLocation(params.id ?? '');
    return location ? json({ location }) : notFound('No such location.');
  });

export const PATCH: APIRoute = ({ params, request }) =>
  handle(async () => {
    const id = params.id ?? '';
    if (!(await getLocation(id))) return notFound('No such location.');
    const patch = await parseJson(request, patchLocationSchema);
    if (patch.slug !== undefined && (await slugTaken('locations', patch.slug, id))) {
      throw new ApiError(409, 'slug_taken', 'Another location already uses that slug.');
    }
    await updateLocation(id, patch);
    return json({ location: await getLocation(id) });
  });

/**
 * Delete a location. With `?into=<id>` its photos move to that location first (merge);
 * without it they simply lose their location.
 */
export const DELETE: APIRoute = ({ params, url }) =>
  handle(async () => {
    const id = params.id ?? '';
    if (!(await getLocation(id))) return notFound('No such location.');
    const into = url.searchParams.get('into');
    if (into) {
      if (into === id) throw new ApiError(400, 'invalid', 'Cannot merge a location into itself.');
      if (!(await getLocation(into))) throw new ApiError(400, 'invalid', 'Target location does not exist.');
      await mergeLocation(id, into);
    } else {
      await deleteLocation(id);
    }
    return json({ ok: true });
  });
