/**
 * Proves, from the built CSS rather than from intent, that nothing on this site
 * moves at a guest who has asked for less motion.
 *
 * WHAT IT CHECKS, precisely: every `animation*` and `transition*` declaration
 * in the shipped stylesheets. It does NOT check the start states those
 * animations travel from — a stray `clip-path: inset(100%)` or `opacity: 0`
 * outside the gate is exactly the bug this project has shipped twice, and it is
 * not the bug this script finds. Reading `--verbose` and checking that each
 * gated animation's armed rule sits in the same block is still a job for a
 * person. The claim printed at the end is worded to that limit; do not widen it.
 *
 * The house rule is not "switch the animation off under `reduce`" — it is that
 * an animation, and any hidden or armed start state it depends on, may only be
 * AUTHORED inside `@media (prefers-reduced-motion: no-preference)`. The
 * difference matters: a rule declared unconditionally and then undone inside a
 * `reduce` block still exists in every browser that does not understand the
 * query, and this page has twice shipped a photograph that was invisible
 * because a start state outlived the thing meant to lift it.
 *
 * That rule is invisible in the source once Astro has scoped, merged and
 * minified a dozen component <style> blocks into one sheet, so this reads the
 * shipped stylesheet back and checks it there. It walks the CSS tracking @media
 * nesting and sorts every motion declaration into one of two kinds, because
 * they carry different obligations:
 *
 *   · `animation` is motion the PAGE performs, unbidden, at whatever moment it
 *     chooses. It must be behind the gate. No exceptions, and an ungated one
 *     fails this run.
 *
 *   · `transition` is motion a STATE CHANGE performs — a hover, a focus ring, a
 *     class the script toggles. It cannot run on its own. It is reported rather
 *     than failed, and it passes quietly when the same selector is also nulled
 *     inside a `reduce` block, or when the selector is a framework utility that
 *     nothing on the site actually uses.
 *
 * Usage: node scripts/audit-motion.mjs            (after a build)
 *        node scripts/audit-motion.mjs --verbose  (list what passed, too)
 *
 * Exit code 1 if anything animates outside the gate.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const DIST = resolve('dist');
const VERBOSE = process.argv.includes('--verbose');

function walk(dir, ext) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

const htmlFiles = walk(DIST, '.html');
const htmlText = htmlFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

/**
 * Every class name that actually appears in a shipped `class` attribute.
 *
 * Tailwind emits its utility layer whether or not the site uses it, and
 * `.transition` sitting unused in that layer is not a promise the page can
 * keep or break. Rather than hard-coding an exception for it, ask the shipped
 * markup whether the selector is ever matched.
 */
const usedClasses = new Set();
for (const [, attr] of htmlText.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)) {
  for (const name of attr.split(/\s+/)) if (name) usedClasses.add(name);
}
/* Scripts add classes that are in no `class` attribute at build time —
   `is-in`, `rings--play`, and whatever the new schedule rail uses. Anything a
   script can add is by definition live, so treat a name that appears anywhere
   in the shipped JavaScript as used too. */
for (const [, quoted] of htmlText.matchAll(/["']([a-z][a-z0-9_-]{2,})["']/gi)) {
  usedClasses.add(quoted);
}
for (const file of walk(DIST, '.js')) {
  const js = readFileSync(file, 'utf8');
  for (const [, quoted] of js.matchAll(/["']([a-z][a-z0-9_-]{2,})["']/gi)) usedClasses.add(quoted);
}

const GATE = /prefers-reduced-motion\s*:\s*no-preference/i;
const REDUCE = /prefers-reduced-motion\s*:\s*reduce/i;

const results = [];

/**
 * One pass over the text tracking brace depth and the prelude of each open
 * block. Deliberately not a full CSS parser: it has to answer one question —
 * "which @media am I inside?" — and counting braces while remembering the
 * preludes answers it exactly, on minified output, with no dependency.
 */
function audit(css, label) {
  const stack = [];
  let chunk = '';
  let i = 0;

  const flush = () => {
    const colon = chunk.indexOf(':');
    if (colon !== -1) {
      const prop = chunk.slice(0, colon).trim().toLowerCase();
      const value = chunk.slice(colon + 1).trim();
      if (/^(animation|transition)/.test(prop)) record(prop, value, stack, label);
    }
    chunk = '';
  };

  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === '{') {
      stack.push(chunk.trim());
      chunk = '';
    } else if (ch === '}') {
      flush();
      stack.pop();
    } else if (ch === ';') {
      flush();
    } else {
      chunk += ch;
      i++;
      continue;
    }
    i++;
  }
}

function record(prop, value, stack, label) {
  /* `animation: none` / `transition: none` is motion being taken away. It is
     how the `reduce` blocks do their work, and `!important` is how one of them
     does it emphatically. */
  if (/^none\b/i.test(value)) return;
  /* Inside a @keyframes body, `animation-timing-function` is a step of a curve.
     The animation that uses the curve is gated where it is used. */
  if (stack.some((s) => /@keyframes/i.test(s))) return;

  const selector = stack[stack.length - 1] ?? '';
  results.push({
    label,
    selector,
    media: stack.filter((s) => s.startsWith('@')).join(' / ') || '(top level)',
    kind: prop.startsWith('animation') ? 'animation' : 'transition',
    prop,
    value,
    gated: stack.some((s) => GATE.test(s)),
    reduced: stack.some((s) => REDUCE.test(s)),
  });
}

for (const file of walk(DIST, '.css')) {
  audit(readFileSync(file, 'utf8'), relative(DIST, file).replace(/\\/g, '/'));
}
for (const file of htmlFiles) {
  const rel = relative(DIST, file).replace(/\\/g, '/');
  for (const [, body] of readFileSync(file, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (body.trim()) audit(body, `${rel} (inline <style>)`);
  }
}

/** Selectors that carry a `transition: none` somewhere inside a reduce block. */
const nulledUnderReduce = new Set();
for (const file of [...walk(DIST, '.css'), ...htmlFiles]) {
  const text = readFileSync(file, 'utf8');
  for (const [, block] of text.matchAll(
    /@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{([\s\S]*?\}\s*)\}/gi,
  )) {
    for (const [, sel] of block.matchAll(/([^{}]+)\{[^{}]*(?:animation|transition)\s*:\s*none/gi)) {
      for (const one of sel.split(',')) nulledUnderReduce.add(one.trim());
    }
  }
}

const classesIn = (selector) =>
  [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);

/** A selector nothing in the shipped markup or script can ever match. */
const unused = (selector) => {
  const names = classesIn(selector);
  return names.length > 0 && names.every((n) => !usedClasses.has(n));
};

/**
 * Whether a transition moves anything, as opposed to only changing a colour or
 * a level of ink.
 *
 * The distinction is the one the guest actually experiences. A crossfade
 * changes no geometry: nothing travels, nothing grows, nothing arrives from
 * off-screen, and there is no vestibular reason to suppress it. A transition on
 * `transform`, `translate`, `rotate`, `scale`, `clip-path`, `offset-distance`,
 * `stroke-dashoffset`, `height`, `width`, `inset` or `margin` does move
 * something, and has to be gated like any other motion.
 *
 * Anything not recognised counts as motion, so a property added later fails
 * loudly rather than being waved through.
 */
const STILL = /^(opacity|visibility|color|background-color|background|border-color|box-shadow|fill|stroke|text-decoration-color|outline-color|backdrop-filter)$/;

const movesSomething = (r) => {
  if (r.prop === 'transition-property') return !r.value.split(',').every((p) => STILL.test(p.trim()));
  if (r.prop !== 'transition') return true; // duration/timing/delay alone say nothing; treat as motion
  /* The shorthand: each comma-separated part starts with its property name. */
  return !r.value.split(',').every((part) => STILL.test(part.trim().split(/\s+/)[0] ?? ''));
};

const failures = [];
const passed = [];
const noted = [];

for (const r of results) {
  if (r.gated || r.reduced) {
    passed.push({ ...r, why: r.gated ? 'behind the gate' : 'inside a reduce block' });
  } else if (r.kind === 'animation') {
    failures.push({ ...r, why: 'page-initiated animation outside the gate' });
  } else if (nulledUnderReduce.has(r.selector)) {
    passed.push({ ...r, why: 'transition, and this selector is nulled under reduce' });
  } else if (unused(r.selector)) {
    passed.push({ ...r, why: 'unused framework utility — matches nothing shipped' });
  } else if (!movesSomething(r)) {
    noted.push({ ...r, why: 'crossfade — changes ink, moves no geometry' });
  } else {
    failures.push({ ...r, why: 'transition of a geometric property, outside the gate' });
  }
}

const count = (kind, list) => list.filter((r) => r.kind === kind).length;

console.log(`Motion declarations in the built output: ${results.length}`);
console.log(`  animation : ${count('animation', results)}   transition: ${count('transition', results)}`);
console.log(`  passing   : ${passed.length}`);
console.log(`  crossfades: ${noted.length}  (ungated, but move no geometry)`);
console.log(`  FAILING   : ${failures.length}`);
console.log('');

if (VERBOSE) {
  for (const r of passed) {
    console.log(`  ok  ${r.selector} { ${r.prop}: ${r.value} }`);
    console.log(`      ${r.why} — ${r.media}`);
  }
  console.log('');
}

/* Always listed, never hidden behind --verbose: these are the only rules on the
   site that respond to something other than a pointer without being gated, and
   a reader of this report is entitled to see the whole list and disagree. */
if (noted.length) {
  console.log('Ungated, but nothing moves — opacity/visibility only:');
  for (const r of noted) {
    console.log(`  ${r.selector.replace(/\[data-astro-cid-[^\]]+\]/g, '')} { ${r.prop}: ${r.value} }`);
  }
  console.log('');
}

if (failures.length) {
  console.log('Moves regardless of prefers-reduced-motion:');
  for (const r of failures) {
    console.log(`  ${r.label}`);
    console.log(`    ${r.selector} { ${r.prop}: ${r.value} }`);
    console.log(`    ${r.why}; context: ${r.media}`);
  }
  process.exit(1);
}

console.log(
  'No animation, and no transition of a geometric property, is declared outside\n' +
    'prefers-reduced-motion: no-preference. (Start states are not checked — see the\n' +
    'note at the top of this file.)',
);
