// Generates the test JPEGs from the milestone 3 checks: landscape, portrait (EXIF-rotated),
// one with GPS, one with no EXIF, one ~30 MB. Usage: node tests/fixtures/make-fixtures.mjs
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const out = path.dirname(fileURLToPath(import.meta.url));
await mkdir(out, { recursive: true });

const exif = (extra = {}) => ({
  IFD0: { Make: 'NIKON CORPORATION', Model: 'NIKON Z50_2', Software: 'Adobe Lightroom', ...(extra.IFD0 ?? {}) },
  IFD2: {
    DateTimeOriginal: '2026:10:12 14:03:11',
    FNumber: '63/10',
    ExposureTime: '1/2000',
    ISOSpeedRatings: '1600',
    FocalLength: '400/1',
    ExposureBiasValue: '-1/3',
    LensModel: 'TAMRON 50-400mm F4.5-6.3 Di III VC VXD',
    ...(extra.IFD2 ?? {}),
  },
  ...(extra.IFD3 ? { IFD3: extra.IFD3 } : {}),
});

/** A scene with an unmistakable "up": bright sky band on top, dark ground at the bottom, a red mark top-left. */
function scene(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h * 0.6}" fill="#7fb7e6"/>
    <rect y="${h * 0.6}" width="${w}" height="${h * 0.4}" fill="#2d4a1e"/>
    <circle cx="${w * 0.15}" cy="${h * 0.15}" r="${Math.min(w, h) * 0.06}" fill="#d33"/>
    <text x="${w / 2}" y="${h * 0.55}" font-size="${h / 8}" text-anchor="middle" fill="#fff" font-family="sans-serif">${w}x${h}</text>
  </svg>`;
  return sharp(Buffer.from(svg));
}

// 1. Landscape with full EXIF.
await scene(3000, 2000).jpeg({ quality: 90 }).withExif(exif()).toFile(path.join(out, 'landscape.jpg'));

// 2. Portrait stored sideways (3000x2000 pixels) with Orientation 6: must display as 2000x3000.
await scene(3000, 2000)
  .jpeg({ quality: 90 })
  .withMetadata({ orientation: 6 })
  .withExif(exif({ IFD0: { Orientation: '6' } }))
  .toFile(path.join(out, 'portrait-rotated.jpg'));

// 3. With GPS (Bombay Hook NWR, roughly).
await scene(2400, 1600)
  .jpeg({ quality: 90 })
  .withExif(
    exif({
      IFD3: {
        GPSVersionID: '2 3 0 0',
        GPSLatitudeRef: 'N',
        GPSLatitude: '39/1 15/1 30/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '75/1 27/1 0/1',
      },
    }),
  )
  .toFile(path.join(out, 'gps.jpg'));

// 4. No EXIF at all.
await scene(1800, 1200).jpeg({ quality: 90 }).toFile(path.join(out, 'noexif.jpg'));

// 5. ~30 MB: random noise compresses badly.
{
  const w = 7500;
  const h = 5000;
  const raw = randomBytes(w * h * 3);
  const buf = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).withExif(exif()).toBuffer();
  await writeFile(path.join(out, 'big.jpg'), buf);
  console.log(`big.jpg: ${(buf.length / 1048576).toFixed(1)} MB`);
}
console.log('fixtures written to', out);
