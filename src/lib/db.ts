/**
 * Typed D1 data layer. Every query is a prepared statement (docs/DESIGN.md, "Auth & security").
 * Public queries must only ever return published, ready photos and never GPS fields.
 * Admin queries (suffixed Admin or clearly admin-only) may return everything, including GPS and R2 keys.
 */
import { env } from 'cloudflare:workers';
import { ulid } from 'ulid';
import { originalKey, type UploadMime } from './images';
import { positionBetween, renumber } from './order';
import { slugify } from './slug';
import type { BulkPhotoInput, CreatePhotoInput, PatchPhotoInput } from './schemas';

export type Layout = 'rows' | 'masonry' | 'grid';

// ───────────────────────── Categories (public) ─────────────────────────

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultLayout: Layout;
  position: number;
  /** Published, ready photos in this category. */
  photoCount: number;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  default_layout: Layout;
  position: number;
  photo_count: number;
}

function db(): D1Database {
  return env.DB;
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    defaultLayout: row.default_layout,
    position: row.position,
    photoCount: row.photo_count,
  };
}

const CATEGORY_SELECT = `
  SELECT c.id, c.slug, c.name, c.description, c.default_layout, c.position,
         (SELECT COUNT(*)
            FROM photo_categories pc
            JOIN photos p ON p.id = pc.photo_id
           WHERE pc.category_id = c.id AND p.status = 'ready' AND p.published = 1) AS photo_count
    FROM categories c`;

/** All categories in their manual order, for the header menu. */
export async function listCategories(): Promise<Category[]> {
  const { results } = await db().prepare(`${CATEGORY_SELECT} ORDER BY c.position`).all<CategoryRow>();
  return results.map(toCategory);
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const row = await db().prepare(`${CATEGORY_SELECT} WHERE c.slug = ?`).bind(slug).first<CategoryRow>();
  return row ? toCategory(row) : null;
}

/** Key/value settings such as site_title and watermark_text. */
export async function getSetting(key: string): Promise<string | null> {
  const row = await db().prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

// ───────────────────────── Photos (image route) ─────────────────────────

export type PhotoStatus = 'uploading' | 'ready';

/** What the public image route needs to serve a derivative. Server-side only: holds the R2 key. */
export interface ImageSource {
  r2Key: string;
  version: number;
  status: PhotoStatus;
  published: boolean;
  watermark: boolean;
  width: number;
  height: number;
  mime: string;
}

export async function getImageSource(id: string): Promise<ImageSource | null> {
  const row = await db()
    .prepare('SELECT r2_key, version, status, published, watermark, width, height, mime FROM photos WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string; version: number; status: PhotoStatus; published: number; watermark: number; width: number; height: number; mime: string }>();
  if (!row) return null;
  return {
    r2Key: row.r2_key,
    version: row.version,
    status: row.status,
    published: row.published === 1,
    watermark: row.watermark === 1,
    width: row.width,
    height: row.height,
    mime: row.mime,
  };
}

// ───────────────────────── Photos (admin) ─────────────────────────

/** Everything about a photo, for the admin only. Never send this shape to a public page. */
export interface AdminPhoto {
  id: string;
  status: PhotoStatus;
  published: boolean;
  r2Key: string;
  version: number;
  originalFilename: string | null;
  mime: string;
  bytes: number | null;
  width: number;
  height: number;
  placeholder: string | null;
  title: string | null;
  caption: string | null;
  takenAt: string | null;
  locationId: string | null;
  locationName: string | null;
  camera: string | null;
  lens: string | null;
  focalLengthMm: number | null;
  aperture: number | null;
  shutterS: number | null;
  iso: number | null;
  exposureComp: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  watermark: boolean;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
  categoryIds: string[];
}

interface AdminPhotoRow {
  id: string;
  status: PhotoStatus;
  published: number;
  r2_key: string;
  version: number;
  original_filename: string | null;
  mime: string;
  bytes: number | null;
  width: number;
  height: number;
  placeholder: string | null;
  title: string | null;
  caption: string | null;
  taken_at: string | null;
  location_id: string | null;
  location_name: string | null;
  camera: string | null;
  lens: string | null;
  focal_length_mm: number | null;
  aperture: number | null;
  shutter_s: number | null;
  iso: number | null;
  exposure_comp: number | null;
  gps_lat: number | null;
  gps_lng: number | null;
  watermark: number;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  category_ids: string | null;
}

const ADMIN_PHOTO_SELECT = `
  SELECT p.*, l.name AS location_name,
         (SELECT group_concat(pc.category_id) FROM photo_categories pc WHERE pc.photo_id = p.id) AS category_ids
    FROM photos p
    LEFT JOIN locations l ON l.id = p.location_id`;

function toAdminPhoto(r: AdminPhotoRow): AdminPhoto {
  return {
    id: r.id,
    status: r.status,
    published: r.published === 1,
    r2Key: r.r2_key,
    version: r.version,
    originalFilename: r.original_filename,
    mime: r.mime,
    bytes: r.bytes,
    width: r.width,
    height: r.height,
    placeholder: r.placeholder,
    title: r.title,
    caption: r.caption,
    takenAt: r.taken_at,
    locationId: r.location_id,
    locationName: r.location_name,
    camera: r.camera,
    lens: r.lens,
    focalLengthMm: r.focal_length_mm,
    aperture: r.aperture,
    shutterS: r.shutter_s,
    iso: r.iso,
    exposureComp: r.exposure_comp,
    gpsLat: r.gps_lat,
    gpsLng: r.gps_lng,
    watermark: r.watermark === 1,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    categoryIds: r.category_ids ? r.category_ids.split(',') : [],
  };
}

export async function getAdminPhoto(id: string): Promise<AdminPhoto | null> {
  const row = await db().prepare(`${ADMIN_PHOTO_SELECT} WHERE p.id = ?`).bind(id).first<AdminPhotoRow>();
  return row ? toAdminPhoto(row) : null;
}

export interface AdminPhotoFilter {
  categoryId?: string;
  locationId?: string;
  /** 'published' | 'draft' (ready, unpublished) | 'uploading' */
  status?: 'published' | 'draft' | 'uploading';
}

/** Library listing: newest first, drafts and stuck uploads included. */
export async function listAdminPhotos(filter: AdminPhotoFilter = {}): Promise<AdminPhoto[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.categoryId) {
    where.push('EXISTS (SELECT 1 FROM photo_categories x WHERE x.photo_id = p.id AND x.category_id = ?)');
    binds.push(filter.categoryId);
  }
  if (filter.locationId) {
    where.push('p.location_id = ?');
    binds.push(filter.locationId);
  }
  if (filter.status === 'published') where.push("p.status = 'ready' AND p.published = 1");
  else if (filter.status === 'draft') where.push("p.status = 'ready' AND p.published = 0");
  else if (filter.status === 'uploading') where.push("p.status = 'uploading'");
  const sql = `${ADMIN_PHOTO_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC, p.id DESC`;
  const { results } = await db()
    .prepare(sql)
    .bind(...binds)
    .all<AdminPhotoRow>();
  return results.map(toAdminPhoto);
}

/** Create the row (status = uploading) and category memberships; positions are max + 1. */
export async function createPhoto(input: CreatePhotoInput): Promise<string> {
  const id = ulid();
  const key = originalKey(id, 1, input.mime);
  const statements = [
    db()
      .prepare(
        `INSERT INTO photos (id, status, published, r2_key, version, original_filename, mime, bytes, width, height, placeholder,
                             title, caption, taken_at, location_id, camera, lens, focal_length_mm, aperture, shutter_s, iso,
                             exposure_comp, gps_lat, gps_lng, watermark, sort_order)
         VALUES (?, 'uploading', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM photos))`,
      )
      .bind(
        id,
        input.published ? 1 : 0,
        key,
        input.originalFilename ?? null,
        input.mime,
        input.bytes,
        input.width,
        input.height,
        input.placeholder ?? null,
        emptyToNull(input.title),
        emptyToNull(input.caption),
        input.takenAt ?? null,
        input.locationId ?? null,
        emptyToNull(input.camera),
        emptyToNull(input.lens),
        input.focalLengthMm ?? null,
        input.aperture ?? null,
        input.shutterS ?? null,
        input.iso ?? null,
        input.exposureComp ?? null,
        input.gpsLat ?? null,
        input.gpsLng ?? null,
        input.watermark ? 1 : 0,
      ),
    ...uniq(input.categoryIds).map((categoryId) => appendToCategoryStatement(id, categoryId)),
  ];
  await db().batch(statements);
  return id;
}

function appendToCategoryStatement(photoId: string, categoryId: string): D1PreparedStatement {
  return db()
    .prepare(
      `INSERT OR IGNORE INTO photo_categories (photo_id, category_id, position)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM photo_categories WHERE category_id = ?))`,
    )
    .bind(photoId, categoryId, categoryId);
}

export interface VerifiedOriginal {
  mime: UploadMime;
  bytes: number;
  width: number;
  height: number;
}

/** Called once the original is in R2 and verified. */
export async function markPhotoReady(id: string, v: VerifiedOriginal): Promise<void> {
  await db()
    .prepare(
      `UPDATE photos SET status = 'ready', mime = ?, bytes = ?, width = ?, height = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(v.mime, v.bytes, v.width, v.height, id)
    .run();
}

/** Edit fields and (optionally) replace category membership; new memberships append at the end. */
export async function updatePhoto(id: string, patch: PatchPhotoInput): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const col = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };
  if (patch.title !== undefined) col('title', emptyToNull(patch.title));
  if (patch.caption !== undefined) col('caption', emptyToNull(patch.caption));
  if (patch.takenAt !== undefined) col('taken_at', patch.takenAt);
  if (patch.locationId !== undefined) col('location_id', patch.locationId);
  if (patch.published !== undefined) col('published', patch.published ? 1 : 0);
  if (patch.watermark !== undefined) col('watermark', patch.watermark ? 1 : 0);
  if (patch.sortOrder !== undefined) col('sort_order', patch.sortOrder);
  if (patch.camera !== undefined) col('camera', emptyToNull(patch.camera));
  if (patch.lens !== undefined) col('lens', emptyToNull(patch.lens));
  if (patch.focalLengthMm !== undefined) col('focal_length_mm', patch.focalLengthMm);
  if (patch.aperture !== undefined) col('aperture', patch.aperture);
  if (patch.shutterS !== undefined) col('shutter_s', patch.shutterS);
  if (patch.iso !== undefined) col('iso', patch.iso);
  if (patch.exposureComp !== undefined) col('exposure_comp', patch.exposureComp);
  if (patch.gpsLat !== undefined) col('gps_lat', patch.gpsLat);
  if (patch.gpsLng !== undefined) col('gps_lng', patch.gpsLng);

  const statements: D1PreparedStatement[] = [];
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    statements.push(
      db()
        .prepare(`UPDATE photos SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...binds, id),
    );
  }
  if (patch.categoryIds !== undefined) {
    const wanted = uniq(patch.categoryIds);
    if (wanted.length) {
      statements.push(
        db()
          .prepare(`DELETE FROM photo_categories WHERE photo_id = ? AND category_id NOT IN (${wanted.map(() => '?').join(',')})`)
          .bind(id, ...wanted),
      );
    } else {
      statements.push(db().prepare('DELETE FROM photo_categories WHERE photo_id = ?').bind(id));
    }
    for (const categoryId of wanted) statements.push(appendToCategoryStatement(id, categoryId));
  }
  if (statements.length) await db().batch(statements);
}

export interface ReplacedOriginal extends VerifiedOriginal {
  r2Key: string;
  version: number;
  placeholder: string | null;
}

/** After a replace: point at the new R2 object, bump version, refresh dimensions; everything else stays. */
export async function setPhotoOriginal(id: string, v: ReplacedOriginal): Promise<void> {
  await db()
    .prepare(
      `UPDATE photos SET r2_key = ?, version = ?, mime = ?, bytes = ?, width = ?, height = ?, placeholder = COALESCE(?, placeholder),
                         status = 'ready', updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(v.r2Key, v.version, v.mime, v.bytes, v.width, v.height, v.placeholder, id)
    .run();
}

/** Remove the DB rows for photos; memberships cascade and covers are cleared explicitly. */
export async function deletePhotos(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const marks = ids.map(() => '?').join(',');
  await db().batch([
    db().prepare(`UPDATE categories SET cover_photo_id = NULL WHERE cover_photo_id IN (${marks})`).bind(...ids),
    db().prepare(`DELETE FROM photo_categories WHERE photo_id IN (${marks})`).bind(...ids),
    db().prepare(`DELETE FROM photos WHERE id IN (${marks})`).bind(...ids),
  ]);
}

/** R2 keys for the given photos (current version only; older versions are removed on replace). */
export async function r2KeysFor(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { results } = await db()
    .prepare(`SELECT r2_key FROM photos WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ r2_key: string }>();
  return results.map((r) => r.r2_key);
}

/** Bulk actions other than delete (the route handles delete so it can clear R2 too). */
export async function bulkUpdatePhotos(input: Exclude<BulkPhotoInput, { action: 'delete' }>): Promise<void> {
  const ids = uniq(input.ids);
  const marks = ids.map(() => '?').join(',');
  switch (input.action) {
    case 'publish':
    case 'unpublish':
      await db()
        .prepare(`UPDATE photos SET published = ?, updated_at = datetime('now') WHERE id IN (${marks})`)
        .bind(input.action === 'publish' ? 1 : 0, ...ids)
        .run();
      return;
    case 'setLocation':
      await db()
        .prepare(`UPDATE photos SET location_id = ?, updated_at = datetime('now') WHERE id IN (${marks})`)
        .bind(input.locationId, ...ids)
        .run();
      return;
    case 'addCategory':
      await db().batch(ids.map((id) => appendToCategoryStatement(id, input.categoryId)));
      return;
    case 'removeCategory':
      await db()
        .prepare(`DELETE FROM photo_categories WHERE category_id = ? AND photo_id IN (${marks})`)
        .bind(input.categoryId, ...ids)
        .run();
      return;
  }
}

// ───────────────────────── Categories (admin) ─────────────────────────

export interface AdminCategory extends Category {
  coverPhotoId: string | null;
  /** All photos in the category, drafts included. */
  totalCount: number;
}

interface AdminCategoryRow extends CategoryRow {
  cover_photo_id: string | null;
  total_count: number;
}

const ADMIN_CATEGORY_SELECT = `
  SELECT c.id, c.slug, c.name, c.description, c.default_layout, c.position, c.cover_photo_id,
         (SELECT COUNT(*) FROM photo_categories pc JOIN photos p ON p.id = pc.photo_id
           WHERE pc.category_id = c.id AND p.status = 'ready' AND p.published = 1) AS photo_count,
         (SELECT COUNT(*) FROM photo_categories pc WHERE pc.category_id = c.id) AS total_count
    FROM categories c`;

function toAdminCategory(r: AdminCategoryRow): AdminCategory {
  return { ...toCategory(r), coverPhotoId: r.cover_photo_id, totalCount: r.total_count };
}

export async function listAdminCategories(): Promise<AdminCategory[]> {
  const { results } = await db().prepare(`${ADMIN_CATEGORY_SELECT} ORDER BY c.position`).all<AdminCategoryRow>();
  return results.map(toAdminCategory);
}

export async function getAdminCategory(id: string): Promise<AdminCategory | null> {
  const row = await db().prepare(`${ADMIN_CATEGORY_SELECT} WHERE c.id = ?`).bind(id).first<AdminCategoryRow>();
  return row ? toAdminCategory(row) : null;
}

export async function createCategory(input: { name: string; slug?: string; description?: string | null; defaultLayout: Layout }): Promise<string> {
  const id = ulid();
  const slug = await uniqueSlug('categories', input.slug || slugify(input.name));
  await db()
    .prepare(
      `INSERT INTO categories (id, slug, name, description, default_layout, position)
       VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM categories))`,
    )
    .bind(id, slug, input.name, emptyToNull(input.description), input.defaultLayout)
    .run();
  return id;
}

export async function updateCategory(
  id: string,
  patch: { name?: string; slug?: string; description?: string | null; defaultLayout?: Layout; coverPhotoId?: string | null; position?: number },
): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const col = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };
  if (patch.name !== undefined) col('name', patch.name);
  if (patch.slug !== undefined) col('slug', patch.slug);
  if (patch.description !== undefined) col('description', emptyToNull(patch.description));
  if (patch.defaultLayout !== undefined) col('default_layout', patch.defaultLayout);
  if (patch.coverPhotoId !== undefined) col('cover_photo_id', patch.coverPhotoId);
  if (patch.position !== undefined) col('position', patch.position);
  if (!sets.length) return;
  await db()
    .prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
}

/** Put the given categories first, in that order; any category not listed keeps its relative order after them. */
export async function reorderCategories(idsInOrder: string[]): Promise<void> {
  const existing = await listAdminCategories();
  const known = new Set(existing.map((c) => c.id));
  const given = uniq(idsInOrder).filter((id) => known.has(id));
  const rest = existing.map((c) => c.id).filter((id) => !given.includes(id));
  await db().batch(
    renumber([...given, ...rest]).map(({ id, position }) => db().prepare('UPDATE categories SET position = ? WHERE id = ?').bind(position, id)),
  );
}

export async function deleteCategory(id: string): Promise<void> {
  await db().batch([
    db().prepare('DELETE FROM photo_categories WHERE category_id = ?').bind(id),
    db().prepare('DELETE FROM categories WHERE id = ?').bind(id),
  ]);
}

export interface CategoryPhotoAdmin {
  id: string;
  position: number;
  status: PhotoStatus;
  published: boolean;
  version: number;
  width: number;
  height: number;
  placeholder: string | null;
  title: string | null;
}

/** Photos in a category in manual order, drafts included (for the drag-reorder screen). */
export async function listCategoryPhotosAdmin(categoryId: string): Promise<CategoryPhotoAdmin[]> {
  const { results } = await db()
    .prepare(
      `SELECT p.id, pc.position, p.status, p.published, p.version, p.width, p.height, p.placeholder, p.title
         FROM photo_categories pc JOIN photos p ON p.id = pc.photo_id
        WHERE pc.category_id = ? ORDER BY pc.position, p.id`,
    )
    .bind(categoryId)
    .all<{ id: string; position: number; status: PhotoStatus; published: number; version: number; width: number; height: number; placeholder: string | null; title: string | null }>();
  return results.map((r) => ({ ...r, published: r.published === 1 }));
}

/**
 * Move a photo within a category so it sits after `beforeId` and before `afterId`.
 * Picks the midpoint; renumbers the whole category when the gap is too small.
 */
export async function movePhotoInCategory(categoryId: string, photoId: string, beforeId?: string, afterId?: string): Promise<number> {
  const neighbour = async (id: string | undefined): Promise<number | null> => {
    if (!id) return null;
    const row = await db()
      .prepare('SELECT position FROM photo_categories WHERE category_id = ? AND photo_id = ?')
      .bind(categoryId, id)
      .first<{ position: number }>();
    if (!row) throw new Error(`Photo ${id} is not in this category`);
    return row.position;
  };
  const [before, after] = await Promise.all([neighbour(beforeId), neighbour(afterId)]);
  const placement = positionBetween(before, after);
  const update = db()
    .prepare('UPDATE photo_categories SET position = ? WHERE category_id = ? AND photo_id = ?')
    .bind(placement.position, categoryId, photoId);
  const { meta } = await update.run();
  if (!meta.changes) throw new Error(`Photo ${photoId} is not in this category`);

  if (placement.renumber) {
    const ordered = await listCategoryPhotosAdmin(categoryId);
    await db().batch(
      renumber(ordered.map((p) => p.id)).map(({ id, position }) =>
        db().prepare('UPDATE photo_categories SET position = ? WHERE category_id = ? AND photo_id = ?').bind(position, categoryId, id),
      ),
    );
    return ordered.findIndex((p) => p.id === photoId) + 1;
  }
  return placement.position;
}

// ───────────────────────── Locations ─────────────────────────

export interface Location {
  id: string;
  slug: string;
  name: string;
  region: string | null;
  /** All photos at this location, drafts included (admin listing). */
  photoCount: number;
}

interface LocationRow {
  id: string;
  slug: string;
  name: string;
  region: string | null;
  photo_count: number;
}

const LOCATION_SELECT = `
  SELECT l.id, l.slug, l.name, l.region,
         (SELECT COUNT(*) FROM photos p WHERE p.location_id = l.id) AS photo_count
    FROM locations l`;

function toLocation(r: LocationRow): Location {
  return { id: r.id, slug: r.slug, name: r.name, region: r.region, photoCount: r.photo_count };
}

export async function listLocations(): Promise<Location[]> {
  const { results } = await db().prepare(`${LOCATION_SELECT} ORDER BY l.name COLLATE NOCASE`).all<LocationRow>();
  return results.map(toLocation);
}

export async function getLocation(id: string): Promise<Location | null> {
  const row = await db().prepare(`${LOCATION_SELECT} WHERE l.id = ?`).bind(id).first<LocationRow>();
  return row ? toLocation(row) : null;
}

export async function createLocation(input: { name: string; slug?: string; region?: string | null }): Promise<string> {
  const id = ulid();
  const slug = await uniqueSlug('locations', input.slug || slugify(input.name));
  await db()
    .prepare('INSERT INTO locations (id, slug, name, region) VALUES (?, ?, ?, ?)')
    .bind(id, slug, input.name, emptyToNull(input.region))
    .run();
  return id;
}

export async function updateLocation(id: string, patch: { name?: string; slug?: string; region?: string | null }): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    binds.push(patch.name);
  }
  if (patch.slug !== undefined) {
    sets.push('slug = ?');
    binds.push(patch.slug);
  }
  if (patch.region !== undefined) {
    sets.push('region = ?');
    binds.push(emptyToNull(patch.region));
  }
  if (!sets.length) return;
  await db()
    .prepare(`UPDATE locations SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
}

/** Delete a location; its photos keep no location (FK ON DELETE SET NULL, done explicitly for D1). */
export async function deleteLocation(id: string): Promise<void> {
  await db().batch([
    db().prepare('UPDATE photos SET location_id = NULL WHERE location_id = ?').bind(id),
    db().prepare('DELETE FROM locations WHERE id = ?').bind(id),
  ]);
}

/** Move every photo from one location to another, then delete the first. */
export async function mergeLocation(fromId: string, intoId: string): Promise<void> {
  await db().batch([
    db().prepare('UPDATE photos SET location_id = ? WHERE location_id = ?').bind(intoId, fromId),
    db().prepare('DELETE FROM locations WHERE id = ?').bind(fromId),
  ]);
}

// ───────────────────────── helpers ─────────────────────────

function emptyToNull(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t ? t : null;
}

function uniq<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs));
}

/** Append -2, -3, … until the slug is free in the given table. */
async function uniqueSlug(table: 'categories' | 'locations', base: string): Promise<string> {
  const root = base || 'item';
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const row = await db().prepare(`SELECT 1 AS x FROM ${table} WHERE slug = ?`).bind(candidate).first();
    if (!row) return candidate;
  }
  return `${root}-${ulid().slice(-6).toLowerCase()}`;
}

export async function slugTaken(table: 'categories' | 'locations', slug: string, exceptId: string): Promise<boolean> {
  const row = await db().prepare(`SELECT 1 AS x FROM ${table} WHERE slug = ? AND id <> ?`).bind(slug, exceptId).first();
  return Boolean(row);
}
