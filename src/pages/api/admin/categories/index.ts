import type { APIRoute } from 'astro';
import { createCategory, getAdminCategory, listAdminCategories, reorderCategories } from '../../../../lib/db';
import { handle, json, parseJson } from '../../../../lib/api';
import { createCategorySchema, reorderCategoriesSchema } from '../../../../lib/schemas';

export const prerender = false;

export const GET: APIRoute = () => handle(async () => json({ categories: await listAdminCategories() }));

export const POST: APIRoute = ({ request }) =>
  handle(async () => {
    const input = await parseJson(request, createCategorySchema);
    const id = await createCategory(input);
    return json({ category: await getAdminCategory(id) }, 201);
  });

/** Reorder: `{ ids }` in the wanted order; positions become 1..n. */
export const PATCH: APIRoute = ({ request }) =>
  handle(async () => {
    const { ids } = await parseJson(request, reorderCategoriesSchema);
    await reorderCategories(ids);
    return json({ categories: await listAdminCategories() });
  });
