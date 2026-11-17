/**
 * Guards /admin and /api/admin with the Cloudflare Access JWT check and sets per-route headers.
 * See docs/DESIGN.md, "Auth & security".
 */
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { extractAccessToken, verifyAccessJwt } from './lib/auth';
import { isProductionHost } from './lib/host';

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/');
}

/** DEV_BYPASS_AUTH=1 skips the check, but never on the production hostname. */
function devBypassAllowed(url: URL): boolean {
  return env.DEV_BYPASS_AUTH === '1' && !isProductionHost(url.hostname, env.SITE_URL);
}

function forbidden(pathname: string, reason: string): Response {
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: { code: 'forbidden', message: `Access denied (${reason}).` } }), {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response('Forbidden', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const admin = isAdminPath(url.pathname);

  if (admin) {
    if (devBypassAllowed(url)) {
      context.locals.adminEmail = env.OWNER_EMAIL || 'dev';
    } else {
      const ownerEmail = env.OWNER_EMAIL;
      if (!ownerEmail) return forbidden(url.pathname, 'owner not configured');
      const result = await verifyAccessJwt(extractAccessToken(context.request), {
        teamDomain: env.ACCESS_TEAM_DOMAIN,
        aud: env.ACCESS_AUD,
        ownerEmail,
      });
      if (!result.ok) return forbidden(url.pathname, result.reason);
      context.locals.adminEmail = result.email;
    }
  }

  const response = await next();

  // Immutable responses (e.g. redirects built by Astro) can't take headers; copy them if so.
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  if (admin) {
    headers.set('cache-control', 'no-store');
    headers.set('x-robots-tag', 'noindex');
  } else if (
    context.request.method === 'GET' &&
    response.status === 200 &&
    !headers.has('cache-control') &&
    (headers.get('content-type') ?? '').startsWith('text/html')
  ) {
    // Public pages: edge-cached for a minute so admin changes show within about that long.
    headers.set('cache-control', 'public, s-maxage=60, stale-while-revalidate=600');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
