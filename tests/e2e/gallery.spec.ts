import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Milestone 5 checks (docs/DESIGN.md, "Testing checklist → End to end"): published photos appear on their
// category page and in /all; the three layouts, persistence and ?layout=; the lightbox with /p/:id history;
// unpublishing 404s the page and the image URLs. Needs the fixtures from `pnpm fixtures`.

const fixture = (name: string) => path.join(import.meta.dirname, '..', 'fixtures', name);
const BIRDS = '01M53JH10086R420JC0GP7PP0A';
const MARSH = '01M53JH106D6B49CG33N0NQ49V';

async function createPhoto(request: APIRequestContext, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await request.post('/api/admin/photos', {
    data: { originalFilename: 'landscape.jpg', mime: 'image/jpeg', bytes: 1, width: 3000, height: 2000, title, categoryIds: [BIRDS], locationId: MARSH, published: true, ...extra },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const put = await request.put(`/api/admin/photos/${id}/original`, { headers: { 'content-type': 'image/jpeg' }, data: await readFile(fixture('landscape.jpg')) });
  expect(put.ok()).toBeTruthy();
  return id;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('[data-gallery][data-hydrated]').waitFor();
}

const tile = (page: Page, id: string) => page.locator(`[data-gallery] a.tile[href="/p/${id}"]`).first();

/** Loaded and faded in: TileImage keeps the <img> at opacity 0 over the placeholder until it knows it loaded. */
const isShown = (img: Locator) =>
  img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0 && getComputedStyle(el).opacity === '1');

test.describe('public gallery', () => {
  const ids: string[] = [];
  let a = '';
  let b = '';

  test.beforeAll(async ({ request }) => {
    const tag = Date.now().toString(36);
    a = await createPhoto(request, `gallery-a-${tag}`);
    b = await createPhoto(request, `gallery-b-${tag}`, { title: null });
    ids.push(a, b);
  });

  test.afterAll(async ({ request }) => {
    for (const id of ids) await request.delete(`/api/admin/photos/${id}`);
  });

  test('published photos appear on the category page, in /all, on the home page and at their location', async ({ page }) => {
    for (const url of ['/c/birds', '/all', '/', '/l/marsh-creek-state-park']) {
      await open(page, url);
      const link = tile(page, a);
      await expect(link, url).toBeVisible();
      const img = link.locator('img');
      await expect(img).toHaveAttribute('alt', /gallery-a-/);
      await expect(img).toHaveAttribute('width', '3000');
      await expect(img).toHaveAttribute('height', '2000');
      await expect(img).toHaveAttribute('srcset', new RegExp(`/img/${a}/v1/480 480w, /img/${a}/v1/768 768w, /img/${a}/v1/1080 1080w`));
      await expect.poll(() => isShown(img), { timeout: 30_000 }).toBe(true);
      // Untitled photo: the caption shows the location only.
      await expect(tile(page, b).locator('.tile-caption__location')).toHaveText('Marsh Creek State Park');
      await expect(tile(page, b).locator('.tile-caption__title')).toHaveCount(0);
      // No GPS or internal fields anywhere in the HTML.
      const html = await page.content();
      expect(html).not.toMatch(/gps|r2_key|r2Key|originals\//i);
    }
  });

  test('three layouts, the choice survives a reload and ?layout= overrides it', async ({ page }) => {
    await open(page, '/c/birds');
    const gallery = page.locator('[data-gallery]');
    await expect(gallery).toHaveAttribute('data-layout', 'rows');
    await expect(gallery.locator('.react-photo-album--rows').first()).toBeVisible();

    await page.getByRole('button', { name: 'Masonry' }).click();
    await expect(gallery).toHaveAttribute('data-layout', 'masonry');
    await expect(gallery.locator('.react-photo-album--masonry').first()).toBeVisible();
    await expect(page).toHaveURL(/\/c\/birds\?layout=masonry$/);

    await page.getByRole('button', { name: 'Grid' }).click();
    await expect(gallery).toHaveAttribute('data-layout', 'grid');
    await expect(gallery.locator('.tile-grid')).toBeVisible();
    await expect(page).toHaveURL(/\/c\/birds\?layout=grid$/);
    await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');

    // Reload without the param: the stored choice wins.
    await open(page, '/c/birds');
    await expect(gallery).toHaveAttribute('data-layout', 'grid');
    await open(page, '/all');
    await expect(gallery).toHaveAttribute('data-layout', 'grid');

    // The param wins over the stored choice.
    await open(page, '/c/birds?layout=masonry');
    await expect(gallery).toHaveAttribute('data-layout', 'masonry');
    await expect(page.getByRole('button', { name: 'Masonry' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Rows' }).click();
    await expect(page).toHaveURL(/\/c\/birds$/);
  });

  test('lightbox: open, arrow through, /p/:id in the URL, Back closes, direct load opens', async ({ page }) => {
    await open(page, '/c/birds');
    await tile(page, a).click();
    const lightbox = page.locator('.yarl__root');
    await expect(lightbox).toBeVisible();
    await expect(page).toHaveURL(`/p/${a}`);
    // The lightbox picks one of the large sizes for the viewport and pixel ratio.
    await expect(lightbox.locator('.yarl__slide_current img')).toHaveAttribute('src', new RegExp(`/img/${a}/v1/(1600|2400|3200)$`));

    await page.keyboard.press('ArrowRight');
    await expect(page).not.toHaveURL(`/p/${a}`);
    await expect(page).toHaveURL(/\/p\/[0-9A-Z]{26}$/);
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(`/p/${a}`);

    // Info panel on `i`.
    await page.keyboard.press('i');
    const info = page.locator('#lightbox-info');
    await expect(info).toBeVisible();
    await expect(info.getByRole('heading')).toHaveText(/gallery-a-/);
    await expect(info.getByRole('link', { name: 'Marsh Creek State Park' })).toHaveAttribute('href', '/l/marsh-creek-state-park');
    await page.keyboard.press('i');
    await expect(info).toBeHidden();

    await page.goBack();
    await expect(lightbox).toHaveCount(0);
    await expect(page).toHaveURL(/\/c\/birds$/);

    await page.keyboard.press('Escape'); // no lightbox: nothing happens
    await tile(page, b).click();
    await expect(page).toHaveURL(`/p/${b}`);
    await expect(lightbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    await expect(page).toHaveURL(/\/c\/birds$/);

    // Direct load of a permalink opens the lightbox over the category and sets Open Graph tags.
    await open(page, `/p/${a}`);
    await expect(lightbox).toBeVisible();
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', new RegExp(`/img/${a}/v1/1600$`));
    await expect(page.locator('h1').first()).toHaveText(/gallery-a-/);
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    await expect(page).toHaveURL(/\/c\/birds$/);
  });

  test('tiles show in every layout when images load before hydration or fail once', async ({ page }) => {
    // Photo a: answered at once, so it usually finishes before the island hydrates (as from the edge cache).
    // Photo b: the first request for each URL fails, as a cold derivative can; the tile must retry.
    const body = await readFile(fixture('landscape.jpg'));
    const failed = new Set<string>();
    await page.route('**/img/**', (route) => {
      const url = route.request().url();
      if (url.includes(`/img/${a}/`)) return route.fulfill({ status: 200, contentType: 'image/jpeg', body });
      if (url.includes(`/img/${b}/`) && !failed.has(url)) {
        failed.add(url);
        return route.fulfill({ status: 503, body: 'Image service unavailable' });
      }
      return route.continue();
    });
    for (const layout of ['rows', 'masonry', 'grid']) {
      await open(page, `/c/birds?layout=${layout}`);
      for (const id of [a, b]) {
        await expect.poll(() => isShown(tile(page, id).locator('img')), { message: `${layout} ${id}`, timeout: 30_000 }).toBe(true);
      }
    }
    expect(failed.size).toBeGreaterThan(0);
  });

  test('deterrents: no drag, no context menu', async ({ page }) => {
    await open(page, '/c/birds');
    const img = tile(page, a).locator('img');
    await expect(img).toHaveAttribute('draggable', 'false');
    const prevented = await img.evaluate((el) => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test('unpublishing a photo 404s its page and its images', async ({ page, request }) => {
    const c = await createPhoto(request, `gallery-c-${Date.now().toString(36)}`);
    ids.push(c);
    expect((await request.get(`/p/${c}`)).status()).toBe(200);
    expect((await request.get(`/img/${c}/v1/480`)).status()).toBe(200);
    const patch = await request.patch(`/api/admin/photos/${c}`, { data: { published: false } });
    expect(patch.ok()).toBeTruthy();
    expect((await request.get(`/p/${c}`)).status()).toBe(404);
    expect((await request.get(`/img/${c}/v1/480`)).status()).toBe(404);
    expect((await request.get(`/img/${c}/v1/1600`)).status()).toBe(404);
    await open(page, '/c/birds');
    await expect(tile(page, c)).toHaveCount(0);
  });
});
