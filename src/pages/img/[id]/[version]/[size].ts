import type { APIRoute } from 'astro';
import { env, waitUntil } from 'cloudflare:workers';
import { getImageSource } from '../../../../lib/db';
import { cacheKey, isImagesQuotaError, parseSize, parseVersion, pickFormat, PUBLIC_IMAGE_HEADERS, transformOriginal } from '../../../../lib/images';

export const prerender = false;

/**
 * Public image route: GET /img/<photoId>/v<version>/<size> (docs/DESIGN.md, "Image storage & delivery").
 * Allowlisted sizes only; the photo must be ready and published and the version must match, else 404.
 * The D1 lookup runs on every request so an unpublished or deleted photo stops serving at once;
 * the transformed bytes come from the edge cache after the first request per (photo, version, size, format).
 */
export const GET: APIRoute = async ({ params, request }) => {
  const size = parseSize(params.size);
  const version = parseVersion(params.version);
  const id = params.id ?? '';
  if (!size || !version || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return notFound();

  const photo = await getImageSource(id);
  if (!photo || photo.status !== 'ready' || !photo.published || photo.version !== version) return notFound();

  const format = pickFormat(request.headers.get('accept'));
  const key = cacheKey(id, version, size, format);
  const cache = edgeCache();
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return hit;
  }

  const object = await env.ORIGINALS.get(photo.r2Key);
  if (!object) return notFound();

  let out: Response;
  try {
    out = await transformOriginal({
      images: env.IMAGES,
      body: object.body,
      size,
      format,
      watermark: photo.watermark,
      width: photo.width,
      height: photo.height,
      loadWatermark: () => loadWatermark(request),
    });
  } catch (err) {
    if (isImagesQuotaError(err)) {
      console.error(`images quota exhausted (9422) serving ${id} v${version} ${size}`);
      return new Response('Image service temporarily unavailable', {
        status: 503,
        headers: { 'cache-control': 'no-store', 'retry-after': '3600', 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    console.error('image transform failed', err);
    if (isProduction(request)) {
      return new Response('Image service unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
    }
    // Dev only: the local Images binding can't transform everything; serve the original bytes, never cached.
    const again = await env.ORIGINALS.get(photo.r2Key);
    if (!again) return notFound();
    return new Response(again.body, {
      status: 200,
      headers: { 'cache-control': 'no-store', 'content-disposition': 'inline', 'content-type': photo.mime },
    });
  }

  const headers = new Headers();
  headers.set('content-type', out.headers.get('content-type') || format);
  for (const [k, v] of Object.entries(PUBLIC_IMAGE_HEADERS)) headers.set(k, v);
  const response = new Response(out.body, { status: 200, headers });

  if (cache) waitUntil(cache.put(key, response.clone()).catch((err) => console.warn('edge cache put failed', err)));
  return response;
};

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });
}

function edgeCache(): Cache | null {
  try {
    // The Workers runtime exposes `caches.default`; the DOM lib's CacheStorage type doesn't know it.
    return typeof caches === 'undefined' ? null : ((caches as unknown as { default?: Cache }).default ?? null);
  } catch {
    return null;
  }
}

function isProduction(request: Request): boolean {
  try {
    return new URL(request.url).hostname === new URL(env.SITE_URL).hostname;
  } catch {
    return true;
  }
}

/** The watermark PNG is a static asset; fetched once per isolate through the ASSETS binding (plain fetch in dev). */
let watermarkBytes: Promise<ArrayBuffer | null> | undefined;

async function loadWatermark(request: Request): Promise<ReadableStream<Uint8Array> | null> {
  watermarkBytes ??= fetchWatermark(request).catch((err) => {
    console.error('could not load watermark.png', err);
    watermarkBytes = undefined;
    return null;
  });
  const buf = await watermarkBytes;
  return buf ? (new Response(buf).body as ReadableStream<Uint8Array>) : null;
}

async function fetchWatermark(request: Request): Promise<ArrayBuffer | null> {
  const url = new URL('/watermark.png', request.url);
  const assets = (env as unknown as { ASSETS?: { fetch: typeof fetch } }).ASSETS;
  const res = assets ? await assets.fetch(new Request(url.toString())) : await fetch(url.toString());
  if (!res.ok) throw new Error(`watermark.png responded ${res.status}`);
  return res.arrayBuffer();
}
