import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// Milestone 6 checks: library bulk actions, edit page, replace (version bump), drag reorder, covers,
// category and location managers, delete. Needs the fixtures from `pnpm fixtures`.

const fixture = (name: string) => path.join(import.meta.dirname, '..', 'fixtures', name);
const BIRDS = '01M53JH10086R420JC0GP7PP0A';
const MACRO = '01M53JH101GBT8R4DRSB8RYHZR';

/** Navigate and wait for the island to hydrate (its root gets `data-hydrated`). */
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('[data-hydrated]').first().waitFor();
}

interface Photo {
  id: string;
  version: number;
  published: boolean;
  title: string | null;
  categoryIds: string[];
  locationId: string | null;
  width: number;
  height: number;
}

async function createPhoto(page: Page, name: string, extra: Record<string, unknown> = {}): Promise<Photo> {
  const res = await page.request.post('/api/admin/photos', {
    data: { originalFilename: name, mime: 'image/jpeg', bytes: 1, width: 3000, height: 2000, title: name, categoryIds: [BIRDS], published: true, ...extra },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const put = await page.request.put(`/api/admin/photos/${id}/original`, {
    headers: { 'content-type': 'image/jpeg' },
    data: await import('node:fs/promises').then((fs) => fs.readFile(fixture('landscape.jpg'))),
  });
  expect(put.ok()).toBeTruthy();
  return getPhoto(page, id);
}

async function getPhoto(page: Page, id: string): Promise<Photo> {
  const res = await page.request.get(`/api/admin/photos/${id}`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { photo: Photo }).photo;
}

const stamp = () => Date.now().toString(36);

test('library: filters, selection and bulk actions', async ({ page }) => {
  const tag = stamp();
  const a = await createPhoto(page, `lib-a-${tag}`);
  const b = await createPhoto(page, `lib-b-${tag}`, { published: false });

  await open(page, '/admin?status=draft');
  // Links, not text: the Astro dev toolbar echoes island props as text too.
  await expect(page.getByRole('link', { name: `lib-b-${tag}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `lib-a-${tag}` })).toHaveCount(0);

  await page.getByLabel('Status').selectOption({ label: 'All' });
  await expect(page.getByRole('link', { name: `lib-a-${tag}` })).toBeVisible();

  await page.getByLabel(`Select lib-a-${tag}`).check();
  await page.getByLabel(`Select lib-b-${tag}`).check();
  await expect(page.getByText('2 selected')).toBeVisible();

  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect.poll(async () => (await getPhoto(page, a.id)).published).toBe(false);

  await page.getByLabel('Add to category…').selectOption(MACRO);
  await expect.poll(async () => (await getPhoto(page, b.id)).categoryIds.sort()).toEqual([BIRDS, MACRO].sort());

  await page.getByLabel('Set location…').selectOption({ label: 'Marsh Creek State Park' });
  await expect.poll(async () => (await getPhoto(page, a.id)).locationId).toBe('01M53JH106D6B49CG33N0NQ49V');

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await page.request.get(`/api/admin/photos/${a.id}`)).status()).toBe(404);
  await expect.poll(async () => (await page.request.get(`/api/admin/photos/${b.id}`)).status()).toBe(404);
});

test('edit page: save fields, replace original bumps the version, delete removes the row', async ({ page }) => {
  const tag = stamp();
  const p = await createPhoto(page, `edit-${tag}`);

  await open(page, `/admin/photos/${p.id}`);
  await expect(page.getByRole('heading', { name: `edit-${tag}` })).toBeVisible();
  await expect(page.getByRole('img', { name: `edit-${tag}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View on site' })).toHaveAttribute('href', `/p/${p.id}`);

  await page.getByLabel('Title').fill('Heron at dawn');
  await page.getByLabel('Caption').fill('Waiting for fish.');
  await page.getByLabel('Shutter (s)').fill('1/2000');
  await page.getByLabel('Aperture (f/)').fill('6.3');
  await page.getByLabel('ISO').fill('1600');
  await page.getByText('Macro', { exact: true }).click();
  await page.getByLabel('Published').uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');

  const saved = await getPhoto(page, p.id);
  expect(saved.title).toBe('Heron at dawn');
  expect(saved.published).toBe(false);
  expect(saved.categoryIds.sort()).toEqual([BIRDS, MACRO].sort());
  const full = (await (await page.request.get(`/api/admin/photos/${p.id}`)).json()) as { photo: { shutterS: number; aperture: number; iso: number; caption: string } };
  expect(full.photo.shutterS).toBeCloseTo(0.0005, 8);
  expect(full.photo.aperture).toBeCloseTo(6.3, 5);
  expect(full.photo.iso).toBe(1600);
  expect(full.photo.caption).toBe('Waiting for fish.');
  await expect(page.getByText('Not public')).toBeVisible();

  // Replace with the rotated portrait: version 2, new dimensions, title kept.
  await page.getByLabel('Replace original…').setInputFiles(fixture('portrait-rotated.jpg'));
  await page.waitForURL(`/admin/photos/${p.id}`);
  await expect.poll(async () => (await getPhoto(page, p.id)).version).toBe(2);
  const replaced = await getPhoto(page, p.id);
  expect([replaced.width, replaced.height]).toEqual([2000, 3000]);
  expect(replaced.title).toBe('Heron at dawn');
  await expect(page.getByText(/image\/jpeg · v2$/)).toBeVisible();
  const img = await page.request.get(`/api/admin/img/${p.id}/480`);
  expect(img.ok()).toBeTruthy();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.waitForURL('/admin');
  expect((await page.request.get(`/api/admin/photos/${p.id}`)).status()).toBe(404);
});

test('categories: create, rename, reorder, cover, drag-reorder photos, delete', async ({ page, isMobile }) => {
  const tag = stamp();
  const cat = (await (
    await page.request.post('/api/admin/categories', { data: { name: `Trips ${tag}`, defaultLayout: 'masonry' } })
  ).json()) as { category: { id: string; slug: string } };
  const catId = cat.category.id;
  const photos: Photo[] = [];
  for (const n of ['one', 'two', 'three']) photos.push(await createPhoto(page, `cat-${n}-${tag}`, { categoryIds: [catId] }));

  await open(page, '/admin/categories');
  const row = page.getByRole('listitem').filter({ has: page.getByLabel(`Move Trips ${tag} up`) });
  await expect(row).toBeVisible();
  await row.getByLabel('Name').fill(`Travel ${tag}`);
  await row.getByLabel('Default layout').selectOption('grid');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.getByRole('button', { name: `Move Travel ${tag} up` }).click();
  await expect(page.getByRole('status')).toHaveText('Order saved');
  const list = (await (await page.request.get('/api/admin/categories')).json()) as { categories: Array<{ id: string; name: string; defaultLayout: string; position: number }> };
  const mine = list.categories.find((c) => c.id === catId)!;
  expect(mine.name).toBe(`Travel ${tag}`);
  expect(mine.defaultLayout).toBe('grid');
  expect(list.categories.findIndex((c) => c.id === catId)).toBe(list.categories.length - 2);

  // Photo order + cover.
  await open(page, `/admin/categories/${catId}`);
  await expect(page.getByText('3 photos')).toBeVisible();
  const tiles = page.locator('ol > li');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.nth(0)).toContainText(`cat-one-${tag}`);

  // dnd-kit adds its own live region with role=status, so target ours.
  const gridStatus = page.locator('p[role="status"]');
  await tiles.nth(2).getByRole('button', { name: 'Set as cover' }).click();
  await expect(gridStatus).toHaveText('Cover saved');
  await expect.poll(async () => ((await (await page.request.get(`/api/admin/categories/${catId}`)).json()) as { category: { coverPhotoId: string } }).category.coverPhotoId).toBe(photos[2].id);

  if (!isMobile) {
    // Drag the third tile onto the first with the mouse (dnd-kit needs real pointer movement).
    const handle = tiles.nth(2).getByLabel(/^Move/);
    const target = tiles.nth(0).getByLabel(/^Move/);
    const from = (await handle.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(gridStatus).toHaveText('Order saved');
    await expect(tiles.nth(0)).toContainText(`cat-three-${tag}`);
    const ordered = (await (await page.request.get(`/api/admin/categories/${catId}`)).json()) as { photos: Array<{ id: string }> };
    expect(ordered.photos.map((p) => p.id)).toEqual([photos[2].id, photos[0].id, photos[1].id]);
  }

  // Delete the category; photos survive.
  await open(page, '/admin/categories');
  page.once('dialog', (d) => d.accept());
  await page
    .getByRole('listitem')
    .filter({ has: page.getByLabel(`Move Travel ${tag} up`) })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByRole('status')).toHaveText('Deleted');
  expect((await page.request.get(`/api/admin/categories/${catId}`)).status()).toBe(404);
  expect((await getPhoto(page, photos[0].id)).categoryIds).toEqual([]);
  await page.request.post('/api/admin/photos/bulk', { data: { action: 'delete', ids: photos.map((p) => p.id) } });
});

test('locations: create, rename, merge, delete', async ({ page }) => {
  const tag = stamp();
  await open(page, '/admin/locations');
  await page.getByPlaceholder('Name').fill(`Hawk Mtn ${tag}`);
  await page.getByPlaceholder('Pennsylvania').fill('PA');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('status')).toHaveText('Created');

  const row = page.getByRole('listitem').filter({ has: page.getByLabel(`Merge Hawk Mtn ${tag} into`) });
  await row.getByLabel('Name').fill(`Hawk Mountain ${tag}`);
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');

  const locations = (await (await page.request.get('/api/admin/locations')).json()) as { locations: Array<{ id: string; name: string; region: string | null }> };
  const mine = locations.locations.find((l) => l.name === `Hawk Mountain ${tag}`)!;
  expect(mine.region).toBe('PA');

  const photo = await createPhoto(page, `loc-${tag}`, { locationId: mine.id });
  const second = (await (await page.request.post('/api/admin/locations', { data: { name: `Second ${tag}` } })).json()) as { location: { id: string } };

  await open(page, page.url());
  page.once('dialog', (d) => d.accept());
  await page.getByLabel(`Merge Hawk Mountain ${tag} into`).selectOption(second.location.id);
  await expect(page.getByRole('status')).toHaveText('Merged');
  expect((await getPhoto(page, photo.id)).locationId).toBe(second.location.id);

  page.once('dialog', (d) => d.accept());
  await page
    .getByRole('listitem')
    .filter({ has: page.getByLabel(`Merge Second ${tag} into`) })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByRole('status')).toHaveText('Deleted');
  expect((await getPhoto(page, photo.id)).locationId).toBeNull();
  await page.request.delete(`/api/admin/photos/${photo.id}`);
});
