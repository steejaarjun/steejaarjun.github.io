/**
 * Text → SVG path data, straight out of a TrueType font's outlines.
 *
 * WHY THIS EXISTS
 *
 * The link-preview card and the favicon monogram both have to be set in the
 * site's own display face, and neither can be: this toolchain will not
 * rasterise text in a font that is not installed on the machine. Three routes
 * were tried and all three fell back to the default serif *silently* — the
 * giveaway was that "Instrument Serif" and "serif" rendered to identical pixel
 * extents while Georgia differed:
 *
 *   · sharp's `text` input with `fontfile`      → ignored
 *   · a FONTCONFIG_FILE pointing at a font dir  → ignored
 *   · SVG @font-face with a base64 TTF data URI → ignored (librsvg)
 *
 * A silent fallback is the worst of the three outcomes, because the build
 * still succeeds and the wrong typeface only shows up in a WhatsApp preview
 * once the invitations are out.
 *
 * So no rasteriser is asked to find a font at all. The glyph outlines are read
 * out of the font file and emitted as SVG `<path d="…">`, which needs no font
 * machinery anywhere downstream — and is sharper at small sizes than a
 * rasterised glyph would have been.
 *
 * Scope is deliberately narrow: the strings this project sets are Latin, so
 * this reads `cmap` format 4 and nothing else. It raises rather than guesses if
 * a character is missing, because a silently-dropped glyph is the same class of
 * bug as the silent font fallback above.
 */

function tables(font) {
  const found = new Map();
  const numTables = font.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const p = 12 + i * 16;
    found.set(font.toString('ascii', p, p + 4), {
      offset: font.readUInt32BE(p + 8),
      length: font.readUInt32BE(p + 12),
    });
  }
  return found;
}

/** cmap format 4: the segmented mapping every Latin font ships. */
function characterMap(font, cmapOffset) {
  const numSubtables = font.readUInt16BE(cmapOffset + 2);
  let best = 0;
  for (let i = 0; i < numSubtables; i += 1) {
    const p = cmapOffset + 4 + i * 8;
    const platform = font.readUInt16BE(p);
    const encoding = font.readUInt16BE(p + 2);
    const offset = font.readUInt32BE(p + 4);
    // Windows/Unicode BMP, or Unicode. Either is fine; prefer the first found.
    if ((platform === 3 && encoding === 1) || platform === 0) {
      best = cmapOffset + offset;
      break;
    }
  }
  if (!best) throw new Error('No Unicode cmap subtable in this font.');
  if (font.readUInt16BE(best) !== 4) throw new Error('cmap is not format 4.');

  const segCount = font.readUInt16BE(best + 6) / 2;
  const ends = best + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const ranges = deltas + segCount * 2;

  return (code) => {
    for (let s = 0; s < segCount; s += 1) {
      if (font.readUInt16BE(ends + s * 2) < code) continue;
      if (font.readUInt16BE(starts + s * 2) > code) return 0;

      const rangeOffset = font.readUInt16BE(ranges + s * 2);
      if (rangeOffset === 0) {
        return (code + font.readInt16BE(deltas + s * 2)) & 0xffff;
      }
      const glyphAddress =
        ranges + s * 2 + rangeOffset + (code - font.readUInt16BE(starts + s * 2)) * 2;
      const glyph = font.readUInt16BE(glyphAddress);
      return glyph === 0 ? 0 : (glyph + font.readInt16BE(deltas + s * 2)) & 0xffff;
    }
    return 0;
  };
}

/**
 * One glyph's contours, in font units, with an optional affine transform
 * applied (composite glyphs re-use other glyphs under a transform).
 */
function contoursOf(font, tbl, loca, glyphId, transform) {
  const start = loca[glyphId];
  const end = loca[glyphId + 1];
  if (start === end) return []; // whitespace: a valid, empty outline

  const g = tbl.get('glyf').offset + start;
  const numContours = font.readInt16BE(g);
  const apply = transform ?? ((x, y) => [x, y]);

  if (numContours < 0) {
    // -- Composite: assemble from other glyphs. Accents mostly, but also some
    //    punctuation; cheap to support and expensive to discover missing.
    const parts = [];
    let p = g + 10;
    for (;;) {
      const flags = font.readUInt16BE(p);
      const componentId = font.readUInt16BE(p + 2);
      p += 4;

      let dx;
      let dy;
      if (flags & 1) {
        dx = font.readInt16BE(p);
        dy = font.readInt16BE(p + 2);
        p += 4;
      } else {
        dx = font.readInt8(p);
        dy = font.readInt8(p + 1);
        p += 2;
      }

      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      const f2 = (at) => font.readInt16BE(at) / 16384;
      if (flags & 8) {
        a = d = f2(p);
        p += 2;
      } else if (flags & 0x40) {
        a = f2(p);
        d = f2(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        a = f2(p);
        b = f2(p + 2);
        c = f2(p + 4);
        d = f2(p + 6);
        p += 8;
      }

      parts.push(
        ...contoursOf(font, tbl, loca, componentId, (x, y) =>
          apply(a * x + c * y + dx, b * x + d * y + dy),
        ),
      );

      if (!(flags & 0x20)) break; // MORE_COMPONENTS
    }
    return parts;
  }

  // -- Simple glyph.
  const endPts = [];
  for (let i = 0; i < numContours; i += 1) endPts.push(font.readUInt16BE(g + 10 + i * 2));
  const numPoints = endPts[endPts.length - 1] + 1;

  let p = g + 10 + numContours * 2;
  p += 2 + font.readUInt16BE(p); // skip hinting instructions

  const flags = [];
  while (flags.length < numPoints) {
    const flag = font.readUInt8(p);
    p += 1;
    flags.push(flag);
    if (flag & 8) {
      let repeat = font.readUInt8(p);
      p += 1;
      while (repeat--) flags.push(flag);
    }
  }

  const readCoords = (shortBit, sameBit) => {
    const out = [];
    let value = 0;
    for (const flag of flags) {
      if (flag & shortBit) {
        const delta = font.readUInt8(p);
        p += 1;
        value += flag & sameBit ? delta : -delta;
      } else if (!(flag & sameBit)) {
        value += font.readInt16BE(p);
        p += 2;
      }
      out.push(value);
    }
    return out;
  };

  const xs = readCoords(2, 16);
  const ys = readCoords(4, 32);

  const contours = [];
  let from = 0;
  for (const endPt of endPts) {
    const points = [];
    for (let i = from; i <= endPt; i += 1) {
      const [x, y] = apply(xs[i], ys[i]);
      points.push({ x, y, on: Boolean(flags[i] & 1) });
    }
    contours.push(points);
    from = endPt + 1;
  }
  return contours;
}

/**
 * Contours → an SVG path.
 *
 * TrueType outlines are quadratic B-splines: consecutive off-curve points imply
 * an on-curve point exactly halfway between them, which is why the loop below
 * synthesises midpoints rather than assuming the two alternate.
 *
 * `scale` also flips the y axis — font units run upwards, SVG runs downwards.
 */
function toPath(contours, scale, dx, dy) {
  const X = (v) => (dx + v * scale).toFixed(2);
  const Y = (v) => (dy - v * scale).toFixed(2);
  const out = [];

  for (const points of contours) {
    if (points.length === 0) continue;

    // Start on an on-curve point; if the contour has none, start at a midpoint.
    let startIndex = points.findIndex((pt) => pt.on);
    let start;
    if (startIndex === -1) {
      startIndex = 0;
      start = {
        x: (points[0].x + points[points.length - 1].x) / 2,
        y: (points[0].y + points[points.length - 1].y) / 2,
      };
    } else {
      start = points[startIndex];
    }

    out.push(`M${X(start.x)} ${Y(start.y)}`);

    let control = null;
    for (let i = 1; i <= points.length; i += 1) {
      const pt = points[(startIndex + i) % points.length];
      if (pt.on) {
        out.push(
          control
            ? `Q${X(control.x)} ${Y(control.y)} ${X(pt.x)} ${Y(pt.y)}`
            : `L${X(pt.x)} ${Y(pt.y)}`,
        );
        control = null;
      } else if (control) {
        // Two off-curve points in a row: the on-curve point between them is implied.
        const mid = { x: (control.x + pt.x) / 2, y: (control.y + pt.y) / 2 };
        out.push(`Q${X(control.x)} ${Y(control.y)} ${X(mid.x)} ${Y(mid.y)}`);
        control = pt;
      } else {
        control = pt;
      }
    }

    if (control) out.push(`Q${X(control.x)} ${Y(control.y)} ${X(start.x)} ${Y(start.y)}`);
    out.push('Z');
  }

  return out.join('');
}

/**
 * Opens a font once and returns a text-setting function.
 *
 * `layout(text, fontSize, x, y)` returns `{ d, width }`, where `d` is SVG path
 * data with the baseline at `y` and the left edge at `x`, and `width` is the
 * advance width so callers can centre it.
 */
export function openFont(buffer) {
  const tbl = tables(buffer);
  for (const required of ['head', 'maxp', 'cmap', 'loca', 'glyf', 'hhea', 'hmtx']) {
    if (!tbl.has(required)) throw new Error(`Font is missing the '${required}' table.`);
  }

  const head = tbl.get('head').offset;
  const unitsPerEm = buffer.readUInt16BE(head + 18);
  const longLoca = buffer.readInt16BE(head + 50) === 1;
  const numGlyphs = buffer.readUInt16BE(tbl.get('maxp').offset + 4);

  const locaOffset = tbl.get('loca').offset;
  const loca = [];
  for (let i = 0; i <= numGlyphs; i += 1) {
    loca.push(
      longLoca
        ? buffer.readUInt32BE(locaOffset + i * 4)
        : buffer.readUInt16BE(locaOffset + i * 2) * 2,
    );
  }

  const lookup = characterMap(buffer, tbl.get('cmap').offset);
  const numHMetrics = buffer.readUInt16BE(tbl.get('hhea').offset + 34);
  const hmtx = tbl.get('hmtx').offset;
  const advanceOf = (glyphId) =>
    buffer.readUInt16BE(hmtx + Math.min(glyphId, numHMetrics - 1) * 4);

  return function layout(text, fontSize, x = 0, y = 0, letterSpacing = 0) {
    const scale = fontSize / unitsPerEm;
    let cursor = x;
    const parts = [];

    for (const character of text) {
      const glyphId = lookup(character.codePointAt(0));
      if (glyphId === 0 && character !== ' ') {
        throw new Error(
          `The font has no glyph for ${JSON.stringify(character)}. ` +
            'Change the wording or use a font that covers it — it would ' +
            'otherwise be dropped from the image without a word.',
        );
      }
      const contours = contoursOf(buffer, tbl, loca, glyphId, null);
      if (contours.length) parts.push(toPath(contours, scale, cursor, y));
      cursor += advanceOf(glyphId) * scale + letterSpacing;
    }

    return { d: parts.join(''), width: cursor - x - letterSpacing };
  };
}
