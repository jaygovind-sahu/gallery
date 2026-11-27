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
  let c = '';

  test.beforeAll(async ({ request }) => {
    const tag = Date.now().toString(36);
    a = await createPhoto(request, `gallery-a-${tag}`, { camera: 'Nikon Z50II', lens: 'Tamron 50-400mm', focalLengthMm: 400, aperture: 6.3, shutterS: 1 / 2000, iso: 1600 });
    b = await createPhoto(request, `gallery-b-${tag}`, { title: null });
    c = await createPhoto(request, `gallery-c-${tag}`, { categoryIds: [] });
    ids.push(a, b, c);
  });

  test.afterAll(async ({ request }) => {
    for (const id of ids) await request.delete(`/api/admin/photos/${id}`);
  });

  test('published photos appear on the category page, in /all and at their location', async ({ page }) => {
    for (const url of ['/c/birds', '/all', '/l/marsh-creek-state-park']) {
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

  test('the home page is the walk-through; /walk redirects to it; grid pages link to it', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Walk-through of all photos');
    await expect(page.locator('header a.walk-link')).toHaveAttribute('href', '/all');
    expect(await page.content()).not.toMatch(/gps|r2_key|r2Key|originals\//i);

    const redirect = await request.get('/walk?frame=gilt', { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers()['location']).toBe('/?frame=gilt');

    await open(page, '/c/birds');
    await expect(page.locator('header a.walk-link')).toHaveAttribute('href', '/');
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

  test('lightbox never enlarges a photo past its real pixels on the screen', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one viewport check covers it');
    // landscape.jpg is 3000×2000, so the largest lightbox file is 2400×1600. In a 1920×1200 window, with the
    // 340 px details panel open (it opens with every photo) and the 64 px bands, it fits at 1452×968 CSS px.
    for (const { scale, width, zoomable } of [
      { scale: 1, width: 1452, zoomable: true }, // fits the space; zoom can go on to 2400
      { scale: 2, width: 1200, zoomable: false }, // capped at 2400 / 2; already at real size
    ]) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: scale, baseURL: testInfo.project.use.baseURL });
      const page = await context.newPage();
      await open(page, `/p/${a}`);
      const img = page.locator('.yarl__slide_current img');
      await expect(img).toBeVisible();
      await expect.poll(async () => Math.abs(((await img.boundingBox())?.width ?? 0) - width), { message: `width at ${scale}×` }).toBeLessThanOrEqual(2);
      const zoomIn = page.getByRole('button', { name: 'Zoom in' });
      if (zoomable) await expect(zoomIn).toBeEnabled();
      else await expect(zoomIn).toBeDisabled();
      await context.close();
    }
  });

  test('lightbox: open, arrow through, /p/:id in the URL, Back closes, direct load opens', async ({ page }, testInfo) => {
    await open(page, '/c/birds');
    await tile(page, a).click();
    const lightbox = page.locator('.yarl__root');
    await expect(lightbox).toBeVisible();
    await expect(page).toHaveURL(`/p/${a}`);
    // The lightbox picks one of the large sizes for the viewport and pixel ratio.
    await expect(lightbox.locator('.yarl__slide_current img')).toHaveAttribute('src', new RegExp(`/img/${a}/v1/(1600|2400)$`));

    await page.keyboard.press('ArrowRight');
    await expect(page).not.toHaveURL(`/p/${a}`);
    await expect(page).toHaveURL(/\/p\/[0-9A-Z]{26}$/);
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(`/p/${a}`);

    // The spec sheet opens with the photo, beside it on desktop and below it on phones, never over it.
    const info = page.locator('#lightbox-info');
    await expect(info).toBeVisible();
    await expect(info.getByRole('heading', { level: 2 })).toHaveText(/gallery-a-/);
    const exposure = info.getByRole('region', { name: 'Exposure' });
    for (const figure of ['400mm', 'ƒ/6.3', '1/2000s', '1600']) await expect(exposure).toContainText(figure);
    await expect(info).toContainText('Nikon Z50II');
    await expect(info).toContainText('Tamron 50-400mm');
    await expect(info.getByRole('link', { name: 'Marsh Creek State Park' })).toHaveAttribute('href', '/l/marsh-creek-state-park');
    const photo = lightbox.locator('.yarl__slide_current img');
    await expect
      .poll(async () => {
        const [p, s] = [await photo.boundingBox(), await info.boundingBox()];
        if (!p || !s) return false;
        return testInfo.project.name === 'phone' ? p.y + p.height <= s.y + 1 : p.x + p.width <= s.x + 1;
      })
      .toBe(true);

    // `i` hides and shows it.
    await page.keyboard.press('i');
    await expect(info).toBeHidden();
    await page.keyboard.press('i');
    await expect(info).toBeVisible();
    await page.keyboard.press('i');
    await expect(info).toBeHidden();

    const bar = lightbox.locator('.lightbox-details-bar');
    if (testInfo.project.name === 'phone') {
      // Phones: no i button at the top. The Details bar below the photo opens the sheet; dragging the
      // sheet down by its handle closes it again.
      await expect(lightbox.locator('.lightbox-info-button')).toBeHidden();
      await expect(bar).toBeVisible();
      await bar.click();
      await expect(info).toBeVisible();
      await expect(bar).toHaveCount(0);
      // Let it finish sliding up before grabbing the handle.
      await expect.poll(() => info.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
      const handle = await info.locator('.info-panel__grabber').boundingBox();
      if (!handle) throw new Error('no drag handle');
      const x = handle.x + handle.width / 2;
      const y = handle.y + handle.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 160, { steps: 8 });
      await page.mouse.up();
      await expect(info).toBeHidden();
      await expect(bar).toBeVisible();
    } else {
      await expect(lightbox.locator('.lightbox-info-button')).toBeVisible();
      await expect(bar).toBeHidden();
    }

    await page.goBack();
    await expect(lightbox).toHaveCount(0);
    await expect(page).toHaveURL(/\/c\/birds$/);

    await page.keyboard.press('Escape'); // no lightbox: nothing happens
    await tile(page, b).click();
    await expect(page).toHaveURL(`/p/${b}`);
    await expect(lightbox).toBeVisible();
    // Hidden last time, but every photo opens with it again. b has no title and no EXIF.
    await expect(info).toBeVisible();
    await expect(info.getByRole('heading', { level: 2 })).toHaveText('Untitled');
    await expect(info.getByRole('region', { name: 'Exposure' })).toHaveCount(0);
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

  test('header: one Categories menu with the non-empty categories, then Miscellaneous for photos in none', async ({ page, request }, testInfo) => {
    const tag = Date.now().toString(36);
    // A category with no published photos stays out of the menu.
    const empty = await request.post('/api/admin/categories', { data: { name: `Empty ${tag}` } });
    expect(empty.status()).toBe(201);
    const emptyCategory = ((await empty.json()) as { category: { id: string; slug: string } }).category;
    // "miscellaneous" is reserved for photos in no category, so a real category called that gets another address.
    const named = await request.post('/api/admin/categories', { data: { name: 'Miscellaneous' } });
    expect(named.status()).toBe(201);
    const namedCategory = ((await named.json()) as { category: { id: string; slug: string } }).category;
    expect(namedCategory.slug).not.toBe('miscellaneous');

    try {
      const phone = testInfo.project.name === 'phone';
      await open(page, '/c/birds');
      const menu = phone ? page.locator('summary[aria-label="Menu"]').locator('..') : page.locator('details.nav-menu');
      await menu.locator('summary').click();
      const panel = phone ? menu.getByRole('navigation', { name: 'Categories' }) : menu;
      await expect(panel.getByRole('link', { name: /^Birds/ })).toHaveAttribute('aria-current', 'page');
      await expect(panel.getByRole('link', { name: /^Birds/ })).toContainText(/\d+$/);
      await expect(panel.getByRole('link', { name: new RegExp(`^Empty ${tag}`) })).toHaveCount(0);
      await expect(panel.locator(`a[href="/c/${namedCategory.slug}"]`)).toHaveCount(0);
      if (phone) await expect(panel.getByRole('link', { name: /^All photos/ })).toHaveAttribute('href', '/all');
      else {
        await expect(menu.locator('summary')).toHaveAttribute('data-active', '');
        // A click elsewhere closes it.
        await page.locator('main').click({ position: { x: 5, y: 5 } });
        await expect(menu).not.toHaveAttribute('open');
        await menu.locator('summary').click();
      }

      await panel.getByRole('link', { name: /^Miscellaneous/ }).click();
      await expect(page).toHaveURL(/\/c\/miscellaneous$/);
      await page.locator('[data-gallery][data-hydrated]').waitFor();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Miscellaneous');
      await expect(tile(page, c)).toBeVisible();
      await expect(tile(page, a)).toHaveCount(0);

      // A photo in no category opens over Miscellaneous.
      await open(page, `/p/${c}`);
      await expect(page.locator('.yarl__root')).toBeVisible();
      await expect(page.locator('h2').filter({ hasText: /^Miscellaneous$/ })).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/\/c\/miscellaneous$/);

      // The admin Library's "No category" filter finds it too.
      const res = await request.get('/api/admin/photos?category=__none');
      const listed = ((await res.json()) as { photos: { id: string }[] }).photos.map((p) => p.id);
      expect(listed).toContain(c);
      expect(listed).not.toContain(a);
    } finally {
      await request.delete(`/api/admin/categories/${emptyCategory.id}`);
      await request.delete(`/api/admin/categories/${namedCategory.id}`);
    }
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
    // The page is the 404 page, worded the same as for an id that never existed.
    const res = await page.goto(`/p/${c}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing here');
  });

  test('unknown pages get the 404 page; public pages send the security headers', async ({ page, request }) => {
    for (const url of ['/no-such-page', '/c/no-such-category', '/l/no-such-place', '/p/not-an-id']) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(404);
      await expect(page.getByRole('heading', { level: 1 }), url).toHaveText('Nothing here');
      await expect(page.locator('link[rel="canonical"]'), url).toHaveCount(0);
    }
    const headers = (await request.get('/')).headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
  });

  test('a category previews its cover in shared links, never a draft', async ({ page, request }) => {
    const draft = await createPhoto(request, `gallery-d-${Date.now().toString(36)}`, { published: false });
    ids.push(draft);
    const cover = async (coverPhotoId: string | null) =>
      expect((await request.patch(`/api/admin/categories/${BIRDS}`, { data: { coverPhotoId } })).ok()).toBeTruthy();
    const ogImage = page.locator('meta[property="og:image"]');
    try {
      await cover(b);
      await page.goto('/c/birds');
      await expect(ogImage).toHaveAttribute('content', new RegExp(`/img/${b}/v1/1600$`));
      await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', /Marsh Creek State Park/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/c\/birds$/);

      await cover(draft);
      await page.goto('/c/birds');
      await expect(ogImage).toHaveAttribute('content', /\/img\/[0-9A-Z]{26}\/v\d+\/1600$/);
      expect(await page.content()).not.toContain(draft);
    } finally {
      await cover(null);
    }
  });
});
