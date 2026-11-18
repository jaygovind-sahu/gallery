import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// Milestone 8 checks (docs/DESIGN.md, "AI suggestions"): Suggest fills titles, captions per tone and hashtags
// without overwriting the owner's words; one saved caption is shown on the site and the rest stay private;
// the blind comparison counts a pick; the upload page warns about duplicates, suggests a location from GPS,
// defaults to draft and saves edits made after the upload. Runs against the built-in stand-in models
// (AI_MOCK=1 in .dev.vars), so it needs no API key. Needs the fixtures from `pnpm fixtures`.

const fixture = (name: string) => path.join(import.meta.dirname, '..', 'fixtures', name);
const BIRDS = '01M53JH10086R420JC0GP7PP0A';
const BOMBAY_HOOK = '01M53JH105VX402YCZ9B9CVJ59';

interface Caption {
  tone: string;
  text: string;
  edited: boolean;
}
interface AdminPhoto {
  id: string;
  published: boolean;
  title: string | null;
  caption: string | null;
  captionTone: string | null;
  captions: Caption[];
  subject: string | null;
  hashtags: string | null;
  locationId: string | null;
  categoryIds: string[];
  originalFilename: string | null;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('[data-hydrated]').first().waitFor();
}

async function getPhoto(request: APIRequestContext, id: string): Promise<AdminPhoto> {
  const res = await request.get(`/api/admin/photos/${id}`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { photo: AdminPhoto }).photo;
}

async function listPhotos(request: APIRequestContext): Promise<AdminPhoto[]> {
  return ((await (await request.get('/api/admin/photos')).json()) as { photos: AdminPhoto[] }).photos;
}

/** A ready photo, created through the API. */
async function createPhoto(request: APIRequestContext, data: Record<string, unknown>): Promise<string> {
  const res = await request.post('/api/admin/photos', {
    data: { originalFilename: 'landscape.jpg', mime: 'image/jpeg', bytes: 1, width: 3000, height: 2000, categoryIds: [], published: false, ...data },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const put = await request.put(`/api/admin/photos/${id}/original`, { headers: { 'content-type': 'image/jpeg' }, data: await readFile(fixture('landscape.jpg')) });
  expect(put.ok()).toBeTruthy();
  return id;
}

const created: string[] = [];

test.beforeAll(async ({ request }) => {
  const res = await request.get('/api/admin/ai/settings');
  const { models } = (await res.json()) as { models: { provider: string }[] };
  expect(models.map((m) => m.provider), 'these tests need AI_MOCK=1 in .dev.vars').toEqual(['mock', 'mock']);
  await request.patch('/api/admin/ai/settings', { data: { blindTest: false } });
});

test.afterAll(async ({ request }) => {
  await request.patch('/api/admin/ai/settings', { data: { blindTest: false, styleNotes: '', resetVotes: true } });
  for (const id of created) await request.delete(`/api/admin/photos/${id}`);
});

test('upload card: suggest, pick a title and tone, upload as a draft, then save an edit made afterwards', async ({ page, request }) => {
  const before = new Set((await listPhotos(request)).map((p) => p.id));
  await open(page, '/admin/upload');

  // Draft is the default, so a batch can't go live untitled.
  await expect(page.getByLabel('Save as draft').first()).toBeChecked();
  await page.getByText('Macro', { exact: true }).click();

  await page.locator('#upload-files').setInputFiles([fixture('landscape.jpg')]);
  await expect(page.getByRole('button', { name: /^Upload 1 photo$/ })).toBeEnabled({ timeout: 60_000 });

  // The owner names the subject; the AI writes around it and does not guess.
  await page.getByLabel('Subject', { exact: true }).fill('Green Heron');
  await page.getByRole('button', { name: 'Suggest', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Green Heron, Waiting (A)');
  await expect(page.getByRole('note').filter({ hasText: 'AI guess' })).toHaveCount(0);
  await expect(page.getByLabel('Field notes version')).toHaveValue(/green heron stands motionless/);
  await expect(page.getByLabel('Hashtags')).toHaveValue('#greenheron #birdphotography #wildlife #mocka');

  // Pick another title and another tone to show.
  await page.getByRole('group', { name: 'Suggested titles' }).getByRole('button', { name: 'Green Heron at First Light (A)' }).click();
  await page.getByLabel('Show Playful on the site').check();
  // The photo was filed under Macro only; the suggestion offers Birds.
  await page.getByRole('button', { name: 'Add to Birds' }).click();

  await page.getByRole('button', { name: /^Upload 1 photo$/ }).click();
  await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(1, { timeout: 60_000 });

  const photo = (await listPhotos(request)).find((p) => !before.has(p.id));
  expect(photo).toBeTruthy();
  created.push(photo!.id);
  expect(photo!.published).toBe(false);
  expect(photo!.title).toBe('Green Heron at First Light (A)');
  expect(photo!.subject).toBe('Green Heron');
  expect(photo!.hashtags).toBe('#greenheron #birdphotography #wildlife #mocka');
  expect(photo!.captions.map((c) => c.tone)).toEqual(['field-notes', 'poetic', 'playful']);
  expect(photo!.captionTone).toBe('playful');
  expect(photo!.caption).toBe('[A] This green heron has been pretending to be a stick all morning.');
  expect(photo!.categoryIds).toContain(BIRDS);

  // Still editable once uploaded: the change is saved with a click.
  await page.getByLabel('Title', { exact: true }).fill('Green Heron, Edited');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await getPhoto(request, photo!.id)).title).toBe('Green Heron, Edited');
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
});

test('edit page: an AI guess is flagged, edited captions survive a re-run, and only the shown caption is public', async ({ page, request }) => {
  const id = await createPhoto(request, { title: null, categoryIds: [BIRDS] });
  created.push(id);

  await open(page, `/admin/photos/${id}`);
  await page.getByRole('button', { name: 'Suggest', exact: true }).click();

  // No subject was given, so the name is a guess and says so.
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Great Blue Heron');
  await expect(page.getByRole('note').filter({ hasText: 'AI guess' })).toContainText('AI guess, medium confidence (Ardea herodias). Going by: grey-blue body, black stripe over the eye, long neck. Could also be: Great Egret.');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Great Blue Heron, Waiting (A)');

  // Running it again must not feed the guess back as if the owner had typed it: it stays a guess.
  await page.getByRole('button', { name: 'Suggest', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Suggestions added' })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'AI guess' })).toContainText('medium confidence');

  await page.getByLabel('Show Poetic on the site').check();
  await page.getByLabel('Field notes version').fill('My own field note about the heron.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();

  let photo = await getPhoto(request, id);
  expect(photo.captionTone).toBe('poetic');
  expect(photo.caption).toBe('[A] Patience, wearing the shape of a great blue heron.');
  expect(photo.captions.find((c) => c.tone === 'field-notes')).toEqual({ tone: 'field-notes', text: 'My own field note about the heron.', edited: true });
  expect(photo.captions.find((c) => c.tone === 'playful')?.edited).toBe(false);

  // A re-run offers new text for the edited caption instead of replacing it.
  await page.getByRole('button', { name: 'Suggest', exact: true }).click();
  await expect(page.getByText('New suggestion: “[A] A great blue heron stands motionless')).toBeVisible();
  await expect(page.getByLabel('Field notes version')).toHaveValue('My own field note about the heron.');
  // The subject is still the AI's untouched guess, so it stays flagged until the owner edits it.
  await expect(page.getByRole('note').filter({ hasText: 'AI guess' })).toHaveCount(1);
  await page.getByLabel('Subject', { exact: true }).fill('Great Blue Heron (adult)');
  await expect(page.getByRole('note').filter({ hasText: 'AI guess' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(page.getByText('New suggestion:')).toHaveCount(0);

  // Saved captions can be copied for use elsewhere, with or without the hashtags.
  await expect(page.getByRole('button', { name: 'Copy Playful with hashtags' })).toBeVisible();

  // Public page: the shown caption only. No other tone, no hashtags, no subject field.
  await request.patch(`/api/admin/photos/${id}`, { data: { published: true } });
  const html = await (await request.get(`/p/${id}`)).text();
  expect(html).toContain('Patience, wearing the shape of a great blue heron.');
  expect(html).not.toContain('pretending to be a stick');
  expect(html).not.toContain('My own field note');
  expect(html).not.toContain('#birdphotography');
  expect(html).not.toContain('captionTone');

  // Switching the shown caption from the admin changes what the site shows.
  await page.getByLabel('Show Playful on the site').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await getPhoto(request, id)).caption).toBe('[A] This great blue heron has been pretending to be a stick all morning.');
  photo = await getPhoto(request, id);
  expect(photo.captions).toHaveLength(3);
});

test('edit page: picking one of the AI’s alternatives makes it the subject, and the next Suggest writes around it', async ({ page, request }) => {
  const id = await createPhoto(request, { title: null, categoryIds: [BIRDS] });
  created.push(id);

  await open(page, `/admin/photos/${id}`);
  await page.getByRole('button', { name: 'Suggest', exact: true }).click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Great Blue Heron');

  await page.getByRole('note').getByRole('button', { name: 'Great Egret' }).click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Great Egret');
  await expect(page.getByRole('note').filter({ hasText: 'AI guess' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Subject set to Great Egret' })).toBeVisible();

  // Now the owner's word: the stand-in echoes a given subject back, so the captions name it.
  await page.getByRole('button', { name: 'Suggest', exact: true }).click();
  await expect(page.getByLabel('Field notes version')).toHaveValue('[A] A great egret stands motionless at the marsh.');
  await expect(page.getByRole('note').filter({ hasText: 'AI guess' })).toHaveCount(0);
});

test('blind comparison: two unlabeled sets, and the pick is counted', async ({ page, request }) => {
  const id = await createPhoto(request, { title: null });
  created.push(id);
  await request.patch('/api/admin/ai/settings', { data: { blindTest: true, resetVotes: true } });

  try {
    await open(page, `/admin/photos/${id}`);
    await page.getByRole('button', { name: 'Suggest', exact: true }).click();

    const compare = page.getByRole('group', { name: 'Compare suggestions' });
    await expect(compare.getByRole('region')).toHaveCount(2);
    // Nothing is filled in until a set is chosen, and neither set says which model wrote it.
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
    await expect(compare).not.toContainText(/claude|haiku|gpt|anthropic|openai|model/i);

    const chosen = await compare.getByRole('region', { name: 'Set B' }).locator('li').first().innerText();
    await compare.getByRole('button', { name: 'Use set b' }).click();
    await expect(compare).toHaveCount(0);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(chosen);

    await expect
      .poll(async () => ((await (await request.get('/api/admin/ai/settings')).json()) as { votes: number }).votes)
      .toBe(1);
    const { tally } = (await (await request.get('/api/admin/ai/settings')).json()) as { tally: { model: string; wins: number }[] };
    const winner = chosen.endsWith('(A)') ? 'mock:a' : 'mock:b';
    expect(tally[0]).toEqual({ model: winner, wins: 1 });
  } finally {
    await request.patch('/api/admin/ai/settings', { data: { blindTest: false, resetVotes: true } });
  }
});

test('upload page warns about a duplicate and suggests a location from GPS', async ({ page, request }) => {
  // A photo already in the library with the same name and size as noexif.jpg, and one filed at Bombay Hook
  // with the position gps.jpg carries.
  const size = (await stat(fixture('noexif.jpg'))).size;
  const twin = await request.post('/api/admin/photos', {
    data: { originalFilename: 'noexif.jpg', mime: 'image/jpeg', bytes: size, width: 1800, height: 1200, title: 'Already here', categoryIds: [], published: false },
  });
  created.push(((await twin.json()) as { id: string }).id);
  const filed = await request.post('/api/admin/photos', {
    data: { originalFilename: 'earlier.jpg', mime: 'image/jpeg', bytes: 2, width: 2400, height: 1600, categoryIds: [], published: false, locationId: BOMBAY_HOOK, gpsLat: 39.2583, gpsLng: -75.45 },
  });
  created.push(((await filed.json()) as { id: string }).id);

  await open(page, '/admin/upload');
  await page.locator('#upload-files').setInputFiles([fixture('noexif.jpg'), fixture('gps.jpg')]);
  await expect(page.getByRole('button', { name: /^Upload 2 photos$/ })).toBeEnabled({ timeout: 60_000 });

  const duplicate = page.locator('li', { hasText: 'noexif.jpg' }).getByRole('note');
  await expect(duplicate).toContainText('Looks like a photo already in the library');
  await expect(duplicate.getByRole('link', { name: 'Already here' })).toBeVisible();

  await expect(page.locator('li', { hasText: 'gps.jpg' }).getByText('Location from GPS: Bombay Hook NWR')).toBeVisible();
});

test('AI settings: voice notes are saved and sent along', async ({ page, request }) => {
  await open(page, '/admin/ai');
  await expect(page.getByText('AI_MOCK is on')).toBeVisible();
  await page.getByLabel('Voice notes').fill('Short and dry. No emoji.');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const { settings } = (await (await request.get('/api/admin/ai/settings')).json()) as { settings: { styleNotes: string } };
  expect(settings.styleNotes).toBe('Short and dry. No emoji.');
});
