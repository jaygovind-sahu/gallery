import type { APIRoute } from 'astro';
import { handle, json, parseJson } from '../../../../lib/api';
import { findDuplicatePhotos, type DuplicateMatch } from '../../../../lib/db';
import { duplicatesSchema } from '../../../../lib/schemas';

export const prerender = false;

/** For files about to be uploaded: which ones look like photos already in the library. */
export const POST: APIRoute = ({ request }) =>
  handle(async () => {
    const { files } = await parseJson(request, duplicatesSchema);
    const matches: Record<string, DuplicateMatch[]> = {};
    for (const f of files) {
      const found = await findDuplicatePhotos(f);
      if (found.length) matches[f.key] = found;
    }
    return json({ matches });
  });
