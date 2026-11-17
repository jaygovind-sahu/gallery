import type { APIRoute } from 'astro';
import { suggest } from '../../../../lib/ai';
import { handle, json, parseJson } from '../../../../lib/api';
import { getLocation, listCategories } from '../../../../lib/db';
import { suggestSchema } from '../../../../lib/schemas';

export const prerender = false;

/**
 * Titles, captions in each tone and hashtags for one photo. The browser sends a downscaled copy of the
 * image; nothing is stored here, the admin UI saves what the owner keeps.
 */
export const POST: APIRoute = ({ request, url }) =>
  handle(async () => {
    const input = await parseJson(request, suggestSchema);
    const [categories, location] = await Promise.all([listCategories(), input.locationId ? getLocation(input.locationId) : null]);
    const result = await suggest(
      url,
      { data: input.image, mediaType: input.mediaType },
      {
        subject: input.subject,
        takenAt: input.takenAt,
        // The place name and region only: GPS coordinates never leave the Worker.
        location: location ? { name: location.name, region: location.region } : null,
        categoryNames: categories.filter((c) => input.categoryIds.includes(c.id)).map((c) => c.name),
        allCategories: categories.map((c) => ({ id: c.id, name: c.name })),
        camera: input.camera,
        lens: input.lens,
        focalLengthMm: input.focalLengthMm,
        keywords: input.keywords,
      },
    );
    return json(result);
  });
