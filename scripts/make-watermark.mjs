#!/usr/bin/env node
/**
 * Renders the watermark text to a transparent PNG at public/watermark.png.
 * The image route (milestone 4) draws it bottom-right on derivatives >= 1600 px,
 * scaled to ~18% of the long edge at 60% opacity (docs/DESIGN.md, "Watermark").
 *
 * Usage: pnpm watermark ["© Your Name"]
 * Rendered large (1200 px wide) so it stays crisp when scaled down.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const text = process.argv[2] ?? '© Jaygovind Sahu';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/watermark.png');

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// White text with a soft dark shadow so it reads on bright skies and dark night shots alike.
// Font falls back through common sans faces when Instrument Sans isn't installed locally.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="320">
  <defs>
    <filter id="shadow" x="-10%" y="-30%" width="120%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <text x="40" y="210" font-family="Instrument Sans, Inter, Helvetica, Arial, DejaVu Sans, sans-serif"
        font-size="150" font-weight="500" letter-spacing="3" fill="#ffffff" filter="url(#shadow)">${escapeXml(text)}</text>
</svg>`;

await mkdir(dirname(out), { recursive: true });

const trimmed = await sharp(Buffer.from(svg)).png().trim({ threshold: 1 }).toBuffer();
await sharp(trimmed)
  .extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize({ width: 1200 })
  .png({ compressionLevel: 9 })
  .toFile(out);

const meta = await sharp(out).metadata();
console.log(`Wrote ${out} (${meta.width}×${meta.height}) for "${text}"`);
