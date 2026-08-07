// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

/**
 * Refuses to build a site whose reply form cannot send.
 *
 * The three PUBLIC_* values are compiled into the client bundle. When one is
 * missing, Astro substitutes `undefined` and the build SUCCEEDS: the RSVP form
 * ships pointing at `undefined/functions/v1/rsvp` with `undefined` for the
 * Turnstile site key, looks perfect, and cannot send a single reply. That has
 * happened once already on GitHub Pages, where the three are repository
 * variables that a fork or a renamed variable silently drops.
 *
 * The move to a new repository is exactly when it happens: repository variables
 * do NOT travel with the code. Pushing this repository to
 * steejaarjun/steejaarjun.github.io copies every file and none of the three
 * variables, so the first Actions run on the new repository starts with all
 * three unset. Nothing in this repository can prove they were set — this is
 * what replaces that proof, and it is why the first deploy there fails loudly
 * instead of shipping a dead form.
 *
 * Build only. `astro dev` stays usable without a .env, which is how somebody
 * new to the project reads the layout without being handed keys first.
 *
 * @returns {import('astro').AstroIntegration}
 */
function requirePublicEnv() {
  const REQUIRED = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'PUBLIC_TURNSTILE_SITE_KEY',
  ];

  return {
    name: 'require-public-env',
    hooks: {
      'astro:config:setup': ({ command }) => {
        if (command !== 'build') return;

        /* `loadEnv` rather than `process.env` alone: a local build reads its
           values from .env, which Vite has not loaded yet at config time. With
           an empty prefix it returns the .env files AND the real environment,
           which is where a Pages or Actions build gets them. */
        const env = loadEnv('production', process.cwd(), '');
        const missing = REQUIRED.filter((key) => !env[key] && !process.env[key]);
        if (missing.length === 0) return;

        throw new Error(
          `Refusing to build: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.\n\n` +
            'These are compiled into the client bundle. Without them the build\n' +
            'would succeed and the RSVP form would ship `undefined` for the\n' +
            'function URL and the Turnstile key — a form that looks right and\n' +
            'cannot send.\n\n' +
            '  Locally         copy .env.example to .env and fill it in\n' +
            '  GitHub Actions  github.com/steejaarjun/steejaarjun.github.io >\n' +
            '                    Settings > Secrets and variables > Actions >\n' +
            '                    Variables tab > New repository variable\n' +
            '  Cloudflare Pages  (parked) Workers & Pages > steeja-arjun >\n' +
            '                    Settings > Environment variables, for BOTH\n' +
            '                    Production and Preview\n',
        );
      },
    },
  };
}

// Deployed to GitHub Pages as a USER site — the repository is named
// `steejaarjun.github.io`, and GitHub serves a repository of that name at the
// ROOT of the account's hostname rather than under a path.
//
// THERE IS NO `base` KEY BELOW AND THERE MUST NOT BE ONE. This has now been the
// wrong thing twice, in opposite directions, so it is worth being exact about
// which kind of GitHub Pages site this is:
//
//   PROJECT site   github.com/<user>/<repo>      -> <user>.github.io/<repo>/
//                  needs base: '/<repo>'
//   USER site      github.com/<user>/<user>.github.io -> <user>.github.io/
//                  needs NO base
//
// This is the second. The first arrangement is what `/wedding-steeja-arjun` was
// for, and a leftover base of that shape here produces
// `/wedding-steeja-arjun/_astro/...` against a host that serves `/_astro/...`,
// which 404s every asset while the HTML still renders — so it fails looking
// like a styling bug rather than a routing one. That is the failure this
// comment exists to prevent.
//
// `src/lib/paths.ts` (withBase) still stands between hand-written paths and the
// deploy root, and it resolves to `/`. It is kept rather than deleted so that
// moving under a path again is one line here instead of an audit of every href
// in the project.
//
// Cloudflare Pages is PARKED, not deleted. wrangler.toml stays in the
// repository and is inert: a Pages project only builds when Cloudflare's git
// integration is connected to a repository, and this one is not connected to
// the new repository. Nothing in that file reacts to a push here.
export default defineConfig({
  site: 'https://steejaarjun.github.io',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    // One page, small CSS: inlining it removes the only render-blocking
    // request, which is what keeps the hero paint on the critical path short.
    inlineStylesheets: 'always',
  },
  integrations: [
    requirePublicEnv(),
    sitemap({
      // The guest list is not for crawlers. It carries `noindex, nofollow` on
      // the page and a Disallow in robots.txt as well — this is the third of
      // the three, and the only one that stops the URL being *advertised* in
      // the first place. `filter` receives absolute URLs.
      filter: (page) => !page.includes('/admin'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
