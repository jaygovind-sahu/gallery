/** zod schemas for every admin API body (docs/DESIGN.md, "Admin API"). */
import { z } from 'zod';
import { TONES } from './captions';
import { UPLOAD_MIME_TYPES } from './images';

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Expected a ULID');
const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable();
const optionalNumber = z.number().nullable().optional();
const isoLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, 'Expected YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS]')
  .nullable();

const tone = z.enum(TONES);
/** One saved caption. `captions` in a request replaces the photo's whole saved set. */
const captionEntry = z.object({ tone, text: text(2000), edited: z.boolean().default(false) });
const textFields = {
  subject: nullableText(120),
  hashtags: nullableText(1000),
  captions: z.array(captionEntry).max(TONES.length),
  captionTone: tone.nullable(),
};

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
  subject: textFields.subject.optional(),
  hashtags: textFields.hashtags.optional(),
  captions: textFields.captions.optional(),
  captionTone: textFields.captionTone.optional(),
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
    ...textFields,
    takenAt: isoLocal,
    locationId: ulid.nullable(),
    categoryIds: z.array(ulid).max(50),
    published: z.boolean(),
    watermark: z.boolean(),
    sortOrder: z.number(),
    gpsLat: z.number().min(-90).max(90).nullable(),
    gpsLng: z.number().min(-180).max(180).nullable(),
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
    position: z.number(),
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

/** A file about to be uploaded, as far as the library can recognise it. */
export const duplicatesSchema = z.object({
  files: z
    .array(z.object({ key: text(40).min(1), originalFilename: nullableText(255), bytes: z.number().int().positive(), takenAt: isoLocal }))
    .min(1)
    .max(200),
});

// ───────────────────────── AI suggestions ─────────────────────────

/** ~4.5 MB of image once decoded: far more than the 1568 px JPEG the browser sends. */
const MAX_IMAGE_BASE64 = 6_000_000;

export const suggestSchema = z.object({
  image: z.string().min(100).max(MAX_IMAGE_BASE64).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected base64'),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  subject: nullableText(120).optional(),
  takenAt: isoLocal.optional(),
  locationId: ulid.nullable().optional(),
  categoryIds: z.array(ulid).max(50).default([]),
  camera: nullableText(120).optional(),
  lens: nullableText(120).optional(),
  focalLengthMm: optionalNumber,
  keywords: z.array(text(80)).max(60).default([]),
});
export type SuggestInput = z.infer<typeof suggestSchema>;

export const aiSettingsSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai']),
    blindTest: z.boolean(),
    styleNotes: text(4000),
    /** True clears the comparison results. */
    resetVotes: z.literal(true),
  })
  .partial();

export const aiVoteSchema = z.object({ winner: text(200).min(1), loser: text(200).min(1) });
