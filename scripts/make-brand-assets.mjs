/**
 * Everything that carries the couple's mark outside the page itself: the link
 * preview card, the favicons, the touch icon and the manifest.
 *
 * Run with `npm run brand`. Outputs are committed, so a deploy never depends on
 * this script running — but re-run it after changing the palette, the display
 * face or the source photograph, or the assets quietly stop matching the site.
 *
 * All text — the invitation on the link preview card, the monogram on the icons
 * — is set as SVG paths lifted from the font's own outlines rather than
 * rasterised by a text engine. See scripts/lib/text-to-path.mjs for why: three
 * separate font-loading routes were tried and every one of them fell back to
 * the system serif *without erroring*, which would have shipped the wrong
 * typeface to every WhatsApp group the link is pasted into.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { woffToTtf } from './lib/woff2ttf.mjs';
import { openFont } from './lib/text-to-path.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (file) => resolve(root, 'public', file);

/* The palette, from src/styles/global.css. Duplicated rather than imported
   because this runs in Node with no CSS pipeline; if the tokens change, they
   change here too. */
const SHELL = '#FBF8F3';
const INK = '#241C18';
const OCHRE = '#C58A2A';

const fontFile = (name) =>
  resolve(root, `node_modules/@fontsource/instrument-serif/files/${name}`);

const [regular, italic] = await Promise.all([
  readFile(fontFile('instrument-serif-latin-400-normal.woff')).then(woffToTtf),
  readFile(fontFile('instrument-serif-latin-400-italic.woff')).then(woffToTtf),
]);

const setRegular = openFont(regular);
const setItalic = openFont(italic);

/**
 * "Steeja & Arjun" with an italic ampersand at 0.8em — the same construction as
 * the top-bar monogram. It is the mark, not merely the two names, so the card
 * and the icons are built from it rather than from plain text.
 */
function nameMark(size, centreX, baseline) {
  const ampSize = size * 0.8;
  const left = setRegular('Steeja ', size, 0, 0);
  const amp = setItalic('&', ampSize, 0, 0);
  const right = setRegular(' Arjun', size, 0, 0);

  const total = left.width + amp.width + right.width;
  let x = centreX - total / 2;

  const d = [
    setRegular('Steeja ', size, x, baseline).d,
    setItalic('&', ampSize, (x += left.width), baseline).d,
    setRegular(' Arjun', size, (x += amp.width), baseline).d,
  ].join('');

  return { d, width: total };
}

/** Centred, letter-spaced small caps line. */
function centredLine(text, size, centreX, baseline, spacing) {
  const measured = setRegular(text, size, 0, 0, spacing);
  return setRegular(text, size, centreX - measured.width / 2, baseline, spacing).d;
}

/* -------------------------------------------------------------------------
   1. The link preview card, 1200x630
   ------------------------------------------------------------------------- */

const OG = { width: 1200, height: 630 };

/* The source is a PORTRAIT photograph — 4000x6000, a 2:3 frame — and the card
   it has to fill is 1.905:1. Those two numbers are the whole design of this
   block, because every link preview surface centre-crops to its own ratio and
   none of them ask first. Cropping 2:3 to 1.905:1 keeps 32% of the height: on
   a full-length standing photograph that is a band across two people's chests,
   with both of their heads outside it.
                                                                       .
   So the photograph is CONTAINED, not covered. It lands 420x630 — its full
   height, nothing cropped, nothing stretched — and the 390px either side is
   filled with the photograph itself, blown up to the card and blurred past the
   point of being a picture. That fill is the reason this is not letterboxing:
   the panels carry the frame's own tones, the dark trees along the top and the
   grass along the bottom, so the eye reads depth behind the photograph rather
   than two bars beside it.
                                                                       .
   `fit: 'fill'` for the backdrop, and the horizontal stretch is deliberate. It
   is the whole 4000x6000 frame squashed to 1200x630, which keeps the full
   top-to-bottom tonal range; the alternative, `cover`, samples only the middle
   2100 rows and produced a flat mid-tone smear with a warm streak down the
   left. Under a 42px blur the distortion is not resolvable and the tonal range
   is what survives. Nothing about the CONTAINED photograph is stretched.
                                                                       .
   The photograph is not what carries this card at thumbnail size — the TYPE is,
   and that is what makes the contain affordable. At 420 of 1200px the two of
   them are about 90px across in a chat list, too small to read as faces; the
   names and the date are set large enough to survive the same reduction, so
   nothing load-bearing depends on the photograph being legible. See the scrim
   and the type block below. */
const SOURCE = 'src/assets/photos/IMG_4764.jpg';

const card = await sharp(resolve(root, SOURCE))
  .resize({ height: OG.height, fit: 'inside' })
  .toBuffer();

const cardWidth = (await sharp(card).metadata()).width;
const cardLeft = Math.round((OG.width - cardWidth) / 2);

/* The one assumption this composition makes about its source, asserted rather
   than trusted. Fitting to the card's HEIGHT only leaves room either side while
   the source is taller than 1.905:1; hand it a landscape photograph and
   `cardWidth` exceeds 1200, `cardLeft` goes negative, and sharp composites it
   off the left edge — cropping the thing this whole block exists to keep whole,
   without failing. prepare-media.mjs asserts its source frame for the same
   reason; this is the sibling guard it was missing. */
if (cardWidth > OG.width) {
  throw new Error(
    `${SOURCE} is landscape or wider than ${OG.width}x${OG.height} — fitted to ` +
      `${cardWidth}px wide, which does not fit the card. This block contains a ` +
      'PORTRAIT photograph and centres it; a landscape source wants a crop, ' +
      'not a contain, so rewrite the composition rather than loosening this.',
  );
}

const backdrop = await sharp(resolve(root, SOURCE))
  .resize(OG.width, OG.height, { fit: 'fill' })
  .blur(42)
  /* Down to half brightness and off the saturation, so the panels stay behind
     the photograph instead of competing with it. Without this the blurred
     grass is the brightest thing on the card. */
  .modulate({ brightness: 0.5, saturation: 0.7 })
  .toBuffer();

/* A hairline down each seam. One pixel of shell at 38% is not decoration — it
   is what stops the contained edge dissolving into a backdrop made of the same
   colours, which is exactly when a composed card starts looking like a
   rendering accident. */
const seams = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG.width}" height="${OG.height}">
  <line x1="${cardLeft}" y1="0" x2="${cardLeft}" y2="${OG.height}"
        stroke="${SHELL}" stroke-opacity="0.38" stroke-width="1"/>
  <line x1="${cardLeft + cardWidth}" y1="0" x2="${cardLeft + cardWidth}" y2="${OG.height}"
        stroke="${SHELL}" stroke-opacity="0.38" stroke-width="1"/>
</svg>`);

/* The scrim, and the invitation set over it.

   TWO JOBS, PULLING OPPOSITE WAYS. The type is shell-white and has to hold at
   the ~400px a chat list renders this at, which wants the ground as dark as
   possible; the two of them have to stay visible, which wants it light. So the
   scrim is not one value — it is a vertical ramp, weighted by what is at each
   height. Their faces sit between 13% and 30% of the card and are held at
   0.30-0.42, dark enough to sit back and light enough to read as people. From
   44% down, where the type starts, it deepens to 0.88 and the photograph
   becomes a texture. Warm rather than grey: a neutral wash turns the grass and
   the lamp behind them muddy.

   THE TYPE IS BIG ON PURPOSE, roughly 60% larger than the card this replaced.
   The test is not how it looks here — it is how it looks reduced to 400px,
   which is the only size most guests will ever see it at, and at that size the
   old 30px date came out near 10px and could not be read. 58px is 19px there.
   If you change a size in this block, scale the output to 400px wide and look
   at it before believing it.

   The block clears the faces deliberately: the names start at y 275 and their
   chins are above y 200. */
const NAME_SIZE = 200;
const DATE_SIZE = 58;
const PLACE_SIZE = 44;
const CENTRE_X = OG.width / 2;

const names = nameMark(NAME_SIZE, CENTRE_X, 415);

/* 933 of 1200px at NAME_SIZE 200. Asserted because the failure is silent —
   `nameMark` centres whatever width it computes, so an oversized face or a
   longer string runs off both edges of the card rather than erroring. */
if (names.width > OG.width - 120) {
  throw new Error(
    `The name mark is ${Math.round(names.width)}px wide at size ${NAME_SIZE}, ` +
      `which leaves under 60px of margin on a ${OG.width}px card. Reduce NAME_SIZE.`,
  );
}

const RULE_HALF = 150;
const RULE_Y = 452;

const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG.width}" height="${OG.height}">
  <defs>
    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgb(24,16,11)" stop-opacity="0.30"/>
      <stop offset="18%"  stop-color="rgb(24,16,11)" stop-opacity="0.32"/>
      <stop offset="32%"  stop-color="rgb(24,16,11)" stop-opacity="0.42"/>
      <stop offset="44%"  stop-color="rgb(22,15,10)" stop-opacity="0.64"/>
      <stop offset="62%"  stop-color="rgb(20,13,9)"  stop-opacity="0.80"/>
      <stop offset="100%" stop-color="rgb(20,13,9)"  stop-opacity="0.88"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#v)"/>
  <path d="${names.d}" fill="${SHELL}"/>
  <path d="M${CENTRE_X - RULE_HALF} ${RULE_Y} H${CENTRE_X + RULE_HALF}"
        stroke="${OCHRE}" stroke-width="3"/>
  <path d="${centredLine('SUNDAY, 6 SEPTEMBER 2026', DATE_SIZE, CENTRE_X, 520, 6)}" fill="${SHELL}"/>
  <path d="${centredLine('KERALA, INDIA', PLACE_SIZE, CENTRE_X, 575, 5)}"
        fill="${SHELL}" fill-opacity="0.85"/>
</svg>`);

/* The filename is versioned and that is load-bearing, not descriptive.
   WhatsApp, iMessage and Facebook cache a preview against the og:image URL and
   hold it for weeks; re-pointing this at the same path would leave every guest
   who has already seen the link looking at the previous card indefinitely. A
   new path is the only reliable way to break that, so a future replacement
   should change this name again rather than overwrite this file. It has already
   been `og-steeja-arjun.jpg` and `og-steeja-arjun-garden.jpg`; neither is still
   served, and that is intended. */
const OG_FILE = 'og-steeja-arjun-invitation.jpg';

/* Quality 95 at full chroma resolution, which is high for a JPEG and is the
   right call HERE specifically: this card is fine white type on a dark ground,
   which is the worst case for a JPEG. 4:2:0 halves the colour resolution and
   puts ringing along exactly the high-contrast edges the serif is made of, and
   it shows first on the thin strokes and on the ochre rule — a 3px line whose
   colour is the only chroma detail on the card. The budget is 300 kB and there
   is no reason to leave it unspent. The assertion below is the real guard.

   Composite order matters: backdrop, photograph, seams, THEN the scrim and type
   over all three. The seams sit under the scrim so they are dimmed with
   everything else — drawn on top they would cut two bright vertical lines
   through the names. */
const ogInfo = await sharp(backdrop)
  .composite([
    { input: card, left: cardLeft, top: 0 },
    { input: seams, left: 0, top: 0 },
    { input: overlay, left: 0, top: 0 },
  ])
  .jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(out(OG_FILE));

const ogKb = ogInfo.size / 1024;
if (ogKb > 290) {
  throw new Error(
    `${OG_FILE} is ${ogKb.toFixed(0)} kB. WhatsApp drops previews over ` +
      '300 kB without saying so — lower the JPEG quality above.',
  );
}

/* The card is the one asset here whose dimensions are also written down
   somewhere else — og:image:width and og:image:height in Base.astro, which
   WhatsApp reads to decide between a large card and a small square thumbnail
   BEFORE it has fetched the file. A silent disagreement between the two
   demotes the preview, so this refuses to be the half that drifted. */
if (ogInfo.width !== OG.width || ogInfo.height !== OG.height) {
  throw new Error(
    `${OG_FILE} came out ${ogInfo.width}x${ogInfo.height}, not ${OG.width}x${OG.height}. ` +
      'og:image:width/height in src/layouts/Base.astro are hard-coded to the ' +
      'latter and are what WhatsApp sizes the card from.',
  );
}
console.log(`  ${OG_FILE}  ${ogInfo.width}x${ogInfo.height}  ${ogKb.toFixed(0)} kB` +
  `  (photo ${cardWidth}x${OG.height} contained, ${cardLeft}px fill each side)`);

/* -------------------------------------------------------------------------
   2. The monogram, and the icons cut from it
   ------------------------------------------------------------------------- */

/** "S & A" centred in a `size` box, as path data. */
function monogram(size) {
  const glyph = size * 0.46;
  const ampSize = glyph * 0.8;
  const s = setRegular('S', glyph, 0, 0);
  const amp = setItalic('&', ampSize, 0, 0);
  const a = setRegular('A', glyph, 0, 0);
  const gap = size * 0.075;

  const total = s.width + gap + amp.width + gap + a.width;
  let x = size / 2 - total / 2;
  /* Optical centring: cap-height text centred on its baseline sits low, so the
     baseline is pushed down by roughly a third of the cap height. */
  const baseline = size / 2 + glyph * 0.35;

  const d = [
    setRegular('S', glyph, x, baseline).d,
    setItalic('&', ampSize, (x += s.width + gap), baseline).d,
    setRegular('A', glyph, (x += amp.width + gap), baseline).d,
  ].join('');

  return d;
}

/* favicon.svg — ink on transparent, flipping to shell in a dark UI. The media
   query lives *inside* the SVG because a favicon is never styled by the page
   that references it; this is the only way it can respond to the theme. */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <style>
    path { fill: ${INK}; }
    @media (prefers-color-scheme: dark) { path { fill: ${SHELL}; } }
  </style>
  <path d="${monogram(64)}"/>
</svg>`;
await writeFile(out('favicon.svg'), faviconSvg);
console.log(`  favicon.svg                64x64     ${(faviconSvg.length / 1024).toFixed(1)} kB`);

/* The raster icons are ink-on-shell rather than transparent: iOS composites a
   touch icon onto white and Android onto the manifest background, so a
   transparent monogram would lose its ground and its rounded corners. */
const solidIcon = (size, fg, bg) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
     <rect width="${size}" height="${size}" fill="${bg}"/>
     <path d="${monogram(size)}" fill="${fg}"/>
   </svg>`,
);

for (const [file, size, fg, bg] of [
  ['apple-touch-icon.png', 180, SHELL, INK],
  ['icon-192.png', 192, SHELL, INK],
  ['icon-512.png', 512, SHELL, INK],
]) {
  const info = await sharp(solidIcon(size, fg, bg)).png({ compressionLevel: 9 }).toFile(out(file));
  console.log(`  ${file.padEnd(26)} ${info.width}x${info.height}   ${(info.size / 1024).toFixed(1)} kB`);
}

/* favicon.ico — a 32x32 PNG in an ICO container. sharp cannot write .ico, but
   the format has allowed a PNG payload since Vista and every browser that
   still asks for favicon.ico understands it. The container is 22 bytes. */
const icoPng = await sharp(solidIcon(32, SHELL, INK)).png({ compressionLevel: 9 }).toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // palette size: 0 = truecolour
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(icoPng.length, 14);
header.writeUInt32LE(22, 18); // payload offset
await writeFile(out('favicon.ico'), Buffer.concat([header, icoPng]));
console.log(`  favicon.ico                32x32     ${((22 + icoPng.length) / 1024).toFixed(1)} kB`);

/* -------------------------------------------------------------------------
   3. Manifest
   ------------------------------------------------------------------------- */

/* The deploy root, baked in: every path in a manifest resolves against the
   manifest's own location, and this file is written to public/ and served
   verbatim, so it cannot import `withBase` and cannot read Astro's BASE_URL.

   `/`, because the site is a GitHub Pages USER site — the repository is named
   `steejaarjun.github.io` and GitHub serves it at the root of the account's
   hostname. It was '/wedding-steeja-arjun/' for the earlier PROJECT site, where
   the repository lived under a path. It was also `/` on Cloudflare Pages, which
   is why the move between those two hosts did not touch this line.

   This is one of exactly two places that carry the deploy root independently —
   the other is the file this writes, public/site.webmanifest, which is
   committed. Keep both in step with the deploy root: `base` in astro.config.mjs
   when there is one, and `/` when, as now, there is not. Nothing checks that
   they agree, and a wrong `scope` here does not break the site — it breaks
   installing it to a home screen, which nobody tests. */
const BASE = '/';

const manifest = {
  name: 'Steeja & Arjun — 6 September 2026',
  short_name: 'Steeja & Arjun',
  description: "Steeja and Arjun are getting married in Kerala. Come celebrate with us.",
  start_url: BASE,
  scope: BASE,
  display: 'standalone',
  theme_color: SHELL,
  background_color: SHELL,
  icons: [
    { src: `${BASE}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${BASE}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${BASE}favicon.svg`, sizes: 'any', type: 'image/svg+xml' },
  ],
};

await mkdir(resolve(root, 'public'), { recursive: true });
await writeFile(out('site.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('  site.webmanifest');
