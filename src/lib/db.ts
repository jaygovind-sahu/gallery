/**
 * Typed D1 data layer. Every query is a prepared statement (docs/DESIGN.md, "Auth & security").
 * Public queries must only ever return published, ready photos and never GPS fields.
 */
import { env } from 'cloudflare:workers';

export type Layout = 'rows' | 'masonry' | 'grid';

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
