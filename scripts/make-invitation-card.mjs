/**
 * The invitation as a standalone image, for sending directly in a chat.
 *
 * Run with `npm run invite`. Output is committed.
 *
 * NOT an og:image and not part of the website. This is a file the couple attach
 * to a WhatsApp message with the link in the caption, so it is portrait 4:5 —
 * the tallest shape WhatsApp displays without cropping the preview in a chat
 * bubble — rather than the 1.91:1 a link preview wants. It is written to
 * `share/` rather than `public/` deliberately: nothing here is served by the
 * site, and putting it in `public/` would add a URL to the deploy. Moving it is
 * a one-line change if a download link is ever wanted.
 *
 * EVERY FACT ON THE CARD IS IMPORTED, NOT TYPED. The times and venues come from
 * src/data/wedding.ts, the same module the schedule, the venue cards and the
 * .ics endpoint read. An invitation is the one artefact where a wrong time is
 * unrecoverable — it gets forwarded, saved to camera rolls and screenshotted,
 * and there is no way to issue a correction to any of that. So a change to the
 * schedule reaches this card by re-running the script, and the times cannot
 * silently disagree with the website.
 *
 * All text is set as SVG paths from the font's own outlines — see
 * scripts/lib/text-to-path.mjs for why a rasteriser cannot be trusted with a
 * font this toolchain has not installed.
 *
 * ONE DEVIATION FROM THE SITE, on purpose. The site sets the small caps lines
 * (`.invite__when`, `.invite__where`) in Inter, its body face, and only the
 * names in Instrument Serif. Everything here is Instrument Serif, because
 * @fontsource-variable/inter ships .woff2 only and the outline reader handles
 * WOFF1 — WOFF2 is not merely brotli, it stores a transformed `glyf` table that
 * would have to be reversed first. The link preview card has the same
 * constraint and resolves it the same way, so the two generated artefacts at
 * least agree with each other.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { woffToTtf } from './lib/woff2ttf.mjs';
import { openFont } from './lib/text-to-path.mjs';
import { EVENTS, WEDDING_DATE_LABEL, formatTime } from '../src/data/wedding.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* From src/styles/global.css. Duplicated because this runs in Node with no CSS
   pipeline; if the tokens change, they change here too. */
const SHELL = '#FBF8F3';
const OCHRE = '#C58A2A';

const CARD = { width: 1080, height: 1350 };
const CX = CARD.width / 2;

const fontFile = (name) =>
  resolve(root, `node_modules/@fontsource/instrument-serif/files/${name}`);
const [regular, italic] = await Promise.all([
  readFile(fontFile('instrument-serif-latin-400-normal.woff')).then(woffToTtf),
  readFile(fontFile('instrument-serif-latin-400-italic.woff')).then(woffToTtf),
]);
const setRegular = openFont(regular);
const setItalic = openFont(italic);

/** "Steeja & Arjun" with an italic ampersand at 0.8em — the mark, as on the site. */
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

function centredLine(text, size, baseline, spacing = 0) {
  const measured = setRegular(text, size, 0, 0, spacing);
  return {
    d: setRegular(text, size, CX - measured.width / 2, baseline, spacing).d,
    width: measured.width,
  };
}

/* ---------------------------------------------------------------------------
   The photograph
   --------------------------------------------------------------------------- */

/* EPW09695 is 5760x8640 (2:3) and the card is 4:5, so a window has to be
   chosen rather than the frame merely resized. This one is measured against
   the landmark table in prepare-media.mjs, and its whole purpose is WHERE THE
   TWO OF THEM LAND: it puts her head at 51% of the card's height and the ledge
   they are sitting on at 94%, so the couple occupy the lower half and the type
   above them sits on wall rather than on faces.

   Narrower than the full frame (4600 of 5760) because cropping the width is
   what pushes them down the card and makes them larger; a full-width window
   puts her head at 41%, with the type crowding her. It costs the outer edges
   of the two wooden doors, which are the least interesting part of the frame. */
const WINDOW = { left: 580, top: 0, width: 4600, height: 5750 };

const photo = await sharp(resolve(root, 'src/assets/photos/EPW09695.jpg'))
  .extract(WINDOW)
  .resize(CARD.width, CARD.height)
  .toBuffer();

/* ---------------------------------------------------------------------------
   The type
   --------------------------------------------------------------------------- */

const mass = EVENTS.find((e) => e.id === 'mass');
const reception = EVENTS.find((e) => e.id === 'reception');
if (!mass || !reception) {
  throw new Error('EVENTS no longer contains both `mass` and `reception`.');
}

/** 'Sunday, 6 September 2026' -> 'SUNDAY · 6 SEPTEMBER 2026'. */
const dateLine = WEDDING_DATE_LABEL.replace(',', ' ·').toUpperCase();
const timeLine =
  `${mass.title} ${formatTime(mass.start)} · Reception ${formatTime(reception.start)}`;
/** 'Akaparambu, Kerala, India' -> 'Akaparambu'. */
const areaOf = (e) => e.area.split(',')[0].trim();
const placeLine = `${areaOf(mass)} & ${areaOf(reception)}, Kerala`;

/* Baselines, top to bottom. Her hair starts at y 689 — see WINDOW — so
   everything above stops well short of it, and the closing line sits at the
   foot of the card over the dark ledge. */
const LINES = [
  { text: 'TOGETHER WITH THEIR FAMILIES', size: 30, y: 150, spacing: 9, opacity: 0.88 },
  { text: dateLine, size: 42, y: 424, spacing: 7, opacity: 1 },
  { text: timeLine, size: 34, y: 487, spacing: 1.5, opacity: 0.92 },
  { text: placeLine, size: 34, y: 541, spacing: 1.5, opacity: 0.92 },
  /* The one line that failed the 400px check on the first pass. It is the
     only text on the card sitting over the two of them rather than over wall,
     and her dress there is a bright gingham — at chat size it washed out
     completely. The foot of the scrim carries it now; this opacity alone was
     not enough, and raising the size instead would have made it compete with
     the venue line above it. */
  { text: 'Details and RSVP on our website', size: 28, y: 1288, spacing: 4, opacity: 0.94 },
];

const NAME_SIZE = 152;
const names = nameMark(NAME_SIZE, CX, 300);

/* The safe measure: the inner hairline, less a margin of its own. Asserted
   because centred text does not overflow, it silently runs off BOTH edges. */
const SAFE = CARD.width - 2 * 96;
const drawn = LINES.map((l) => ({ ...l, ...centredLine(l.text, l.size, l.y, l.spacing) }));
for (const line of [{ text: 'Steeja & Arjun', width: names.width }, ...drawn]) {
  if (line.width > SAFE) {
    throw new Error(
      `"${line.text}" is ${Math.round(line.width)}px wide; the safe measure is ${SAFE}px. ` +
        'Reduce its size in LINES (or NAME_SIZE).',
    );
  }
}

/* ---------------------------------------------------------------------------
   The scrim, the frame, and the whole overlay
   --------------------------------------------------------------------------- */

/* Warm rather than grey. A neutral wash over this photograph turns the ochre
   wall — the reason this frame was chosen — a dead olive.

   Graded, because the card asks two things of it. Down to 42% it carries seven
   lines of cream type over a bright wall and a black-and-white mural, so it is
   heavy. Through the middle it lifts to almost nothing so the two of them read
   as themselves. It returns at the foot only as far as the closing line needs,
   and the ledge there is already dark. */
const SCRIM = `
  <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="rgb(38,24,14)" stop-opacity="0.74"/>
    <stop offset="24%"  stop-color="rgb(38,24,14)" stop-opacity="0.70"/>
    <stop offset="42%"  stop-color="rgb(34,21,12)" stop-opacity="0.62"/>
    <stop offset="52%"  stop-color="rgb(30,19,11)" stop-opacity="0.26"/>
    <stop offset="72%"  stop-color="rgb(26,16,10)" stop-opacity="0.20"/>
    <stop offset="84%"  stop-color="rgb(24,15,9)"  stop-opacity="0.46"/>
    <stop offset="92%"  stop-color="rgb(22,14,9)"  stop-opacity="0.68"/>
    <stop offset="100%" stop-color="rgb(20,13,8)"  stop-opacity="0.84"/>
  </linearGradient>`;

/* The double hairline, which is the site's invitation frame in its ORIGINAL
   form — Invitation.astro still records that the type "used to be printed over
   the picture inside a double-hairline frame" before it became a card with a
   single inset border. This is that frame, over that picture, which is what it
   was for.

   The ochre is the site's exactly. The OPACITY is not: the site sets its
   hairline at 30%, calibrated against a near-white card, and 30% ochre over a
   dark scrimmed photograph is invisible. These are the values at which the
   frame reads at chat size without becoming a box the eye lands on first.

   Widths are 3px and 2px rather than the site's 1px for the same reason —
   1080px of card shown ~400px wide in a thread is a 2.7x reduction, and a 1px
   line does not survive it. */
const INSET_OUTER = 38;
const INSET_INNER = 54;
const frame = (inset, width, opacity) =>
  `<rect x="${inset}" y="${inset}" width="${CARD.width - inset * 2}" height="${CARD.height - inset * 2}"
         fill="none" stroke="${OCHRE}" stroke-opacity="${opacity}" stroke-width="${width}"/>`;

const RULE_HALF = 108;
const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}">
  <defs>${SCRIM}</defs>
  <rect width="100%" height="100%" fill="url(#scrim)"/>
  ${frame(INSET_OUTER, 3, 0.62)}
  ${frame(INSET_INNER, 2, 0.42)}
  <path d="${names.d}" fill="${SHELL}"/>
  <path d="M${CX - RULE_HALF} 352 H${CX + RULE_HALF}" stroke="${OCHRE}" stroke-width="3"/>
  ${drawn
    .map((l) => `<path d="${l.d}" fill="${SHELL}" fill-opacity="${l.opacity}"/>`)
    .join('\n  ')}
</svg>`);

/* ---------------------------------------------------------------------------
   Write it
   --------------------------------------------------------------------------- */

const OUT_DIR = resolve(root, 'share');
await mkdir(OUT_DIR, { recursive: true });
const OUT = resolve(OUT_DIR, 'steeja-arjun-invitation-1080x1350.jpg');

/* Quality 92 at full chroma. The budget is 1 MB and this lands near a fifth of
   it, so there is nothing to buy by spending less — and this is fine cream
   serif over a photograph, which is where 4:2:0 shows first. It is also the
   one artefact here that people will pinch-to-zoom. */
const info = await sharp(photo)
  .composite([{ input: overlay, left: 0, top: 0 }])
  .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(OUT);

const kb = info.size / 1024;
if (kb > 1024) {
  throw new Error(`The card is ${kb.toFixed(0)} kB, over the 1 MB ceiling. Lower the quality.`);
}
if (info.width !== CARD.width || info.height !== CARD.height) {
  throw new Error(`Card came out ${info.width}x${info.height}, not ${CARD.width}x${CARD.height}.`);
}

console.log(`  share/steeja-arjun-invitation-1080x1350.jpg  ${info.width}x${info.height}  ${kb.toFixed(0)} kB`);
console.log(`  date   ${dateLine}`);
console.log(`  times  ${timeLine}`);
console.log(`  place  ${placeLine}`);
