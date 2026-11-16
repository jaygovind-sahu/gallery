import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { deletePhotos, getAdminPhoto, updatePhoto } from '../../../../../lib/db';
import { handle, json, notFound, parseJson } from '../../../../../lib/api';
import { patchPhotoSchema } from '../../../../../lib/schemas';

export const prerender = false;

export const GET: APIRoute = ({ params }) =>
  handle(async () => {
    const photo = await getAdminPhoto(params.id ?? '');
    return photo ? json({ photo }) : notFound('No such photo.');
  });

/** Edit fields and category membership. */
export const PATCH: APIRoute = ({ params, request }) =>
  handle(async () => {
    const id = params.id ?? '';
    if (!(await getAdminPhoto(id))) return notFound('No such photo.');
    const patch = await parseJson(request, patchPhotoSchema);
    await updatePhoto(id, patch);
    return json({ photo: await getAdminPhoto(id) });
  });

/** Delete every R2 version and the DB rows; covers pointing at it are cleared. */
export const DELETE: APIRoute = ({ params }) =>
  handle(async () => {
    const id = params.id ?? '';
    const photo = await getAdminPhoto(id);
    if (!photo) return notFound('No such photo.');
    await deleteOriginals([id]);
    await deletePhotos([id]);
    return json({ ok: true });
  });

/** Remove all objects under originals/<id>/ for each photo. */
export async function deleteOriginals(ids: string[]): Promise<void> {
  for (const id of ids) {
    const listed = await env.ORIGINALS.list({ prefix: `originals/${id}/` });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length) await env.ORIGINALS.delete(keys);
  }
}
