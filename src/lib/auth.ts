/**
 * Cloudflare Access JWT verification (docs/DESIGN.md, "Auth & security").
 *
 * Access signs a JWT for every request that passes its login. The Worker checks it again so
 * the admin never relies on the path merely being "behind" Access:
 *   - signature against https://<team>.cloudflareaccess.com/cdn-cgi/access/certs (keys cached)
 *   - `aud` equals the Access application's AUD tag
 *   - `exp` not passed (jose enforces this)
 *   - `email` claim equals OWNER_EMAIL
 */
import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey } from 'jose';

export interface AccessConfig {
  /** e.g. "myteam.cloudflareaccess.com" */
  teamDomain: string;
  /** The Access application's AUD tag. */
  aud: string;
  /** The only email allowed in. */
  ownerEmail: string;
  /** Override the key source (tests pass a local JWK set). */
  getKey?: JWTVerifyGetKey;
}

export type AccessResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'missing' | 'expired' | 'wrong-aud' | 'wrong-email' | 'invalid' };

export function certsUrl(teamDomain: string): URL {
  return new URL(`https://${teamDomain}/cdn-cgi/access/certs`);
}

const keySets = new Map<string, JWTVerifyGetKey>();

/** One remote JWK set per team domain, cached for the Worker's lifetime (jose also caches keys). */
function remoteKeys(teamDomain: string): JWTVerifyGetKey {
  let set = keySets.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(certsUrl(teamDomain), { cacheMaxAge: 600_000 });
    keySets.set(teamDomain, set);
  }
  return set;
}

export async function verifyAccessJwt(token: string | null | undefined, config: AccessConfig): Promise<AccessResult> {
  if (!token) return { ok: false, reason: 'missing' };
  const getKey = config.getKey ?? remoteKeys(config.teamDomain);
  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: `https://${config.teamDomain}`,
      audience: config.aud,
    });
    const email = typeof payload.email === 'string' ? payload.email : '';
    if (!email || email.toLowerCase() !== config.ownerEmail.trim().toLowerCase()) {
      return { ok: false, reason: 'wrong-email' };
    }
    return { ok: true, email };
  } catch (err) {
    if (err instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
    if (err instanceof errors.JWTClaimValidationFailed && err.claim === 'aud') return { ok: false, reason: 'wrong-aud' };
    return { ok: false, reason: 'invalid' };
  }
}

/** Access sends the JWT as a header when proxying; the cookie is a fallback for direct navigation. */
export function extractAccessToken(request: Request): string | null {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;
  const cookie = request.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}
