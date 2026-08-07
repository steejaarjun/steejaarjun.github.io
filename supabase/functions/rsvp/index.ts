/**
 * POST /functions/v1/rsvp — the only way a row reaches `public.rsvps`.
 *
 * The site is a static build on GitHub Pages, so there is no server of ours in
 * front of it and the anon key is public knowledge. A Turnstile token can only
 * be verified by something holding the Turnstile secret, and a static page
 * cannot hold a secret — so the verification, and therefore the write, happens
 * here. `anon` has no privileges on the table at all (see 0001_rsvps.sql); this
 * function writes with the service role, which bypasses RLS.
 *
 * Two actions:
 *   (default)      submit a reply
 *   check_phone    answer, with one boolean, whether a number has replied
 *
 * Everything the client sends is re-validated here against the same rules the
 * database enforces. The client's copy of those rules is a courtesy to the
 * guest, not a control.
 *
 * Deploy:  npx supabase functions deploy rsvp
 * Secrets: npx supabase secrets set TURNSTILE_SECRET_KEY=...
 *          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the
 *           platform — do not set them yourself and do not commit them.)
 */
/**
 * Through esm.sh, at one exact version, and both halves of that matter.
 *
 * This was `jsr:@supabase/supabase-js@2` and the deploy stopped resolving: the
 * floating `@2` moved on to 2.112.2, whose JSR build declares a dependency on
 * `@supabase/postgrest-js` 2.112.2 — a version that exists on JSR and was never
 * published to npm, which is where that dependency has to come from. Nothing in
 * this repository changed; the tag moved underneath it. That is the argument
 * against a floating tag: the one thing it buys is upgrades nobody asked for,
 * arriving on the day of a deploy.
 *
 * esm.sh resolves through npm, so the whole 2.111.0 set is there. The version
 * is the one in package.json, so the browser's client (src/lib/supabase.ts, on
 * /admin) and this function are the same library — worth keeping true when you
 * next bump either one.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

type ErrorCode =
  | 'captcha_failed'
  | 'validation_failed'
  | 'rate_limited'
  | 'server_error';

/**
 * Explicit, no wildcard. The deployed sites and local `astro dev`.
 *
 * THE LIVE ONE IS `https://steejaarjun.github.io` — the GitHub Pages user site.
 * The other two deployed origins are hosts this site has previously lived on
 * and which have not been torn down:
 *
 *   steeja-arjun.pages.dev      Cloudflare Pages, parked (wrangler.toml is
 *                               still in the tree but inert)
 *   chirakkalcode.github.io     the original GitHub Pages project site, still
 *                               serving its last artifact
 *
 * A browser sends the page's own origin, so removing one here breaks the form
 * on that host the moment this function is redeployed. Drop each when its
 * deployment is actually retired — not before.
 *
 * Exact strings, so no subdomain of any of them is admitted. Cloudflare's
 * preview deployments land on `https://<hash>.steeja-arjun.pages.dev` and
 * `https://<branch>.steeja-arjun.pages.dev` and are NOT allowed, which is
 * deliberate rather than an oversight: a preview build of a branch is exactly
 * the thing that should not be able to write a real reply into the real guest
 * list. If a preview ever needs testing end to end, add that one hostname for
 * the test and take it out again.
 *
 * REDEPLOY AFTER EDITING. This file is not part of the site build: changing it
 * and pushing does nothing until `npx supabase functions deploy rsvp` runs. A
 * form that returns "Something went wrong on our side" on the new domain, with
 * a CORS error in the console, is this list not having been redeployed.
 */
const ALLOWED_ORIGINS = new Set([
  'https://steejaarjun.github.io',
  'https://steeja-arjun.pages.dev',
  'https://chirakkalcode.github.io',
  'http://localhost:4321',
]);

const MAX_COMPANIONS = 20;

/** Per phone number, as before — only applies to replies that carry one. */
const PHONE_WINDOW_MINUTES = 10;
const PHONE_MAX = 3;

/**
 * Per caller, because the phone is now optional and every reply without one
 * would otherwise share a single (null) key and be unlimited.
 */
const SUBMIT_WINDOW_MINUTES = 10;
const SUBMIT_MAX = 5;

/**
 * The duplicate check is deliberately throttled far harder than the form. It
 * answers "is this number on the guest list", which is exactly the question an
 * attacker with a list of numbers would want answered in bulk.
 */
const CHECK_WINDOW_MINUTES = 1;
const CHECK_MAX = 10;

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

function fail(code: ErrorCode, status: number, origin: string | null): Response {
  return json({ ok: false, error: code }, status, origin);
}

/**
 * Strip C0/C1 control characters and collapse whitespace. Guests paste from
 * Word and WhatsApp; a stray U+0000 or a right-to-left override has no business
 * in a name.
 */
function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * To E.164, or null.
 *
 * The phone is optional now, so an empty value is a legitimate answer and
 * returns null. A NON-empty value that does not conform is still a rejection —
 * "they left it blank" and "they typed something wrong" must not collapse into
 * the same outcome, or a typo is silently stored as no number at all.
 *
 * Accepts the shapes people actually type — spaces, dashes, brackets, a leading
 * 00. A local number with no country code is rejected rather than guessed at:
 * this guest list spans India and Switzerland and a wrong guess is worse than a
 * prompt.
 */
function toE164(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  const cleaned = clean(raw);
  if (cleaned.length === 0) return { ok: true, value: null };

  const s = cleaned.replace(/[\s()\-.]/g, '');
  const withPlus = s.startsWith('00') ? `+${s.slice(2)}` : s;
  return /^\+[1-9][0-9]{7,14}$/.test(withPlus)
    ? { ok: true, value: withPlus }
    : { ok: false };
}

type Companion = { name: string; type: 'adult' | 'child' };

function parseCompanions(raw: unknown): Companion[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_COMPANIONS) return null;

  const out: Companion[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const name = clean((entry as Record<string, unknown>).name);
    const type = (entry as Record<string, unknown>).type;
    if (name.length < 1 || name.length > 80) return null;
    if (type !== 'adult' && type !== 'child') return null;
    out.push({ name, type });
  }
  return out;
}

/* -------------------------------------------------------------------------
   Caller identity, for rate limiting only
   ------------------------------------------------------------------------- */

function callerIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('X-Forwarded-For')?.split(',')[0].trim() ??
    'unknown'
  );
}

/**
 * sha256(ip || pepper), hex — never the address itself. See 0005_rate_hits.sql.
 *
 * The pepper is derived from the service-role key rather than configured
 * separately, with a domain-separation prefix so it cannot collide with any
 * other use of that key. That key is injected by the platform and never leaves
 * the server, so this needs no new secret and cannot be forgotten at deploy
 * time — a missing pepper would otherwise mean an unpeppered hash, and an
 * unpeppered hash of an IPv4 address is reversible by enumeration in seconds.
 *
 * Set RATE_LIMIT_PEPPER to override; rotating either value simply invalidates
 * the existing counters, which expire in minutes anyway.
 */
async function hashCaller(ip: string): Promise<string> {
  const pepper =
    Deno.env.get('RATE_LIMIT_PEPPER') ??
    `rsvp-rate-limit:${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`;
  const bytes = new TextEncoder().encode(`${ip}|${pepper}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Records this call and reports whether the caller is now over the limit.
 *
 * Counts first, then inserts, so the Nth call is allowed and the (N+1)th is
 * not. Old rows are deleted on every write — the table is a counter with a
 * short memory, not a log of who visited.
 *
 * Fails OPEN on a database error. A guest who cannot reply because the rate
 * limiter is broken is a worse outcome than a bot getting one extra attempt,
 * and Turnstile is still in front of every path that calls this.
 */
async function overLimit(
  // deno-lint-ignore no-explicit-any
  db: any,
  keyHash: string,
  kind: 'submit' | 'check',
  windowMinutes: number,
  max: number,
): Promise<boolean> {
  try {
    /* Through an RPC, not `.schema('private').from(...)`. supabase-js talks to
       PostgREST, and PostgREST only routes to its configured schemas — it does
       not serve `private`, so a direct table call fails no matter what the
       service role is allowed to do. That version failed *silently*: the error
       was caught below, the limiter failed open, and every caller was
       unlimited while appearing to be limited. See 0006_rate_hit_rpc.sql. */
    const { data, error } = await db.rpc('rate_hit', {
      p_key_hash: keyHash,
      p_kind: kind,
      p_window_seconds: windowMinutes * 60,
      p_max: max,
    });
    if (error) throw error;
    return data === true;
  } catch (err) {
    console.error('rsvp: rate check failed, allowing', String(err));
    return false;
  }
}

/** Verifies a Turnstile token. Single-use: Cloudflare will not accept it twice. */
async function turnstileOk(token: string, ip: string): Promise<boolean | 'error'> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) {
    console.error('rsvp: TURNSTILE_SECRET_KEY is not set');
    return 'error';
  }
  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (ip && ip !== 'unknown') form.append('remoteip', ip);

    const verify = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form },
    );
    const result = (await verify.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (!result.success) {
      console.warn('rsvp: turnstile rejected', result['error-codes'] ?? []);
      return false;
    }
    return true;
  } catch (err) {
    console.error('rsvp: turnstile request failed', String(err));
    return 'error';
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'validation_failed' }, 405, origin);
  }
  if (!req.headers.get('Content-Type')?.includes('application/json')) {
    return fail('validation_failed', 415, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail('validation_failed', 400, origin);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return fail('validation_failed', 400, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('rsvp: supabase env missing');
    return fail('server_error', 500, origin);
  }
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ip = callerIp(req);
  const callerHash = await hashCaller(ip);
  const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : '';

  /* -----------------------------------------------------------------------
     Action: check_phone
     -----------------------------------------------------------------------
     Returns one boolean and nothing else — no name, no count, no id. The
     caller learns only what they could already learn by submitting a reply and
     seeing whether it was rate-limited, and they pay a Turnstile solve for it.
  ----------------------------------------------------------------------- */
  if (body.action === 'check_phone') {
    if (await overLimit(db, callerHash, 'check', CHECK_WINDOW_MINUTES, CHECK_MAX)) {
      console.warn('rsvp: check_phone rate_limited');
      return fail('rate_limited', 429, origin);
    }

    if (!token) return fail('captcha_failed', 403, origin);
    const captcha = await turnstileOk(token, ip);
    if (captcha === 'error') return fail('server_error', 502, origin);
    if (!captcha) return fail('captcha_failed', 403, origin);

    const phone = toE164(body.phone);
    // A malformed or absent number is not an error here — there is simply
    // nothing to warn about.
    if (!phone.ok || phone.value === null) {
      return json({ ok: true, exists: false }, 200, origin);
    }

    try {
      const { count, error } = await db
        .from('rsvps')
        .select('id', { count: 'exact', head: true })
        .eq('phone_normalised', phone.value.replace(/[^0-9]/g, ''));
      if (error) throw error;
      return json({ ok: true, exists: (count ?? 0) > 0 }, 200, origin);
    } catch (err) {
      console.error('rsvp: check_phone failed', String(err));
      return fail('server_error', 500, origin);
    }
  }

  /* -----------------------------------------------------------------------
     Action: submit
  ----------------------------------------------------------------------- */

  /* 1. Honeypot — flagged, never discarded.
   *
   * This used to return a fake success and write nothing, and it ate a real
   * reply: the field was called `website` with a visible "Website" label, which
   * browsers autofill from a saved profile regardless of autocomplete="off".
   * The guest saw "Thank you" and the couple never learned they had replied.
   *
   * Silently dropping a submission is only correct if the detector is perfect,
   * and this one demonstrably is not. So a hit now sets a flag that the row
   * carries into the admin area for review; the response is byte-identical to
   * an ordinary success, so a bot still learns nothing.
   *
   * `hp_ref` is the current name. `website` and `company` stay recognised
   * because an old page may still be open in somebody's tab.
   */
  const honeypot = clean(body.hp_ref ?? body.company ?? body.website ?? '');
  const flaggedSpam = honeypot.length > 0;
  if (flaggedSpam) {
    /* Logged deliberately, and with the length only — never the value, which
       is whatever the browser autofilled and may be somebody's home address.
       If real guests are being caught, this is where it shows up. */
    console.warn(`rsvp: honeypot matched, flagging (len=${honeypot.length})`);
  }

  // 2. Per-caller limit, before Turnstile: it is the cheaper of the two checks
  //    and the only one that survives the phone being optional.
  if (await overLimit(db, callerHash, 'submit', SUBMIT_WINDOW_MINUTES, SUBMIT_MAX)) {
    console.warn('rsvp: submit rate_limited (caller)');
    return fail('rate_limited', 429, origin);
  }

  // 3. Turnstile, before any validation work — it is the cheapest way to stop
  //    the rest of this function being a free validation oracle.
  if (!token) return fail('captcha_failed', 403, origin);
  const captcha = await turnstileOk(token, ip);
  if (captcha === 'error') return fail('server_error', 502, origin);
  if (!captcha) return fail('captcha_failed', 403, origin);

  // 4. Validate everything, mirroring the database constraints.
  const first_name = clean(body.first_name);
  const last_name = clean(body.last_name);
  const phone = toE164(body.phone);
  const message = clean(body.message);
  const companions = parseCompanions(body.companions);

  const attending_mass = body.attending_mass;
  const attending_reception = body.attending_reception;

  const invalid =
    first_name.length < 1 || first_name.length > 80 ||
    last_name.length < 1 || last_name.length > 80 ||
    !phone.ok ||
    typeof attending_mass !== 'boolean' ||
    typeof attending_reception !== 'boolean' ||
    companions === null ||
    message.length > 1000;

  if (invalid) {
    // No field values, and no field names either — a name plus a length is
    // still a fragment of somebody's personal data in a log.
    console.warn('rsvp: validation_failed');
    return fail('validation_failed', 400, origin);
  }

  // 5. A decline needs no guest list.
  if (!attending_mass && !attending_reception && companions!.length > 0) {
    console.warn('rsvp: validation_failed (declined with companions)');
    return fail('validation_failed', 400, origin);
  }

  // 6. Per-phone limit, kept for replies that carry a number: a family replying
  //    from one house shares an address, and blocking them on the IP limit
  //    alone would be worse than letting a determined bot through a captcha it
  //    already had to solve. Skipped entirely when there is no number.
  const phoneValue = (phone as { value: string | null }).value;
  if (phoneValue) {
    try {
      const since = new Date(Date.now() - PHONE_WINDOW_MINUTES * 60_000).toISOString();
      const { count, error } = await db
        .from('rsvps')
        .select('id', { count: 'exact', head: true })
        .eq('phone_normalised', phoneValue.replace(/[^0-9]/g, ''))
        .gte('created_at', since);
      if (error) throw error;
      if ((count ?? 0) >= PHONE_MAX) {
        console.warn('rsvp: rate_limited (phone)');
        return fail('rate_limited', 429, origin);
      }
    } catch (err) {
      console.error('rsvp: phone rate check failed', String(err));
      return fail('server_error', 500, origin);
    }
  }

  // 7. Insert. `select('id')` returns only the id — the stored row is never
  //    echoed back, so a caller cannot use this endpoint to read anything.
  //
  //    `email` is deliberately absent. The field was removed from the form in
  //    13b; the COLUMN is deliberately kept, nullable and unused, because
  //    dropping it would need a migration and destroy the addresses already
  //    collected for no benefit. Nothing writes it any more.
  try {
    const { data, error } = await db
      .from('rsvps')
      .insert({
        first_name,
        last_name,
        phone: phoneValue,
        attending_mass,
        attending_reception,
        companions,
        message: message.length ? message : null,
        source: 'web',
        flagged_spam: flaggedSpam,
      })
      .select('id')
      .single();

    if (error) throw error;
    return json({ ok: true, id: data.id }, 201, origin);
  } catch (err) {
    console.error('rsvp: insert failed', String(err));
    return fail('server_error', 500, origin);
  }
});
