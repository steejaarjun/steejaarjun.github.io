/**
 * Everything that carries the couple's mark outside the page itself: the link
 * preview card, the favicons, the touch icon and the manifest.
 *
 * Run with `npm run brand`. Outputs are committed, so a deploy never depends on
 * this script running — but re-run it after changing the palette, the display
 * face or the hero crop, or the assets quietly stop matching the site.
 *
 * All text is set as SVG paths lifted from the font's own outlines rather than
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

/* Composed, not cropped. A 1200x630 slice of a portrait photograph is a
   letterbox of somebody's midriff; this is the photograph as a ground with the
   invitation laid over it, which is what a guest should see in a chat thread.
   The crop window is the one from prepare-media.mjs — chosen around the two of
   them, see the landmark table there. */
const heroCrop = { left: 470, top: 2500, width: 4820, height: 2530 };

const photo = await sharp(resolve(root, 'src/assets/photos/EPW09695.jpg'))
  .extract(heroCrop)
  .resize(OG.width, OG.height, { fit: 'cover' })
  .toBuffer();

/* The scrim. Deeper than the page's, and unapologetically so: this is read at
   thumbnail size in a chat list, often on a phone at arm's length, and the type
   has to hold at 200px wide. Warm rather than grey — see the note on
   --shade-rgb; a neutral wash turns the ochre wall behind them muddy. */
const inset = 34;
const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG.width}" height="${OG.height}">
  <defs>
    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgb(24,16,11)" stop-opacity="0.62"/>
      <stop offset="42%"  stop-color="rgb(24,16,11)" stop-opacity="0.46"/>
      <stop offset="100%" stop-color="rgb(20,13,9)"  stop-opacity="0.78"/>
    </linearGradient>
    <radialGradient id="c" cx="50%" cy="46%" r="72%">
      <stop offset="0%"   stop-color="rgb(24,16,11)" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="rgb(24,16,11)" stop-opacity="0.52"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#v)"/>
  <rect width="100%" height="100%" fill="url(#c)"/>
  <rect x="${inset}" y="${inset}" width="${OG.width - inset * 2}" height="${OG.height - inset * 2}"
        fill="none" stroke="${SHELL}" stroke-opacity="0.42" stroke-width="1.5"/>
  <path d="${centredLine('TOGETHER WITH THEIR FAMILIES', 21, OG.width / 2, 214, 7)}"
        fill="${SHELL}" fill-opacity="0.86"/>
  <path d="${nameMark(126, OG.width / 2, 350).d}" fill="${SHELL}"/>
  <path d="M${OG.width / 2 - 66} 392 H${OG.width / 2 + 66}" stroke="${SHELL}" stroke-opacity="0.5" stroke-width="1"/>
  <path d="${centredLine('SUNDAY, 6 SEPTEMBER 2026', 30, OG.width / 2, 452, 6)}" fill="${SHELL}"/>
  <path d="${centredLine('KERALA, INDIA', 23, OG.width / 2, 496, 5)}" fill="${SHELL}" fill-opacity="0.82"/>
</svg>`);

/* Quality 84 lands this comfortably under the 300 kB WhatsApp will silently
   refuse to render as a large card. The assertion below is the real guard. */
const ogInfo = await sharp(photo)
  .composite([{ input: overlay }])
  .jpeg({ quality: 84, chromaSubsampling: '4:2:0', mozjpeg: true })
  .toFile(out('og-steeja-arjun.jpg'));

const ogKb = ogInfo.size / 1024;
if (ogKb > 290) {
  throw new Error(
    `og-steeja-arjun.jpg is ${ogKb.toFixed(0)} kB. WhatsApp drops previews over ` +
      '300 kB without saying so — lower the JPEG quality above.',
  );
}
console.log(`  og-steeja-arjun.jpg        ${ogInfo.width}x${ogInfo.height}  ${ogKb.toFixed(0)} kB`);

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
