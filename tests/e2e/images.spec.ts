import { expect, test, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Milestone 4 checks: every size returns AVIF to a modern browser and WebP otherwise; a portrait photo is
// portrait; derivatives carry no metadata; a disallowed size, wrong version or unpublished id is a 404.
// The watermark check needs the real Images service (REMOTE_IMAGES=1, see README): the local binding ignores draw().
// Needs the fixtures from `pnpm fixtures`.

const fixture = (name: string) => path.join(import.meta.dirname, '..', 'fixtures', name);
const BIRDS = '01M53JH10086R420JC0GP7PP0A';
const SIZES = [480, 768, 1080, 1600, 2400] as const;
const AVIF = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const WEBP = 'image/webp,image/apng,image/*,*/*;q=0.8';

interface Fixture {
  file: string;
  width: number;
  height: number;
  orientation?: number;
}

async function createPhoto(request: APIRequestContext, f: Fixture, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await request.post('/api/admin/photos', {
    data: { originalFilename: f.file, mime: 'image/jpeg', bytes: 1, width: f.width, height: f.height, title: `img-${f.file}`, categoryIds: [BIRDS], published: true, ...extra },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const put = await request.put(`/api/admin/photos/${id}/original`, {
    headers: { 'content-type': 'image/jpeg', ...(f.orientation ? { 'x-exif-orientation': String(f.orientation) } : {}) },
    data: await readFile(fixture(f.file)),
  });
  expect(put.ok()).toBeTruthy();
  return id;
}

async function derivative(request: APIRequestContext, id: string, size: number, accept: string, version = 1) {
  const res = await request.get(`/img/${id}/v${version}/${size}`, { headers: { accept } });
  return { res, body: res.ok() ? await res.body() : Buffer.alloc(0) };
}

/** Mean brightness of a box in one bottom corner (the fixture's ground is flat there; only a watermark changes it). */
async function cornerBrightness(buf: Buffer, corner: 'left' | 'right'): Promise<number> {
  const img = sharp(buf);
  const { width = 0, height = 0 } = await img.metadata();
  const w = Math.round(width * 0.22);
  const h = Math.round(height * 0.08);
  const { data } = await img
    .extract({ left: corner === 'right' ? width - w : 0, top: height - h, width: w, height: h })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const b of data) sum += b;
  return sum / data.length;
}

test.describe('public image route', () => {
  const ids: string[] = [];
  let landscape = '';
  let portrait = '';
  let gps = '';

  test.beforeAll(async ({ request }) => {
    landscape = await createPhoto(request, { file: 'landscape.jpg', width: 3000, height: 2000 });
    portrait = await createPhoto(request, { file: 'portrait-rotated.jpg', width: 2000, height: 3000, orientation: 6 });
    gps = await createPhoto(request, { file: 'gps.jpg', width: 2400, height: 1600, gpsLat: 39.26, gpsLng: -75.45 });
    ids.push(landscape, portrait, gps);
  });

  test.afterAll(async ({ request }) => {
    for (const id of ids) await request.delete(`/api/admin/photos/${id}`);
  });

  test('every size negotiates AVIF or WebP and is cached as immutable', async ({ request }) => {
    for (const size of SIZES) {
      const avif = await derivative(request, landscape, size, AVIF);
      expect(avif.res.status(), `${size} avif`).toBe(200);
      expect(avif.res.headers()['content-type']).toBe('image/avif');
      expect(avif.res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(avif.res.headers()['vary']).toBe('Accept');
      expect(avif.res.headers()['content-disposition']).toBe('inline');

      const meta = await sharp(avif.body).metadata();
      expect(meta.format).toBe('heif');
      // Long edge = the requested size, never upscaled past the 3000 px original.
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(Math.min(size, 3000));

      const webp = await derivative(request, landscape, size, WEBP);
      expect(webp.res.status(), `${size} webp`).toBe(200);
      expect(webp.res.headers()['content-type']).toBe('image/webp');
      expect((await sharp(webp.body).metadata()).format).toBe('webp');
    }
  });

  test('a portrait photo comes out portrait and derivatives carry no metadata', async ({ request }) => {
    const p = await derivative(request, portrait, 1600, WEBP);
    const pm = await sharp(p.body).metadata();
    expect(pm.height).toBe(1600);
    expect(pm.width).toBeLessThan(pm.height ?? 0);

    for (const size of [480, 1600] as const) {
      const g = await derivative(request, gps, size, WEBP);
      const gm = await sharp(g.body).metadata();
      expect(gm.exif, `${size} exif`).toBeUndefined();
      expect(gm.xmp, `${size} xmp`).toBeUndefined();
      expect(gm.iptc, `${size} iptc`).toBeUndefined();
    }
  });

  test('watermark on 1600 and up, none on 1080', async ({ request }) => {
    test.skip(!process.env.REMOTE_IMAGES, 'the local Images binding ignores draw(); run with REMOTE_IMAGES=1 (README)');
    const plain = await derivative(request, landscape, 1080, WEBP);
    expect(await cornerBrightness(plain.body, 'right')).toBeCloseTo(await cornerBrightness(plain.body, 'left'), 0);
    for (const size of [1600, 2400] as const) {
      const marked = await derivative(request, landscape, size, WEBP);
      const left = await cornerBrightness(marked.body, 'left');
      const right = await cornerBrightness(marked.body, 'right');
      expect(right - left, `${size} watermark`).toBeGreaterThan(3);
    }
  });

  test('disallowed size, wrong version, draft, unknown id and unpublished photos are 404', async ({ request }) => {
    for (const url of [`/img/${landscape}/v1/500`, `/img/${landscape}/v1/1200`, `/img/${landscape}/v1/3200`, `/img/${landscape}/v2/480`, `/img/${landscape}/v01/480`, `/img/${landscape}/1/480`, `/img/${BIRDS}/v1/480`, '/img/nope/v1/480']) {
      const res = await request.get(url, { headers: { accept: AVIF } });
      expect(res.status(), url).toBe(404);
    }

    const draft = await createPhoto(request, { file: 'noexif.jpg', width: 1800, height: 1200 }, { published: false });
    ids.push(draft);
    expect((await request.get(`/img/${draft}/v1/480`)).status()).toBe(404);

    // Unpublishing stops every size at once (the row is read on every request).
    expect((await request.get(`/img/${gps}/v1/480`)).status()).toBe(200);
    const patch = await request.patch(`/api/admin/photos/${gps}`, { data: { published: false } });
    expect(patch.ok()).toBeTruthy();
    expect((await request.get(`/img/${gps}/v1/480`)).status()).toBe(404);
    expect((await request.get(`/img/${gps}/v1/1600`)).status()).toBe(404);
  });
});
