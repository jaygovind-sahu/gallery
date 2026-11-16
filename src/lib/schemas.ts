/** zod schemas for every admin API body (docs/DESIGN.md, "Admin API"). */
import { z } from 'zod';
import { UPLOAD_MIME_TYPES } from './images';

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Expected a ULID');
const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable();
const optionalNumber = z.number().finite().nullable().optional();
const isoLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, 'Expected YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS]')
  .nullable();

export const exifFields = {
  camera: nullableText(120).optional(),
  lens: nullableText(120).optional(),
  focalLengthMm: optionalNumber,
  aperture: optionalNumber,
  shutterS: optionalNumber,
  iso: z.number().int().nonnegative().nullable().optional(),
  exposureComp: optionalNumber,
};

export const createPhotoSchema = z.object({
  originalFilename: nullableText(255).optional(),
  mime: z.enum(UPLOAD_MIME_TYPES),
  bytes: z.number().int().positive().max(100 * 1024 * 1024),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  placeholder: nullableText(64).optional(),
  title: nullableText(200).optional(),
  caption: nullableText(2000).optional(),
  takenAt: isoLocal.optional(),
  locationId: ulid.nullable().optional(),
  categoryIds: z.array(ulid).max(50).default([]),
  published: z.boolean().default(false),
  watermark: z.boolean().default(true),
  gpsLat: z.number().min(-90).max(90).nullable().optional(),
  gpsLng: z.number().min(-180).max(180).nullable().optional(),
  ...exifFields,
});
export type CreatePhotoInput = z.infer<typeof createPhotoSchema>;

export const patchPhotoSchema = z
  .object({
    title: nullableText(200),
    caption: nullableText(2000),
    takenAt: isoLocal,
    locationId: ulid.nullable(),
    categoryIds: z.array(ulid).max(50),
    published: z.boolean(),
    watermark: z.boolean(),
    sortOrder: z.number().finite(),
    ...exifFields,
  })
  .partial();
export type PatchPhotoInput = z.infer<typeof patchPhotoSchema>;

export const bulkPhotoSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), ids: z.array(ulid).min(1).max(500) }),
  z.object({ action: z.literal('unpublish'), ids: z.array(ulid).min(1).max(500) }),
  z.object({ action: z.literal('addCategory'), ids: z.array(ulid).min(1).max(500), categoryId: ulid }),
  z.object({ action: z.literal('removeCategory'), ids: z.array(ulid).min(1).max(500), categoryId: ulid }),
  z.object({ action: z.literal('setLocation'), ids: z.array(ulid).min(1).max(500), locationId: ulid.nullable() }),
  z.object({ action: z.literal('delete'), ids: z.array(ulid).min(1).max(500) }),
]);
export type BulkPhotoInput = z.infer<typeof bulkPhotoSchema>;

export const moveSchema = z
  .object({ photoId: ulid, beforeId: ulid.optional(), afterId: ulid.optional() })
  .refine((v) => v.beforeId !== v.photoId && v.afterId !== v.photoId, 'A photo cannot be placed next to itself');
export type MoveInput = z.infer<typeof moveSchema>;

const layout = z.enum(['rows', 'masonry', 'grid']);

export const createCategorySchema = z.object({
  name: text(80).min(1),
  slug: text(64).regex(/^[a-z0-9-]*$/).optional(),
  description: nullableText(200).optional(),
  defaultLayout: layout.default('rows'),
});
export const patchCategorySchema = z
  .object({
    name: text(80).min(1),
    slug: text(64).regex(/^[a-z0-9-]+$/),
    description: nullableText(200),
    defaultLayout: layout,
    coverPhotoId: ulid.nullable(),
    position: z.number().finite(),
  })
  .partial();
export const reorderCategoriesSchema = z.object({ ids: z.array(ulid).min(1).max(100) });

export const createLocationSchema = z.object({
  name: text(120).min(1),
  slug: text(64).regex(/^[a-z0-9-]*$/).optional(),
  region: nullableText(120).optional(),
});
export const patchLocationSchema = z
  .object({ name: text(120).min(1), slug: text(64).regex(/^[a-z0-9-]+$/), region: nullableText(120) })
  .partial();
export const mergeLocationSchema = z.object({ intoId: ulid });
