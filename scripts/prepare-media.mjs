/**
 * Derives everything the page actually imports, so the 5760x8640 originals are
 * archival only and can never reach `dist/` — Astro copies an imported original
 * into the build alongside its transforms, and a 10 MB JPEG on a Pages deploy
 * is not a rounding error.
 *
 *  1. `EPW09695-wide.jpg`  — the full 2:3 frame, capped at the largest width the
 *     page ever requests (1920). Used at 900px and up.
 *  2. `EPW09695-phone.jpg` — the art-direction crop. Astro can resize but it
 *     cannot re-frame, and on a tall phone the full frame leaves the couple too
 *     small; a 4:5 master keeps them tight.
 *
 * Outputs are committed, so CI never touches the original.
 * Re-run with `npm run media` after replacing a source photo.
 *
 * The link preview card is NOT built here, and used to be. It was a fourth
 * entry writing `public/og-steeja-arjun.jpg` — at the time, the very path
 * scripts/make-brand-assets.mjs also wrote, from a different source with a
 * different crop and no type on it. Two generators, one filename, no error:
 * whichever script ran last won, so `npm run media` after `npm run brand`
 * quietly replaced the composed card with a bare crop and nothing said so.
 * The card belongs to make-brand-assets.mjs alone — it writes
 * `public/og-steeja-arjun-garden.jpg` now, and a different name is not a
 * reason to reintroduce this. Do not add it back here.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HERO = resolve(root, 'src/assets/photos/EPW09695.jpg');
const STORY = resolve(root, 'src/assets/photos/EPW00926.jpg');

/** Widest entry in the page's `widths` array — see src/lib/hero-media.ts. */
const MAX_WIDTH = 1920;

/**
 * Landmarks in the 5760x8640 original, used to reason about the crops:
 *   y  240  top of the bird mural
 *   y 1440  bird body
 *   y 3050  top of her hair
 *   y 4370  his chin
 *   y 5570  top edge of the ledge
 *   y 7680  her sandals
 */
const OUTPUTS = [
  {
    source: STORY,
    file: 'src/assets/photos/EPW00926-4x5.jpg',
    // Our Story renders at aspect-ratio 4/5, so the master is cut to 4:5 and
    // `object-fit: cover` never has to throw pixels away. 900 keeps headroom
    // above his hair and lands the bottom edge just above the burnt-in studio
    // watermark — the credit is given in the caption instead.
    crop: { left: 0, top: 900, width: 5760, height: 7200 },
    out: { width: MAX_WIDTH, height: 2400 },
    encode: { quality: 94, chromaSubsampling: '4:4:4' },
  },
  {
    source: HERO,
    file: 'src/assets/photos/EPW09695-wide.jpg',
    // Full frame, uncropped.
    crop: { left: 0, top: 0, width: 5760, height: 8640 },
    out: { width: MAX_WIDTH, height: 2880 },
    // Re-encoded by astro:assets afterwards, so kept near-lossless to avoid
    // stacking two rounds of JPEG artefacts on the wall texture.
    encode: { quality: 94, chromaSubsampling: '4:4:4' },
  },
  {
    source: HERO,
    file: 'src/assets/photos/EPW09695-phone.jpg',
    // 4:5 — 5760x7200 leaves 1440px of vertical play; 900 keeps the bird
    // above them and her sandals just inside the bottom edge.
    crop: { left: 0, top: 900, width: 5760, height: 7200 },
    out: { width: MAX_WIDTH, height: 2400 },
    encode: { quality: 94, chromaSubsampling: '4:4:4' },
  },
];

for (const source of new Set(OUTPUTS.map((o) => o.source))) {
  const meta = await sharp(source).metadata();
  console.log(`source  ${source.split('/').pop()}  ${meta.width}x${meta.height}`);
  if (meta.width !== 5760 || meta.height !== 8640) {
    throw new Error(
      `Expected a 5760x8640 original, got ${meta.width}x${meta.height}. ` +
        'The crop windows above are hard-coded to that frame — re-measure them.',
    );
  }
}

/**
 * Gallery masters: resized, never cropped. The set deliberately mixes portrait
 * with landscape and colour with black and white, and normalising any of that
 * away would be the wrong call — so there is no assertion on dimensions here,
 * and no `extract`. 1920 is the widest the lightbox ever asks for.
 */
const GALLERY = [
  'EPK03357',
  'EPK03505',
  'EPK03516',
  'EPK03533',
  'EPW00926',
  'EPW01498',
  'EPW09695',
  'EPW09924',
];

for (const name of GALLERY) {
  const target = resolve(root, `src/assets/photos/gallery/${name}.jpg`);
  await mkdir(dirname(target), { recursive: true });

  const info = await sharp(resolve(root, `src/assets/photos/${name}.jpg`))
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 90, chromaSubsampling: '4:2:0', mozjpeg: true })
    .toFile(target);

  console.log(
    `  gallery/${name}.jpg`.padEnd(40) +
      ` ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} kB`,
  );
}

for (const { source, file, crop, out, encode } of OUTPUTS) {
  const target = resolve(root, file);
  await mkdir(dirname(target), { recursive: true });

  const info = await sharp(source)
    .extract(crop)
    .resize(out.width, out.height, { fit: 'cover' })
    .jpeg({ ...encode, mozjpeg: true })
    .toFile(target);

  console.log(
    `  ${file.padEnd(38)} ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} kB`,
  );
}
