/**
 * The single point where a hand-written path meets the deploy root.
 *
 * The site is a GitHub Pages USER site (repository `steejaarjun.github.io`),
 * served from the root of the account's hostname, so `BASE_URL` is `/` and
 * `withBase('rsvp')` is simply `/rsvp`. That was not true of the earlier GitHub
 * Pages PROJECT site, where the repository lived under `/wedding-steeja-arjun/`
 * and a bare `/rsvp` was a 404 — which is why this exists at all.
 *
 * It stays now that the prefix is empty, and deliberately. Astro rewrites the
 * paths it generates itself (bundled CSS, `astro:assets` output); everything
 * written by hand goes through here, so a future move back under a path is one
 * line in astro.config.mjs rather than a hunt through every href in the
 * project. The cost of keeping it is one function call that concatenates a
 * slash.
 *
 * Two files carry the deploy root SEPARATELY and cannot import this, because
 * neither is compiled by Astro: `public/site.webmanifest` (served verbatim, and
 * its paths resolve against its own location) and the generator that writes it,
 * `scripts/make-brand-assets.mjs`. Both are set to `/`. If a base ever comes
 * back, they are the two that will not follow on their own.
 */
const BASE = import.meta.env.BASE_URL;

/** Joins a site-relative path onto the deploy base without doubling slashes. */
export function withBase(path: string): string {
  return `${BASE.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Absolute URL for tags that cannot take a relative path (canonical, og:*). */
export function absoluteUrl(path: string, site: URL): string {
  return new URL(withBase(path), site).href;
}
