import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAdminPhoto } from '../../../../../lib/db';
import { parseSize, pickFormat, transformOriginal } from '../../../../../lib/images';

export const prerender = false;

const NO_STORE = { 'cache-control': 'private, no-store', 'content-disposition': 'inline', vary: 'Accept' };

function isProduction(request: Request): boolean {
  try {
    return new URL(request.url).hostname === new URL(env.SITE_URL).hostname;
  } catch {
    return true;
  }
}

/** Private preview for drafts in the admin UI: same transform as /img, no publish check, no watermark, never cached. */
export const GET: APIRoute = async ({ params, request }) => {
  const size = parseSize(params.size);
  if (!size) return new Response('Not found', { status: 404, headers: NO_STORE });

  const photo = await getAdminPhoto(params.id ?? '');
  if (!photo) return new Response('Not found', { status: 404, headers: NO_STORE });

  const object = await env.ORIGINALS.get(photo.r2Key);
  if (!object) return new Response('Not found', { status: 404, headers: NO_STORE });

  const format = pickFormat(request.headers.get('accept'));
  try {
    const out = await transformOriginal({
      images: env.IMAGES,
      body: object.body,
      size,
      format,
      watermark: false,
      width: photo.width,
      height: photo.height,
    });
    const headers = new Headers(out.headers);
    for (const [k, v] of Object.entries(NO_STORE)) headers.set(k, v);
    if (!headers.get('content-type')) headers.set('content-type', format);
    return new Response(out.body, { status: 200, headers });
  } catch (err) {
    console.error('admin preview transform failed', err);
    if (isProduction(request)) return new Response('Image service unavailable', { status: 503, headers: NO_STORE });
    // Dev-only fallback when the local Images binding can't transform: serve the original bytes.
    const again = await env.ORIGINALS.get(photo.r2Key);
    if (!again) return new Response('Not found', { status: 404, headers: NO_STORE });
    return new Response(again.body, { status: 200, headers: { ...NO_STORE, 'content-type': photo.mime } });
  }
};
