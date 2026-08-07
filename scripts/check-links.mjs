/**
 * Walks the built site and asserts that every internal reference resolves to a
 * file that exists in `dist/`, against a host that serves the site at ITS ROOT.
 *
 * This exists because the failure it catches is invisible. A wrong deploy base
 * does not break the build and does not break the HTML — the page renders, the
 * text is there, and every stylesheet, font, photograph and link 404s. It reads
 * as a styling bug, which is the wrong place to look.
 *
 * Run after `npm run build`, before pushing to a new host:
 *
 *     node scripts/check-links.mjs
 *
 * Exits non-zero if anything is missing, doubled, or points at a host other
 * than the one in `site`.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const SITE = 'https://steejaarjun.github.io';

/* Hosts this site has previously lived on. A build that still mentions one of
   these is a half-finished move, which is the specific thing that broke the
   last one. */
const STALE_HOSTS = [
  'steeja-arjun.pages.dev',
  'chirakkalcode.github.io',
  '/wedding-steeja-arjun/',
];

if (!existsSync(ROOT)) {
  console.error('dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

const html = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (entry.endsWith('.html')) html.push(p);
  }
})(ROOT);

const ATTR = /(?:href|src|srcset)\s*=\s*"([^"]+)"/g;

/* The meta tags whose `content` is a URL rather than prose, matched in both
   attribute orders because Astro does not guarantee one. These are absolute and
   they matter more than they look: og:image and og:url are the only version of
   this site most guests see before they tap the link, and a stale host there is
   invisible on the page itself. */
const META_URL = [
  /<meta[^>]+(?:property|name)="(?:og:image|og:image:secure_url|og:url|twitter:image)"[^>]*\scontent="([^"]+)"/g,
  /<meta[^>]+content="([^"]+)"[^>]*\s(?:property|name)="(?:og:image|og:image:secure_url|og:url|twitter:image)"/g,
];

const problems = [];
const external = new Set();
let checked = 0;

/** Resolves a site-absolute path the way a static file server would. */
function resolves(path) {
  const clean = decodeURIComponent(path.split('#')[0].split('?')[0]);
  return [
    join(ROOT, clean),
    join(ROOT, clean, 'index.html'),
    join(ROOT, `${clean.replace(/\/$/, '')}.html`),
  ].some((candidate) => existsSync(candidate));
}

function check(page, original, path) {
  checked += 1;
  if (path.slice(1).includes('//') || path.includes('/wedding-steeja-arjun/')) {
    problems.push(`DOUBLED  ${page}  ${original}`);
  } else if (!resolves(path)) {
    problems.push(`404      ${page}  ${original}`);
  }
}

for (const file of html) {
  const page = file.slice(ROOT.length).replace(/\\/g, '/');
  const source = readFileSync(file, 'utf8');

  for (const host of STALE_HOSTS) {
    if (source.includes(host)) problems.push(`STALE    ${page}  mentions ${host}`);
  }

  const refs = [];
  for (const match of source.matchAll(ATTR)) {
    /* srcset is comma-separated and each entry carries a width descriptor. */
    for (const entry of match[1].split(',')) refs.push(entry.trim().split(/\s+/)[0]);
  }
  for (const re of META_URL) for (const match of source.matchAll(re)) refs.push(match[1]);

  for (const url of refs) {
    if (!url || /^(data:|mailto:|tel:|#|javascript:)/.test(url)) continue;

    if (/^https?:\/\//.test(url)) {
      if (url.startsWith(SITE)) check(page, url, url.slice(SITE.length) || '/');
      else external.add(url.split('?')[0]);
    } else if (url.startsWith('/')) {
      check(page, url, url);
    } else {
      problems.push(`RELATIVE ${page}  ${url}`);
    }
  }
}

console.log(`${html.length} page(s), ${checked} internal reference(s) checked`);
console.log('\nExternal hosts referenced:');
for (const url of [...external].sort()) console.log(`  ${url}`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log('\nNo 404s, no doubled paths, no stale hosts.');
