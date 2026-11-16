import { describe, expect, it, beforeAll } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { extractAccessToken, verifyAccessJwt } from '../../src/lib/auth';

const teamDomain = 'example.cloudflareaccess.com';
const aud = 'abc123aud';
const ownerEmail = 'owner@example.com';

let getKey: JWTVerifyGetKey;
let sign: (claims: Record<string, unknown>, opts?: { exp?: string; aud?: string; otherKey?: boolean }) => Promise<string>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  getKey = createLocalJWKSet({ keys: [jwk] });
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(`https://${teamDomain}`)
      .setAudience(opts.aud ?? aud)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '10m')
      .sign(opts.otherKey ? other.privateKey : privateKey);
});

const config = () => ({ teamDomain, aud, ownerEmail, getKey });

describe('verifyAccessJwt', () => {
  it('accepts a valid token for the owner', async () => {
    const token = await sign({ email: ownerEmail });
    expect(await verifyAccessJwt(token, config())).toEqual({ ok: true, email: ownerEmail });
  });

  it('compares email case-insensitively', async () => {
    const token = await sign({ email: 'Owner@Example.com' });
    expect((await verifyAccessJwt(token, config())).ok).toBe(true);
  });

  it('rejects a missing token', async () => {
    expect(await verifyAccessJwt(null, config())).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyAccessJwt('', config())).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects an expired token', async () => {
    const token = await sign({ email: ownerEmail }, { exp: '-5m' });
    expect(await verifyAccessJwt(token, config())).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects the wrong audience', async () => {
    const token = await sign({ email: ownerEmail }, { aud: 'someone-elses-app' });
    expect(await verifyAccessJwt(token, config())).toEqual({ ok: false, reason: 'wrong-aud' });
  });

  it('rejects another email', async () => {
    const token = await sign({ email: 'intruder@example.com' });
    expect(await verifyAccessJwt(token, config())).toEqual({ ok: false, reason: 'wrong-email' });
  });

  it('rejects a token without an email claim', async () => {
    const token = await sign({});
    expect(await verifyAccessJwt(token, config())).toEqual({ ok: false, reason: 'wrong-email' });
  });

  it('rejects a bad signature', async () => {
    const token = await sign({ email: ownerEmail }, { otherKey: true });
    expect(await verifyAccessJwt(token, config())).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects garbage', async () => {
    expect(await verifyAccessJwt('not.a.jwt', config())).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('extractAccessToken', () => {
  it('prefers the Access header', () => {
    const req = new Request('https://x/admin', { headers: { 'cf-access-jwt-assertion': 'h', cookie: 'CF_Authorization=c' } });
    expect(extractAccessToken(req)).toBe('h');
  });
  it('falls back to the CF_Authorization cookie', () => {
    const req = new Request('https://x/admin', { headers: { cookie: 'a=1; CF_Authorization=tok; b=2' } });
    expect(extractAccessToken(req)).toBe('tok');
  });
  it('returns null when absent', () => {
    expect(extractAccessToken(new Request('https://x/admin'))).toBeNull();
  });
});
