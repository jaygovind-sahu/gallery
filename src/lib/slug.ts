export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Category slugs the site uses for its own pages: `/c/miscellaneous` lists photos in no category. */
export const RESERVED_CATEGORY_SLUGS: readonly string[] = ['miscellaneous'];

export function isReservedCategorySlug(slug: string): boolean {
  return RESERVED_CATEGORY_SLUGS.includes(slug);
}
