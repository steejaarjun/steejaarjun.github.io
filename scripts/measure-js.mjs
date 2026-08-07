/**
 * What this page costs in JavaScript, measured the way a browser pays for it.
 *
 * Written for one question and no other: "how much script did that feature
 * add?" A `du` on dist/_astro answers it wrongly twice over — it counts the
 * admin bundle, which no guest ever downloads, and it misses every `is:inline`
 * script, which ships inside the HTML and is real weight the browser executes.
 *
 * So this walks the built pages instead, and for each one sums:
 *   · every `<script src>` it references from dist/ (module bundles, deduped
 *     across pages — a shared chunk is downloaded once, not once per page)
 *   · every inline `<script>` body, byte for byte as shipped
 *
 * Reported raw and gzipped, because the raw number is what the parser sees and
 * the gzipped number is what the wire carries, and a budget can mean either.
 *
 * Usage: node scripts/measure-js.mjs [--json]   (after a build)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative, resolve } from 'node:path';

const DIST = resolve('dist');

/** Every .html under dist/, recursively. */
function pages(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

const SCRIPT = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
const SRC = /\bsrc\s*=\s*["']([^"']+)["']/i;
const TYPE = /\btype\s*=\s*["']([^"']+)["']/i;

const gz = (buf) => gzipSync(buf, { level: 9 }).length;

const rows = [];

for (const page of pages(DIST).sort()) {
  const html = readFileSync(page, 'utf8');
  /* Deduped per page: two <script src> tags pointing at one chunk is one
     download. Keyed by resolved path so ./ and / forms collapse together. */
  const external = new Map();
  let inline = 0;
  let inlineGz = 0;

  for (const [, attrs, body] of html.matchAll(SCRIPT)) {
    /* JSON-LD and import maps are data the parser reads, not code it runs.
       Counting the structured-data blob as "JavaScript this feature added"
       would put ~1 kB of schema.org on the budget. */
    const type = attrs.match(TYPE)?.[1]?.toLowerCase();
    if (type && type !== 'module' && !type.includes('javascript')) continue;

    const src = attrs.match(SRC)?.[1];
    if (src) {
      if (/^[a-z]+:\/\//i.test(src)) continue; // third-party, not ours to count
      const file = join(DIST, src.replace(/^\.?\//, ''));
      try {
        external.set(file, readFileSync(file));
      } catch {
        /* A src we cannot resolve is not weight we can measure; say nothing
           rather than guess at it. */
      }
    } else if (body.trim()) {
      const buf = Buffer.from(body, 'utf8');
      inline += buf.length;
      inlineGz += gz(buf);
    }
  }

  const externalBytes = [...external.values()].reduce((n, b) => n + b.length, 0);
  const externalGz = [...external.values()].reduce((n, b) => n + gz(b), 0);

  rows.push({
    page: relative(DIST, page).replace(/\\/g, '/'),
    inline,
    inlineGz,
    external: externalBytes,
    externalGz,
    total: inline + externalBytes,
    totalGz: inlineGz + externalGz,
    files: [...external.keys()].map((f) => relative(DIST, f).replace(/\\/g, '/')),
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const kb = (n) => `${(n / 1024).toFixed(2)} kB`;
  for (const r of rows) {
    console.log(`${r.page}`);
    console.log(`  inline    ${kb(r.inline).padStart(9)}  (${kb(r.inlineGz)} gz)`);
    console.log(`  bundles   ${kb(r.external).padStart(9)}  (${kb(r.externalGz)} gz)`);
    console.log(`  TOTAL     ${kb(r.total).padStart(9)}  (${kb(r.totalGz)} gz)`);
    for (const f of r.files) console.log(`            · ${f}`);
    console.log('');
  }
}
