import type { APIRoute } from 'astro';
import { createLocation, getLocation, listLocations } from '../../../../lib/db';
import { handle, json, parseJson } from '../../../../lib/api';
import { createLocationSchema } from '../../../../lib/schemas';

export const prerender = false;

export const GET: APIRoute = () => handle(async () => json({ locations: await listLocations() }));

export const POST: APIRoute = ({ request }) =>
  handle(async () => {
    const input = await parseJson(request, createLocationSchema);
    const id = await createLocation(input);
    return json({ location: await getLocation(id) }, 201);
  });
