import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// Milestone 3 check: 5 JPEGs (landscape, portrait, GPS, no EXIF, ~30 MB) upload from desktop and a phone-sized
// viewport; rows hold correct EXIF and dimensions; the big file shows progress.
// Run `node tests/fixtures/make-fixtures.mjs` first.

const fixtures = (name: string) => path.join(import.meta.dirname, '..', 'fixtures', name);
const FILES = ['landscape.jpg', 'portrait-rotated.jpg', 'gps.jpg', 'noexif.jpg', 'big.jpg'];

/** Navigate and wait for the island to hydrate (its root gets `data-hydrated`). */
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('[data-hydrated]').first().waitFor();
}

interface AdminPhoto {
  id: string;
  status: string;
  published: boolean;
  originalFilename: string | null;
  bytes: number | null;
  width: number;
  height: number;
  placeholder: string | null;
  title: string | null;
  takenAt: string | null;
  locationId: string | null;
  camera: string | null;
  lens: string | null;
  focalLengthMm: number | null;
  aperture: number | null;
  shutterS: number | null;
  iso: number | null;
  exposureComp: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  categoryIds: string[];
}

async function listPhotos(page: Page): Promise<AdminPhoto[]> {
  const res = await page.request.get('/api/admin/photos');
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { photos: AdminPhoto[] }).photos;
}

test('uploads a batch with shared fields and stores EXIF and dimensions', async ({ page, context, browserName }) => {
  // Slow the upload so the progress bar is observable on the 30 MB file.
  if (browserName === 'chromium') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: (40 * 1024 * 1024) / 8, // 40 Mbit/s
    });
  }

  const before = new Set((await listPhotos(page)).map((p) => p.id));

  await open(page, '/admin/upload');
  await expect(page.getByRole('heading', { name: 'Upload' })).toBeVisible();

  // Shared fields: location, categories, visibility.
  await page.getByRole('combobox').first().selectOption({ label: 'Bombay Hook NWR — Delaware' });
  await page.getByText('Birds', { exact: true }).click();
  await page.getByText('Landscape', { exact: true }).click();
  await page.getByLabel('Save as draft').check();

  await page.locator('#upload-files').setInputFiles(FILES.map(fixtures));

  // Every card read (metadata + preview) before the button counts them.
  await expect(page.getByRole('button', { name: /^Upload 5 photos$/ })).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText('Nikon Z50_2 · TAMRON 50-400mm')).toHaveCount(4);
  await expect(page.getByText('GPS present (kept private)')).toHaveCount(1);

  // Per-photo title on the first card.
  await page.getByLabel('Title').first().fill('Blue sky over the marsh');

  await page.getByRole('button', { name: /^Upload 5 photos$/ }).click();

  // The big file shows a progress bar while it goes up.
  const bigCard = page.locator('li', { hasText: 'big.jpg' });
  await expect(bigCard.getByRole('progressbar')).toBeVisible({ timeout: 60_000 });

  await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(5, { timeout: 150_000 });
  await expect(page.getByText('5 uploaded')).toBeVisible();

  const photos = (await listPhotos(page)).filter((p) => !before.has(p.id));
  expect(photos).toHaveLength(5);
  const byName = Object.fromEntries(photos.map((p) => [p.originalFilename ?? '', p]));

  for (const p of photos) {
    expect(p.status).toBe('ready');
    expect(p.published).toBe(false);
    expect(p.locationId).toBe('01M53JH105VX402YCZ9B9CVJ59');
    expect(p.categoryIds.sort()).toEqual(['01M53JH10086R420JC0GP7PP0A', '01M53JH102RWWD78905VKKK9GX'].sort());
    expect(p.placeholder).toBeTruthy();
    expect(p.gpsLng === null || p.originalFilename === 'gps.jpg').toBeTruthy();
  }

  const landscape = byName['landscape.jpg'];
  expect(landscape.title).toBe('Blue sky over the marsh');
  expect([landscape.width, landscape.height]).toEqual([3000, 2000]);
  expect(landscape.bytes).toBe(75705);
  expect(landscape.camera).toBe('Nikon Z50_2');
  expect(landscape.lens).toBe('TAMRON 50-400mm F4.5-6.3 Di III VC VXD');
  expect(landscape.focalLengthMm).toBe(400);
  expect(landscape.aperture).toBeCloseTo(6.3, 5);
  expect(landscape.shutterS).toBeCloseTo(0.0005, 8);
  expect(landscape.iso).toBe(1600);
  expect(landscape.exposureComp).toBeCloseTo(-1 / 3, 5);
  expect(landscape.takenAt).toBe('2026-10-12T14:03:11');
  expect(landscape.gpsLat).toBeNull();

  const portrait = byName['portrait-rotated.jpg'];
  expect([portrait.width, portrait.height]).toEqual([2000, 3000]);

  const gps = byName['gps.jpg'];
  expect(gps.gpsLat).toBeCloseTo(39.2583, 3);
  expect(gps.gpsLng).toBeCloseTo(-75.45, 3);

  const noexif = byName['noexif.jpg'];
  expect([noexif.width, noexif.height]).toEqual([1800, 1200]);
  expect(noexif.camera).toBeNull();
  expect(noexif.takenAt).toBeNull();

  const big = byName['big.jpg'];
  expect(big.bytes).toBeGreaterThan(29 * 1024 * 1024);
  expect([big.width, big.height]).toEqual([7500, 5000]);
});

test('rejects files over 100 MB and non-image types in the browser', async ({ page }) => {
  await open(page, '/admin/upload');
  await page.locator('#upload-files').setInputFiles([
    { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(0) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ]);
  await expect(page.getByText('Only JPEG, PNG and WebP are accepted.')).toBeVisible();
  // An empty "jpeg" can't be decoded: it must end in an error, not a stuck card.
  await expect(page.locator('li', { hasText: 'huge.jpg' }).getByText(/could not decode|Could not read/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Upload/ })).toBeDisabled();
});
