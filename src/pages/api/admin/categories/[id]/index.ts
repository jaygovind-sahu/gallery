import type { APIRoute } from 'astro';
import { deleteCategory, getAdminCategory, getAdminPhoto, listCategoryPhotosAdmin, slugTaken, updateCategory } from '../../../../../lib/db';
import { ApiError, handle, json, notFound, parseJson } from '../../../../../lib/api';
import { patchCategorySchema } from '../../../../../lib/schemas';

export const prerender = false;

/** The category plus its photos in manual order (drafts included). */
export const GET: APIRoute = ({ params }) =>
  handle(async () => {
    const category = await getAdminCategory(params.id ?? '');
    if (!category) return notFound('No such category.');
    return json({ category, photos: await listCategoryPhotosAdmin(category.id) });
  });

/** Rename, describe, change slug, default layout, cover photo or position. */
export const PATCH: APIRoute = ({ params, request }) =>
  handle(async () => {
    const id = params.id ?? '';
    if (!(await getAdminCategory(id))) return notFound('No such category.');
    const patch = await parseJson(request, patchCategorySchema);
    if (patch.slug !== undefined && (await slugTaken('categories', patch.slug, id))) {
      throw new ApiError(409, 'slug_taken', 'Another category already uses that slug.');
    }
    if (patch.coverPhotoId) {
      const photo = await getAdminPhoto(patch.coverPhotoId);
      if (!photo) throw new ApiError(400, 'invalid', 'Cover photo does not exist.');
    }
    await updateCategory(id, patch);
    return json({ category: await getAdminCategory(id) });
  });

/** Delete the category; its photos stay in the library. */
export const DELETE: APIRoute = ({ params }) =>
  handle(async () => {
    const id = params.id ?? '';
    if (!(await getAdminCategory(id))) return notFound('No such category.');
    await deleteCategory(id);
    return json({ ok: true });
  });
