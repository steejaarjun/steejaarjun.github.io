/**
 * TEMPORARY. Delete this file, the three `src/pages/og-test-*.astro` pages, the
 * three `public/og-test-*.jpg` images and the sitemap exclusion in
 * astro.config.mjs once the question below is answered.
 *
 * THE QUESTION
 *
 * WhatsApp renders our link as the small card — square thumbnail on the left,
 * text beside it — while another wedding site (withjoy.com) renders as the
 * large card with the image on top. Both pages satisfy every requirement Meta
 * documents for the large preview, so the documented rules do not discriminate
 * between them. The one salient difference is the shape of the image:
 *
 *   withjoy   480x679   PORTRAIT, ratio 0.71   125.8 kB   no og:image:width/height
 *   ours     1200x630   LANDSCAPE, ratio 1.91  113.6 kB   width and height both set
 *
 * THE EXPERIMENT
 *
 * Three pages, identical in every respect except the shape of the image they
 * point at. All three URLs are new, so none of them is in any preview cache and
 * the control is as fresh as the tests — sharing the production URL with a `?v=`
 * would not be a clean control, because Facebook's scraper keys its cache on
 * og:url rather than on the URL it was handed, and og:url there is the
 * already-scraped canonical.
 *
 *   og-test-wide    1200x630   the production geometry. Should reproduce the
 *                              small card. If it does NOT, the cause was cache
 *                              all along and the other two prove nothing.
 *   og-test-tall    1000x1414  withjoy's ratio at a comparable resolution.
 *   og-test-clone    480x679   withjoy's exact pixel dimensions.
 *
 * READING THE RESULT
 *
 *   tall AND clone large, wide small  → the shape decides it. Re-shape the card.
 *   clone large, tall small           → absolute pixel size decides it.
 *   all three small                   → it is not the image. Nothing in our
 *                                       control changes it; stop.
 *   all three large                   → it was cache. Stop.
 *
 * Each image is labelled with its own geometry so the three are impossible to
 * confuse in a chat thread.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { woffToTtf } from './lib/woff2ttf.mjs';
import { openFont } from './lib/text-to-path.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (file) => resolve(root, 'public', file);
const SHELL = '#FBF8F3';
const SOURCE = resolve(root, 'src/assets/photos/IMG_4764.jpg');

const fontFile = (name) =>
  resolve(root, `node_modules/@fontsource/instrument-serif/files/${name}`);
const setRegular = openFont(
  await readFile(fontFile('instrument-serif-latin-400-normal.woff')).then(woffToTtf),
);

function centredLine(text, size, centreX, baseline, spacing) {
  const measured = setRegular(text, size, 0, 0, spacing);
  return setRegular(text, size, centreX - measured.width / 2, baseline, spacing).d;
}

const CASES = [
  { file: 'og-test-wide.jpg', width: 1200, height: 630, label: 'WIDE 1200 x 630' },
  { file: 'og-test-tall.jpg', width: 1000, height: 1414, label: 'TALL 1000 x 1414' },
  { file: 'og-test-clone.jpg', width: 480, height: 679, label: 'CLONE 480 x 679' },
];

for (const { file, width, height, label } of CASES) {
  /* Cover-crop, because the point here is the SHAPE of the file, not the
     composition inside it. Content fidelity is irrelevant — no previewer looks
     at what the picture is of. */
  const photo = await sharp(SOURCE).resize(width, height, { fit: 'cover' }).toBuffer();

  /* Label sized off the narrow edge so it stays readable in all three shapes. */
  const type = Math.round(Math.min(width, height) * 0.075);
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="rgb(20,13,9)" fill-opacity="0.62"/>
    <path d="${centredLine(label, type, width / 2, height / 2, type * 0.12)}" fill="${SHELL}"/>
  </svg>`);

  const info = await sharp(photo)
    .composite([{ input: overlay }])
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(out(file));

  const kb = info.size / 1024;
  if (kb > 290) throw new Error(`${file} is ${kb.toFixed(0)} kB, over the WhatsApp budget.`);
  console.log(
    `  ${file.padEnd(22)} ${info.width}x${info.height}`.padEnd(48) +
      `ratio ${(info.width / info.height).toFixed(2)}  ${kb.toFixed(0)} kB`,
  );
}
