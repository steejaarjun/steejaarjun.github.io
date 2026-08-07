/**
 * The admin area. Client-rendered, because GitHub Pages cannot check a session
 * server-side — there is no server of ours to check one.
 *
 * ---------------------------------------------------------------------------
 * What actually protects this
 * ---------------------------------------------------------------------------
 * Not this file. Every read and write below goes out as the signed-in user and
 * is judged by RLS, and the policies require membership of `private.admins`
 * (see 0002/0003). Being authenticated is explicitly not enough: the anon key
 * is public and sign-up has minted `authenticated` JWTs for strangers before,
 * which is the whole reason the allowlist exists.
 *
 * So the UI here is a convenience over a database that would refuse the same
 * requests made with curl. Nothing is hidden as a security measure — hiding a
 * button is not a control — and the service-role key appears nowhere in this
 * bundle. If a query returns nothing, that is the database's answer.
 *
 * ---------------------------------------------------------------------------
 * One thing this cannot tell you
 * ---------------------------------------------------------------------------
 * A signed-in user who is NOT on the allowlist gets an empty result set, not an
 * error — RLS filters rows, it does not complain. That is indistinguishable
 * over the wire from a guest list with no replies in it yet, and both are
 * states this page will genuinely be in (the second for weeks before the
 * invitations go out).
 *
 * Distinguishing them would need a server-side check, and the only one
 * available was deliberately moved out of the API surface by 0003. So rather
 * than guess, the empty state says both things: no entries, and here is the
 * other reason you might be seeing this. See `renderEmpty`.
 */
import { supabase, type Rsvp } from '../supabase';
import { withBase } from '../paths';
import { computeStats, duplicatePhones } from './stats';
import { downloadCsv } from './csv';
import { clear, el, toast } from './dom';

type Filter = 'all' | 'coming' | 'not-coming' | 'has-message' | 'flagged';
type Sort = 'received' | 'party';
type Companion = { name: string; type: 'adult' | 'child' };

const state = {
  rows: [] as Rsvp[],
  query: '',
  filter: 'all' as Filter,
  sort: 'received' as Sort,
  expanded: new Set<string>(),
  /**
   * Companion rows added in an open editor but not yet given a name, keyed by
   * reply id.
   *
   * They cannot be written yet and should not be: `rsvps_companions_shape`
   * refuses a blank name, and it is right to. A nameless head in `party_size`
   * is a seat at the reception nobody can be sat in, and the couple order food
   * against that number.
   *
   * So "Add another person" draws the row and stops there. It becomes part of
   * the reply on the same blur that names it — one write, once there is
   * something true to write. Dropped when the editor closes, because an unnamed
   * row is not a change anybody made.
   */
  drafts: new Map<string, Companion[]>(),
  /* Ticked rows, for the bulk delete. Keyed on id rather than index so it
     survives a re-sort, a filter change and a row disappearing underneath it. */
  selected: new Set<string>(),
  loading: true,
  loadFailed: false,
  /**
   * Whether this session is on the allowlist. `null` until asked.
   *
   * Needed because RLS *filters* rather than raises: a signed-in account that
   * is not on the list gets an empty result set, which is byte for byte what a
   * guest list with no replies yet looks like. Without this the couple would
   * read "No entries yet" and reasonably conclude the replies had been lost.
   * See supabase/migrations/0004_is_admin_probe.sql.
   */
  isAdmin: null as boolean | null,
  /* Shown back to the reader in the not-allowlisted screen, so they can tell at
     a glance whether they are signed in as the account they meant to be. */
  userId: undefined as string | undefined,
  email: undefined as string | undefined,
};

let root: HTMLElement;

/* -------------------------------------------------------------------------
   Session
   ------------------------------------------------------------------------- */

/**
 * A dead or expired session must land on the login form, never on a blank page
 * or a console error. PostgREST reports it as 401/PGRST301 rather than as a
 * network failure, so it arrives looking like an ordinary query result.
 */
function isAuthFailure(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const message = (error.message ?? '').toLowerCase();
  return (
    code === 'PGRST301' ||
    code === '401' ||
    message.includes('jwt') ||
    message.includes('token is expired') ||
    message.includes('not authenticated')
  );
}

async function handleExpiredSession(): Promise<void> {
  /* Clear the stored session too, or the next load reads a token the server
     has already rejected and shows a dashboard that cannot fetch anything. */
  await supabase.auth.signOut().catch(() => {});
  renderLogin('Your session has expired. Please sign in again.');
}

/* -------------------------------------------------------------------------
   Login
   ------------------------------------------------------------------------- */

/**
 * The way back to the wedding page, and the only link on this page that leaves
 * it.
 *
 * One factory rather than three copies, because it appears in three places —
 * the server-rendered boot form in admin.astro, the login form below, and the
 * dashboard header — and the first of those is in a different file. Two of the
 * three are here, so at least those cannot drift.
 *
 * `withBase` rather than a bare '/': the deploy root is configuration, and this
 * page has been served from a sub-path before.
 */
function backLink(): HTMLAnchorElement {
  return el('a', { class: 'admin__back', href: withBase('') }, 'Back to the wedding page');
}

function renderLogin(notice?: string): void {
  clear(root);

  const error = el('p', { class: 'admin__error', role: 'alert' }, notice ?? '');
  const email = el('input', {
    class: 'admin__input', id: 'admin-email', type: 'email',
    autocomplete: 'username', required: true, inputmode: 'email',
  });
  const password = el('input', {
    class: 'admin__input', id: 'admin-password', type: 'password',
    autocomplete: 'current-password', required: true,
  });
  const submit = el('button', { class: 'admin__button', type: 'submit' }, 'Sign in');

  const form = el('form', {
    class: 'admin__login',
    novalidate: true,
    onsubmit: async (event: Event) => {
      event.preventDefault();
      if (submit.disabled) return;

      submit.disabled = true;
      submit.textContent = 'Signing in…';
      error.textContent = '';

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.value.trim(),
        password: password.value,
      });

      if (authError) {
        /* One message for every failure. Distinguishing "no such address" from
           "wrong password" turns the login form into an oracle for which
           addresses have accounts — and there is exactly one account here, so
           confirming its address costs everything and gains nothing. */
        error.textContent = 'That email address and password did not match.';
        submit.disabled = false;
        submit.textContent = 'Sign in';
        password.value = '';
        password.focus();
        return;
      }

      /* No redirect: the dashboard is this same page. onAuthStateChange picks
         the session up and swaps the view. */
    },
  },
    el('h1', { class: 'admin__title' }, 'Guest list'),
    el('p', { class: 'admin__lead' }, 'Sign in to see the replies.'),
    el('label', { class: 'admin__label', for: 'admin-email' }, 'Email'),
    email,
    el('label', { class: 'admin__label', for: 'admin-password' }, 'Password'),
    password,
    error,
    submit,
    backLink(),
  );

  root.append(el('div', { class: 'admin__centre' }, form));
  email.focus();
}

/* -------------------------------------------------------------------------
   Data
   ------------------------------------------------------------------------- */

async function loadRows(): Promise<void> {
  state.loading = true;
  state.loadFailed = false;
  renderDashboard();

  /* Asked alongside the rows, not instead of them. A `false` here is the only
     thing that can tell an empty table apart from a revoked account — and the
     account being revoked is the likelier of the two, because deleting and
     recreating the admin user cascades the allowlist row away without a word. */
  const probe = await supabase.rpc('is_admin');
  if (probe.error && isAuthFailure(probe.error)) return handleExpiredSession();
  /* A missing function (an older database) is not a reason to block the view:
     fall back to the ambiguous-but-harmless "assume allowed" and let the empty
     state carry its softer hint. */
  state.isAdmin = probe.error ? null : Boolean(probe.data);

  const { data, error } = await supabase
    .from('rsvps')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    if (isAuthFailure(error)) return handleExpiredSession();
    state.loading = false;
    state.loadFailed = true;
    renderDashboard();
    toast('Could not load the replies. Check your connection and try again.', 'error');
    return;
  }

  state.rows = (data ?? []) as Rsvp[];
  state.loading = false;
  renderDashboard();
}

/**
 * Optimistic write. The change is on screen before the request leaves, and is
 * put back exactly as it was if the database refuses it — which it will, for
 * example, if an edited phone number stops matching the E.164 constraint.
 */
async function patch(
  id: string,
  changes: Partial<Rsvp>,
  /**
   * Whether to rebuild the whole dashboard.
   *
   * `false` for edits made inside an open row, and that is not an optimisation
   * — it is the difference between a usable editor and one that fights you. A
   * full rebuild destroys the very input whose `blur` triggered the save, which
   * (a) throws away focus mid-Tab, so the field you were moving to vanishes
   * from under the caret, and (b) can re-fire `blur` on the discarded node in
   * browsers that dispatch it on removal — re-entering this function
   * synchronously, forever. Only the counters and the row's summary line
   * actually depend on the change, so only those are rebuilt.
   */
  { rerender = true }: { rerender?: boolean } = {},
): Promise<boolean> {
  const index = state.rows.findIndex((r) => r.id === id);
  if (index === -1) return false;

  const before = state.rows[index];
  const after = { ...before, ...changes };

  /* party_size is generated by the database. Mirror it locally so the counters
     do not sit wrong until the next reload. */
  if (changes.companions) {
    after.party_size = 1 + changes.companions.length;
  }

  state.rows[index] = after;
  if (rerender) renderDashboard();
  else refreshInPlace();

  const { data, error } = await supabase
    .from('rsvps')
    .update(changes)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (isAuthFailure(error)) {
      await handleExpiredSession();
      return false;
    }
    state.rows[index] = before;
    renderDashboard();
    toast(`Could not save that change. ${error.message}`, 'error');
    return false;
  }

  /* Take the server's row: it carries the regenerated party_size and
     phone_normalised, which the duplicate marker reads. */
  state.rows[index] = data as Rsvp;
  if (rerender) renderDashboard();
  else refreshInPlace();
  return true;
}

/** An edit made inside an open row: save without tearing the editor down. */
const patchInRow = (id: string, changes: Partial<Rsvp>) =>
  patch(id, changes, { rerender: false });

/**
 * Rebuild only what the change can have altered: the counters, and every
 * summary line. Leaves every open editor — and the caret inside it — exactly
 * where it was.
 */
function refreshInPlace(): void {
  const stats = document.querySelector('.stats');
  if (stats) stats.replaceWith(renderStats());

  /* Every summary line, not only the row that was edited. The duplicate marker
     is derived from the whole set, so giving one reply the same number as
     another changes two rows — and rebuilding just the one being typed into
     left the other silently unmarked until the next full render, which is
     precisely when a human would have wanted to see it.
     Safe for focus: the open editor is a separate <tr class="row__expansion">
     and is not touched here. */
  const duplicates = duplicatePhones(state.rows);
  for (const row of state.rows) {
    const tr = document.querySelector(`tr[data-row-id="${CSS.escape(row.id)}"]`);
    if (tr) tr.replaceChildren(...summaryCells(row, duplicates));
  }
}

async function remove(row: Rsvp): Promise<void> {
  const index = state.rows.findIndex((r) => r.id === row.id);
  if (index === -1) return;

  const before = state.rows.slice();
  state.rows.splice(index, 1);
  renderDashboard();

  const { error } = await supabase.from('rsvps').delete().eq('id', row.id);

  if (error) {
    if (isAuthFailure(error)) return handleExpiredSession();
    state.rows = before;
    renderDashboard();
    toast(`Could not delete that entry. ${error.message}`, 'error');
    return;
  }

  toast(`Deleted the reply from ${row.first_name} ${row.last_name}.`);
}

/* -------------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------------- */

function visibleRows(): Rsvp[] {
  const q = state.query.trim().toLowerCase();
  /* Search over the digits too, so "6282" finds "+91 6282 …" however the
     number was typed. */
  const digits = q.replace(/\D/g, '');

  let rows = state.rows.filter((r) => {
    if (state.filter === 'coming' && !(r.attending_mass || r.attending_reception)) return false;
    if (state.filter === 'not-coming' && (r.attending_mass || r.attending_reception)) return false;
    if (state.filter === 'has-message' && !r.message?.trim()) return false;
    if (state.filter === 'flagged' && !r.flagged_spam) return false;

    if (!q) return true;
    return (
      r.first_name.toLowerCase().includes(q) ||
      r.last_name.toLowerCase().includes(q) ||
      `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
      (digits.length > 0 && (r.phone_normalised ?? '').includes(digits))
    );
  });

  rows = rows.slice().sort((a, b) =>
    state.sort === 'party'
      ? b.party_size - a.party_size ||
        +new Date(b.created_at) - +new Date(a.created_at)
      : +new Date(b.created_at) - +new Date(a.created_at),
  );

  return rows;
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const received = (iso: string) => dateFormat.format(new Date(iso));

/* -------------------------------------------------------------------------
   Rendering
   ------------------------------------------------------------------------- */

function statCard(value: number, label: string, hint?: string): HTMLElement {
  return el('div', { class: 'stat' },
    el('p', { class: 'stat__value' }, String(value)),
    el('p', { class: 'stat__label' }, label),
    hint ? el('p', { class: 'stat__hint' }, hint) : null,
  );
}

function renderStats(): HTMLElement {
  const s = computeStats(state.rows);
  return el('div', { class: 'stats' },
    statCard(s.massPeople, 'Coming to the Mass', 'people'),
    statCard(s.receptionPeople, 'Coming to the Reception', 'people'),
    statCard(s.notComingEntries, 'Not coming', 'replies'),
    statCard(s.totalPeople, 'Total people expected', 'at one or both'),
    statCard(s.children, 'Children', 'under 12'),
    statCard(s.todayEntries, 'Received today', 'replies'),
    /* Only when there is something to review. A permanent zero teaches the
       couple to stop seeing this tile, which is the one that matters. */
    s.flaggedEntries > 0
      ? statCard(s.flaggedEntries, 'Needs review', 'not counted above')
      : null,
  );
}

/** A labelled text input that writes back on blur, only if the value changed. */
function field(
  label: string,
  value: string | null,
  onCommit: (next: string) => void,
  opts: { type?: string; textarea?: boolean } = {},
): HTMLElement {
  const initial = value ?? '';
  const control = opts.textarea
    ? el('textarea', { class: 'admin__input admin__textarea', rows: 3 })
    : el('input', { class: 'admin__input', type: opts.type ?? 'text' });
  (control as HTMLInputElement).value = initial;

  /* Compared against the last value actually sent, not against the value the
     field was born with. A blur that follows a save is then a no-op, which is
     what stops a `blur` dispatched while this node is being torn down from
     saving the same edit a second time — and re-entering the render that tore
     it down. Repeat edits still save, because `saved` moves with them. */
  let saved = initial;
  control.addEventListener('blur', () => {
    const next = (control as HTMLInputElement).value;
    if (next === saved) return;
    saved = next;
    onCommit(next);
  });
  control.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Escape') {
      (control as HTMLInputElement).value = initial;
      (control as HTMLElement).blur();
    }
    if (key === 'Enter' && !opts.textarea) (control as HTMLElement).blur();
  });

  return el('label', { class: 'editor__field' },
    el('span', { class: 'editor__label' }, label),
    control,
  );
}

function toggle(label: string, checked: boolean, onChange: (next: boolean) => void): HTMLElement {
  const input = el('input', {
    type: 'checkbox',
    checked,
    onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
  });
  return el('label', { class: 'editor__toggle' }, input, el('span', {}, label));
}

function renderCompanions(row: Rsvp): HTMLElement {
  const list = row.companions ?? [];
  const drafts = state.drafts.get(row.id) ?? [];

  const editors = list.map((companion, i) =>
    el('div', { class: 'companion' },
      field('Name', companion.name, (next) => {
        const companions = list.slice();
        companions[i] = { ...companions[i], name: next.trim() };
        void patchInRow(row.id, { companions });
      }),
      el('label', { class: 'editor__field' },
        el('span', { class: 'editor__label' }, 'Age'),
        el('select', {
          class: 'admin__input',
          onchange: (event: Event) => {
            const companions = list.slice();
            companions[i] = {
              ...companions[i],
              type: (event.target as HTMLSelectElement).value as 'adult' | 'child',
            };
            void patchInRow(row.id, { companions });
          },
        },
          el('option', { value: 'adult', selected: companion.type === 'adult' }, 'Adult'),
          el('option', { value: 'child', selected: companion.type === 'child' }, 'Child (under 12)'),
        ),
      ),
      el('button', {
        class: 'admin__button admin__button--quiet',
        type: 'button',
        onclick: () => {
          /* Full re-render, unlike the field edits above: this removes one of
             the companion editors, so the panel's structure changes and the
             in-place refresh (counters + summary line only) would leave a
             stale editor on screen. */
          const companions = list.filter((_, j) => j !== i);
          void patch(row.id, { companions });
        },
      }, 'Remove'),
    ),
  );

  /* The unnamed rows. Identical to the editors above but for what naming one
     does: it is the blur that commits, because a companion is only writable
     once it has a name. See `state.drafts`. */
  const putDrafts = (next: Companion[]) => {
    if (next.length === 0) state.drafts.delete(row.id);
    else state.drafts.set(row.id, next);
  };
  /* Read back out of the state rather than closed over: the Age select below
     rewrites the drafts without re-rendering, so the array this function was
     built from is one edit out of date the moment it is used. Closing over it
     would silently drop a "child" chosen before the name was typed. */
  const liveDrafts = () => state.drafts.get(row.id) ?? [];

  const draftEditors = drafts.map((draft, i) =>
    el('div', { class: 'companion' },
      field('Name', draft.name, (next) => {
        const name = next.trim();
        /* Blurred still blank — off to the Age select, most likely. Nothing to
           save and nothing to say about it; the row stays put. */
        if (!name) return;
        const current = liveDrafts();
        const mine = current[i] ?? draft;
        putDrafts(current.filter((_, j) => j !== i));
        /* Full re-render, like Remove below: this row stops being a draft and
           becomes a real companion, so the panel's structure changes. */
        void patch(row.id, { companions: [...list, { ...mine, name }] });
      }),
      el('label', { class: 'editor__field' },
        el('span', { class: 'editor__label' }, 'Age'),
        el('select', {
          class: 'admin__input',
          onchange: (event: Event) => {
            const next = liveDrafts().slice();
            if (!next[i]) return;
            next[i] = {
              ...next[i],
              type: (event.target as HTMLSelectElement).value as 'adult' | 'child',
            };
            /* Into the draft and no further: there is nothing to write yet, and
               re-rendering would pull focus off the select just used. */
            putDrafts(next);
          },
        },
          el('option', { value: 'adult', selected: draft.type === 'adult' }, 'Adult'),
          el('option', { value: 'child', selected: draft.type === 'child' }, 'Child (under 12)'),
        ),
      ),
      el('button', {
        class: 'admin__button admin__button--quiet',
        type: 'button',
        onclick: () => { putDrafts(liveDrafts().filter((_, j) => j !== i)); renderDashboard(); },
      }, 'Remove'),
    ),
  );

  /* Counts the drafts too, or the twenty-first person is one the form offers to
     add and the database then refuses. */
  const total = list.length + drafts.length;

  return el('div', { class: 'editor__block' },
    el('h3', { class: 'editor__heading' }, `Coming with them (${list.length})`),
    total === 0 ? el('p', { class: 'editor__empty' }, 'Nobody — replying for themselves only.') : null,
    ...editors,
    ...draftEditors,
    /* Missing until now: the editor could rename, retype and remove a
       companion but not add one, so a guest who rang to say "actually my
       mother is coming too" could not be recorded without editing the
       database by hand. */
    el('button', {
      class: 'admin__button admin__button--quiet',
      type: 'button',
      hidden: total >= 20,
      onclick: () => { putDrafts([...drafts, { name: '', type: 'adult' }]); renderDashboard(); },
    }, 'Add another person'),
  );
}

function renderExpanded(row: Rsvp): HTMLElement {
  return el('div', { class: 'editor' },
    el('div', { class: 'editor__grid' },
      field('First name', row.first_name, (v) => void patchInRow(row.id, { first_name: v.trim() })),
      field('Last name', row.last_name, (v) => void patchInRow(row.id, { last_name: v.trim() })),
      /* `|| null`, like the two textareas below and unlike the names: the
         column is nullable but its CHECK still refuses a malformed non-null
         value, and `''` is malformed. Sending the empty string is how clearing
         a phone became "Could not save that change" instead of a blank. */
      field('Phone', row.phone, (v) => void patchInRow(row.id, { phone: v.trim() || null }), { type: 'tel' }),
    ),

    el('div', { class: 'editor__toggles' },
      toggle('Wedding Mass', row.attending_mass, (v) => void patchInRow(row.id, { attending_mass: v })),
      toggle('Reception', row.attending_reception, (v) => void patchInRow(row.id, { attending_reception: v })),
    ),

    renderCompanions(row),

    el('div', { class: 'editor__block' },
      field('Their message', row.message, (v) => void patchInRow(row.id, { message: v.trim() || null }), { textarea: true }),
    ),
    el('div', { class: 'editor__block' },
      field('Private note (not shown to anyone)', row.admin_note,
        (v) => void patchInRow(row.id, { admin_note: v.trim() || null }), { textarea: true }),
    ),

    /* One click, no confirmation. Clearing a false positive is the safe
       direction — it only ever adds a reply back into the counts — and putting
       a dialog in front of it would make the couple hesitate over the action we
       most want them to take. */
    row.flagged_spam
      ? el('div', { class: 'editor__block editor__flagged' },
          el('p', { class: 'editor__flagged-text' },
            'The spam check caught this reply, so it is not counted yet. ' +
            'That check has been wrong before — if this looks like a real guest, clear it.'),
          el('button', {
            class: 'admin__button',
            type: 'button',
            /* Full re-render, not the in-place one: clearing the flag deletes
               this whole block, and the in-place refresh touches only the
               counters and the summary line. Without it the totals correct
               themselves and the badge goes, while the panel still says the
               reply is not counted and still offers the button — so the couple
               press it again and wonder which of the two screens is lying. */
            onclick: () => void patch(row.id, { flagged_spam: false }),
          }, 'Not spam — count this reply'),
        )
      : null,

    el('div', { class: 'editor__danger' },
      el('button', {
        class: 'admin__button admin__button--danger',
        type: 'button',
        onclick: () => confirmDelete(row),
      }, 'Delete this reply'),
    ),
  );
}

function cell(label: string, ...children: (Node | string | null)[]): HTMLElement {
  /* data-label drives the stacked-card layout below 720px, where each cell
     grows its own heading instead of relying on a header row that is no
     longer beside it. */
  return el('td', { class: 'row__cell', 'data-label': label }, ...children);
}

/** The read-only summary line. Split out so it can be rebuilt on its own. */
function summaryCells(row: Rsvp, duplicates: Set<string>): HTMLElement[] {
  const isDuplicate = duplicates.has(row.phone_normalised ?? '');
  const open = state.expanded.has(row.id);

  const toggleButton = el('button', {
    class: 'row__toggle',
    type: 'button',
    'aria-expanded': String(open),
    onclick: () => {
      if (open) {
        state.expanded.delete(row.id);
        /* An unnamed companion row is not a change anybody made, so it does not
           survive the panel it was drawn in. */
        state.drafts.delete(row.id);
      } else state.expanded.add(row.id);
      renderDashboard();
    },
  }, `${row.first_name} ${row.last_name}`);

  const tick = el('input', {
    type: 'checkbox',
    class: 'row__tick',
    checked: state.selected.has(row.id),
    'aria-label': `Select ${row.first_name} ${row.last_name}`,
    onchange: (event: Event) => {
      const on = (event.target as HTMLInputElement).checked;
      if (on) state.selected.add(row.id);
      else state.selected.delete(row.id);
      /* Only the bulk bar and the header tick depend on this, so the table is
         left alone — re-rendering would move focus off the checkbox the couple
         just used and make ticking five rows in a row impossible by keyboard. */
      refreshSelectionUi();
    },
  });

  return [
    cell('Select', tick),
    cell('Name',
      toggleButton,
      isDuplicate
        ? el('span', {
            class: 'row__dupe',
            title: 'Same number as another entry',
            'aria-label': 'Same number as another entry',
          }, '●')
        : null,
      /* Only marked when it is NOT a web reply. The default case is the
         majority and needs no badge; what the couple want to spot is the row
         they typed in themselves, because that is the one with no audit trail
         behind it and the one they may need to check against a WhatsApp
         thread. */
      row.source && row.source !== 'web'
        ? el('span', { class: 'row__source' }, row.source)
        : null,
      /* Amber, and it says what to do rather than what happened. "Spam" would
         be the software asserting something it got wrong at least once; "needs
         review" is the truth — a human has not looked yet. */
      row.flagged_spam
        ? el('span', {
            class: 'row__flag',
            title: 'The spam check caught this. It is not counted until you clear it.',
          }, 'Needs review')
        : null,
    ),
    cell('Phone', el('span', { class: 'row__phone' }, row.phone)),
    cell('Party', String(row.party_size)),
    cell('Mass', row.attending_mass ? 'Yes' : 'No'),
    cell('Reception', row.attending_reception ? 'Yes' : 'No'),
    cell('With them', String((row.companions ?? []).length)),
    cell('Message', row.message?.trim() ? el('span', { class: 'row__has-message' }, 'Yes') : '—'),
    cell('Received', received(row.created_at)),
  ];
}

function renderRow(row: Rsvp, duplicates: Set<string>): HTMLElement[] {
  const open = state.expanded.has(row.id);

  const main = el('tr', {
    class: `row${open ? ' row--open' : ''}`,
    'data-row-id': row.id,
  }, ...summaryCells(row, duplicates));

  if (!open) return [main];

  return [
    main,
    el('tr', { class: 'row__expansion' },
      // 9, not 8: the tick column was added in front.
      el('td', { colspan: 9 }, renderExpanded(row)),
    ),
  ];
}

/**
 * Signed in, and the database says this account is not on the allowlist.
 *
 * A distinct screen rather than a footnote on the empty state, because the two
 * mean opposite things: one says "nobody has replied yet", the other says "you
 * cannot see the replies". Rendering the first when the second is true is how
 * somebody concludes the guest list has been lost.
 *
 * It names the actual cause, because the cause is not obvious and has bitten
 * this project three times: `private.admins.user_id` cascades on delete, so
 * deleting and recreating the admin account revokes access silently.
 */
function renderNotAllowlisted(email: string | undefined): HTMLElement {
  return el('div', { class: 'admin__empty admin__empty--denied' },
    el('p', { class: 'admin__empty-title' }, 'This account cannot see the guest list'),
    el('p', { class: 'admin__empty-body' },
      `You are signed in${email ? ` as ${email}` : ''}, but this account is not on ` +
      'the admin allowlist, so the database returns nothing. No replies have been ' +
      'lost — they are simply not visible to this account.'),
    el('p', { class: 'admin__empty-note' },
      'The usual cause is the admin account having been deleted and recreated: ' +
      'the allowlist entry is removed with it. Re-add this account from the ' +
      'Supabase SQL editor:'),
    el('pre', { class: 'admin__code' },
      "insert into private.admins (user_id, note)\nvalues ('" +
      (state.userId ?? '<your user id>') +
      "', 'admin');"),
  );
}

function renderEmpty(): HTMLElement {
  return el('div', { class: 'admin__empty' },
    el('p', { class: 'admin__empty-title' }, 'No entries yet'),
    el('p', { class: 'admin__empty-body' },
      'Replies will appear here as guests send them.'),
    /* Only reached when the allowlist probe says this account IS allowed, so
       this really is an empty guest list — the ambiguity that used to live in
       this message is now handled by renderNotAllowlisted above. */
  );
}

function renderToolbar(): HTMLElement {
  let debounce: ReturnType<typeof setTimeout>;

  const search = el('input', {
    class: 'admin__input toolbar__search',
    type: 'search',
    id: 'admin-search',
    placeholder: 'Name or phone number',
    value: state.query,
    oninput: (event: Event) => {
      const value = (event.target as HTMLInputElement).value;
      clearTimeout(debounce);
      /* 250ms, and entirely client-side over the rows already loaded. At the
         few hundred replies this list will ever hold, a round trip per
         keystroke would be slower and would fail offline. */
      debounce = setTimeout(() => {
        state.query = value;
        renderDashboard();
        document.getElementById('admin-search')?.focus();
      }, 250);
    },
  });

  const chip = (value: Filter, label: string) =>
    el('button', {
      class: `chip${state.filter === value ? ' chip--on' : ''}`,
      type: 'button',
      'aria-pressed': String(state.filter === value),
      onclick: () => { state.filter = value; renderDashboard(); },
    }, label);

  const sortSelect = el('select', {
    class: 'admin__input toolbar__sort',
    id: 'admin-sort',
    onchange: (event: Event) => {
      state.sort = (event.target as HTMLSelectElement).value as Sort;
      renderDashboard();
    },
  },
    el('option', { value: 'received', selected: state.sort === 'received' }, 'Newest first'),
    el('option', { value: 'party', selected: state.sort === 'party' }, 'Largest party first'),
  );

  return el('div', { class: 'toolbar' },
    el('div', { class: 'toolbar__row' },
      el('label', { class: 'admin__sr', for: 'admin-search' }, 'Search replies'),
      search,
      el('label', { class: 'admin__sr', for: 'admin-sort' }, 'Sort by'),
      sortSelect,
    ),
    el('div', { class: 'toolbar__chips', role: 'group', 'aria-label': 'Filter replies' },
      chip('all', 'All'),
      chip('coming', 'Coming'),
      chip('not-coming', 'Not coming'),
      chip('has-message', 'Has message'),
      chip('flagged', 'Flagged'),
    ),
  );
}

/**
 * The bulk action bar. Present only when something is ticked, so it never
 * occupies space above a table nobody has selected anything in.
 */
function renderBulkBar(): HTMLElement {
  const chosen = state.rows.filter((r) => state.selected.has(r.id));

  const bar = el('div', {
    class: 'bulk',
    id: 'bulk-bar',
    role: 'status',
    hidden: chosen.length === 0,
  },
    el('span', { class: 'bulk__count' },
      `${chosen.length} selected`),
    el('button', {
      class: 'admin__button admin__button--quiet bulk__clear',
      type: 'button',
      onclick: () => { state.selected.clear(); renderDashboard(); },
    }, 'Clear'),
    el('button', {
      class: 'admin__button admin__button--danger',
      type: 'button',
      onclick: () => confirmBulkDelete(chosen),
    }, 'Delete selected'),
  );

  return bar;
}

/** Updates the bar and the header tick without rebuilding the table. */
function refreshSelectionUi(): void {
  const bar = document.getElementById('bulk-bar');
  if (bar) bar.replaceWith(renderBulkBar());

  const rows = visibleRows();
  const all = document.getElementById('select-all') as HTMLInputElement | null;
  if (all) {
    const allTicked = rows.length > 0 && rows.every((r) => state.selected.has(r.id));
    all.checked = allTicked;
    all.indeterminate = rows.some((r) => state.selected.has(r.id)) && !allTicked;
  }
}

function renderDashboard(): void {
  const scroll = window.scrollY;
  clear(root);

  const header = el('header', { class: 'admin__header' },
    el('div', {},
      el('h1', { class: 'admin__title' }, 'Guest list'),
      el('p', { class: 'admin__lead' },
        state.loading ? 'Loading…' : `${state.rows.length} ${state.rows.length === 1 ? 'reply' : 'replies'}`),
    ),
    el('div', { class: 'admin__header-actions' },
      el('button', {
        class: 'admin__button admin__button--quiet',
        type: 'button',
        disabled: state.rows.length === 0,
        onclick: () => downloadCsv(visibleRows()),
      }, 'Download CSV'),
      el('button', {
        class: 'admin__button admin__button--quiet',
        type: 'button',
        onclick: () => openAddEntry(),
      }, 'Add entry'),
      el('button', {
        class: 'admin__button admin__button--quiet',
        type: 'button',
        onclick: () => void supabase.auth.signOut(),
      }, 'Sign out'),
      backLink(),
    ),
  );

  root.append(header);

  if (state.loading) {
    root.append(el('p', { class: 'admin__state', role: 'status' }, 'Loading replies…'));
    return;
  }

  if (state.loadFailed) {
    root.append(el('div', { class: 'admin__state' },
      el('p', {}, 'Could not load the replies.'),
      el('button', { class: 'admin__button', type: 'button', onclick: () => void loadRows() }, 'Try again'),
    ));
    return;
  }

  /* Checked before the counters: six zeroes above a "you have no access"
     message reads as a guest list that has been emptied, which is the exact
     misreading this screen exists to prevent. */
  if (state.isAdmin === false) {
    root.append(renderNotAllowlisted(state.email));
    return;
  }

  root.append(renderStats());

  if (state.rows.length === 0) {
    root.append(renderEmpty());
    return;
  }

  root.append(renderToolbar());
  root.append(renderBulkBar());

  const rows = visibleRows();
  const duplicates = duplicatePhones(state.rows);

  if (rows.length === 0) {
    root.append(el('p', { class: 'admin__state', role: 'status' },
      'No replies match that search.'));
    window.scrollTo({ top: scroll, behavior: 'instant' as ScrollBehavior });
    return;
  }

  /* Select-all applies to what is ON SCREEN, not to every loaded row. Ticking
     a box while a filter is active and silently selecting rows you cannot see
     is how somebody deletes forty replies meaning to delete four. */
  const allTicked = rows.length > 0 && rows.every((r) => state.selected.has(r.id));
  const someTicked = rows.some((r) => state.selected.has(r.id));

  const selectAll = el('input', {
    type: 'checkbox',
    id: 'select-all',
    class: 'row__tick',
    checked: allTicked,
    'aria-label': 'Select all shown replies',
    onchange: (event: Event) => {
      const on = (event.target as HTMLInputElement).checked;
      for (const r of rows) {
        if (on) state.selected.add(r.id);
        else state.selected.delete(r.id);
      }
      renderDashboard();
    },
  });
  // Neither on nor off: some of the shown rows are ticked.
  selectAll.indeterminate = someTicked && !allTicked;

  const head = el('tr', {},
    el('th', { scope: 'col', class: 'table__tick-col' }, selectAll),
    ...['Name', 'Phone', 'Party', 'Mass', 'Reception', 'With them', 'Message', 'Received']
      .map((h) => el('th', { scope: 'col' }, h)),
  );

  root.append(
    el('table', { class: 'table' },
      el('thead', {}, head),
      el('tbody', {}, ...rows.flatMap((row) => renderRow(row, duplicates))),
    ),
  );

  window.scrollTo({ top: scroll, behavior: 'instant' as ScrollBehavior });
}

/* -------------------------------------------------------------------------
   Delete, behind a typed confirmation
   ------------------------------------------------------------------------- */

/**
 * Bulk delete, behind the same typed confirmation as a single row.
 *
 * The word to type is the COUNT, not a fixed phrase: it forces the reader to
 * look at how many rows they are about to destroy, which is the one number
 * they can get wrong here. Deleting one reply by mistake is recoverable by
 * asking the guest again; deleting thirty is not.
 */
function confirmBulkDelete(rows: Rsvp[]): void {
  const expected = String(rows.length);

  const confirm = el('button', {
    class: 'admin__button admin__button--danger',
    type: 'button',
    disabled: true,
    onclick: () => { dialog.close(); void removeMany(rows); },
  }, `Delete ${rows.length} ${rows.length === 1 ? 'reply' : 'replies'}`);

  const input = el('input', {
    class: 'admin__input', id: 'confirm-count', autocomplete: 'off',
    inputmode: 'numeric',
    oninput: (event: Event) => {
      confirm.disabled = (event.target as HTMLInputElement).value.trim() !== expected;
    },
  });

  const dialog = el('dialog', { class: 'confirm' },
    el('h2', { class: 'confirm__title' },
      `Delete ${rows.length} ${rows.length === 1 ? 'reply' : 'replies'}?`),
    el('p', { class: 'confirm__body' },
      'This cannot be undone. There is no other copy of these replies.'),
    el('ul', { class: 'confirm__list' },
      ...rows.slice(0, 8).map((r) =>
        el('li', {}, `${r.first_name} ${r.last_name} — ${r.party_size} ${r.party_size === 1 ? 'person' : 'people'}`)),
      rows.length > 8 ? el('li', { class: 'confirm__more' }, `…and ${rows.length - 8} more`) : null,
    ),
    el('label', { class: 'editor__field', for: 'confirm-count' },
      el('span', { class: 'editor__label' }, `Type ${expected} to confirm`),
      input,
    ),
    el('div', { class: 'confirm__actions' },
      el('button', {
        class: 'admin__button admin__button--quiet', type: 'button',
        onclick: () => dialog.close(),
      }, 'Keep them'),
      confirm,
    ),
  );

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
}

async function removeMany(rows: Rsvp[]): Promise<void> {
  const ids = rows.map((r) => r.id);
  const before = state.rows.slice();

  state.rows = state.rows.filter((r) => !ids.includes(r.id));
  state.selected.clear();
  renderDashboard();

  const { error } = await supabase.from('rsvps').delete().in('id', ids);

  if (error) {
    if (isAuthFailure(error)) return handleExpiredSession();
    state.rows = before;
    renderDashboard();
    toast(`Could not delete those entries. ${error.message}`, 'error');
    return;
  }
  toast(`Deleted ${ids.length} ${ids.length === 1 ? 'reply' : 'replies'}.`);
}

function confirmDelete(row: Rsvp): void {
  const expected = `${row.first_name} ${row.last_name}`.trim().toLowerCase();

  const confirm = el('button', {
    class: 'admin__button admin__button--danger',
    type: 'button',
    disabled: true,
    onclick: () => { dialog.close(); void remove(row); },
  }, 'Delete permanently');

  const input = el('input', {
    class: 'admin__input',
    id: 'confirm-name',
    autocomplete: 'off',
    /* Typing the name, not clicking OK. This row is the only record that a
       person replied — there is no backup and no undo — and a confirmation
       that can be dismissed by reflex is not a confirmation. */
    oninput: (event: Event) => {
      const typed = (event.target as HTMLInputElement).value.trim().toLowerCase();
      confirm.disabled = typed !== expected;
    },
  });

  const dialog = el('dialog', { class: 'confirm' },
    el('h2', { class: 'confirm__title' }, 'Delete this reply?'),
    el('p', { class: 'confirm__body' },
      'This cannot be undone. There is no other copy of this reply.'),
    el('label', { class: 'editor__field', for: 'confirm-name' },
      el('span', { class: 'editor__label' }, `Type “${row.first_name} ${row.last_name}” to confirm`),
      input,
    ),
    el('div', { class: 'confirm__actions' },
      el('button', {
        class: 'admin__button admin__button--quiet',
        type: 'button',
        onclick: () => dialog.close(),
      }, 'Keep it'),
      confirm,
    ),
  );

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
}

/* -------------------------------------------------------------------------
   Add an entry by hand
   -------------------------------------------------------------------------
   Most replies will not arrive through the form. They will arrive as a phone
   call to a brother, or a WhatsApp message, or somebody saying it at church —
   and if there is no way to record those, the guest list is wrong and the
   couple keep a second one on paper.

   Written with `source: 'manual'` so a row they typed is always distinguishable
   from one a guest submitted, which matters when a number looks wrong later.
   ------------------------------------------------------------------------- */
function openAddEntry(): void {
  const field = (label: string, id: string, attrs: Record<string, unknown> = {}) => {
    const input = el('input', { class: 'admin__input', id, ...attrs });
    return { input, node: el('label', { class: 'editor__field', for: id },
      el('span', { class: 'editor__label' }, label), input) };
  };

  const first = field('First name', 'add-first', { autocomplete: 'off' });
  const last = field('Last name', 'add-last', { autocomplete: 'off' });
  const phone = field('Phone (optional)', 'add-phone', { type: 'tel', autocomplete: 'off' });

  let mass = false;
  let reception = false;
  let companions: { name: string; type: 'adult' | 'child' }[] = [];

  const error = el('p', { class: 'admin__error', role: 'alert' }, '');
  const people = el('div', {});

  /* Rebuilt in place rather than by re-opening the dialog, so focus and
     everything already typed survive adding a companion. */
  function drawPeople() {
    clear(people);
    companions.forEach((c, i) => {
      people.append(el('div', { class: 'companion' },
        el('label', { class: 'editor__field' },
          el('span', { class: 'editor__label' }, `Person ${i + 1}`),
          el('input', {
            class: 'admin__input', value: c.name, autocomplete: 'off',
            oninput: (e: Event) => { companions[i].name = (e.target as HTMLInputElement).value; },
          }),
        ),
        el('label', { class: 'editor__field' },
          el('span', { class: 'editor__label' }, 'Age'),
          el('select', {
            class: 'admin__input',
            onchange: (e: Event) => {
              companions[i].type = (e.target as HTMLSelectElement).value as 'adult' | 'child';
            },
          },
            el('option', { value: 'adult', selected: c.type === 'adult' }, 'Adult'),
            el('option', { value: 'child', selected: c.type === 'child' }, 'Child (under 12)'),
          ),
        ),
        el('button', {
          class: 'admin__button admin__button--quiet', type: 'button',
          onclick: () => { companions = companions.filter((_, j) => j !== i); drawPeople(); },
        }, 'Remove'),
      ));
    });
  }
  drawPeople();

  const save = el('button', { class: 'admin__button', type: 'submit' }, 'Add entry');

  const form = el('form', {
    class: 'add-form',
    novalidate: true,
    onsubmit: async (event: Event) => {
      event.preventDefault();
      if (save.disabled) return;

      const f = first.input.value.trim();
      const l = last.input.value.trim();
      const p = phone.input.value.trim();

      if (!f || !l) { error.textContent = 'Please give a first and last name.'; return; }
      /* Same rule as the public form and the database: blank is fine, wrong is
         not. Typed by hand here, so it is likelier to be wrong. */
      if (p && !/^\+[1-9][0-9]{7,14}$/.test(p.replace(/[\s()\-.]/g, ''))) {
        error.textContent = 'That phone number is not in international form, e.g. +919847012345.';
        return;
      }
      if (!mass && !reception && companions.length > 0) {
        error.textContent = 'Someone who is not coming cannot bring anyone.';
        return;
      }
      if (companions.some((c) => !c.name.trim())) {
        error.textContent = 'Please give everyone a name, or remove the empty row.';
        return;
      }

      save.disabled = true;
      save.textContent = 'Adding…';
      error.textContent = '';

      const { data, error: err } = await supabase.from('rsvps').insert({
        first_name: f,
        last_name: l,
        phone: p ? p.replace(/[\s()\-.]/g, '') : null,
        attending_mass: mass,
        attending_reception: reception,
        companions,
        source: 'manual',
      }).select().single();

      if (err) {
        if (isAuthFailure(err)) { dialog.close(); await handleExpiredSession(); return; }
        error.textContent = `Could not add that entry. ${err.message}`;
        save.disabled = false;
        save.textContent = 'Add entry';
        return;
      }

      state.rows.unshift(data as Rsvp);
      dialog.close();
      renderDashboard();
      toast(`Added ${f} ${l}.`);
    },
  },
    el('h2', { class: 'confirm__title' }, 'Add an entry'),
    el('p', { class: 'confirm__body' },
      'For a reply that came by phone, WhatsApp or in person. It will be marked “manual”.'),
    el('div', { class: 'editor__grid' }, first.node, last.node, phone.node),
    el('div', { class: 'editor__toggles' },
      toggle('Wedding Mass', false, (v) => { mass = v; }),
      toggle('Reception', false, (v) => { reception = v; }),
    ),
    el('div', { class: 'editor__block' },
      el('h3', { class: 'editor__heading' }, 'Coming with them'),
      people,
      el('button', {
        class: 'admin__button admin__button--quiet', type: 'button',
        onclick: () => { companions = [...companions, { name: '', type: 'adult' }]; drawPeople(); },
      }, 'Add another person'),
    ),
    error,
    el('div', { class: 'confirm__actions' },
      el('button', {
        class: 'admin__button admin__button--quiet', type: 'button',
        onclick: () => dialog.close(),
      }, 'Cancel'),
      save,
    ),
  );

  // <dialog> brings focus trapping and Escape from the platform.
  const dialog = el('dialog', { class: 'confirm confirm--wide' }, form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  first.input.focus();
}

/* -------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */

export async function start(mount: HTMLElement): Promise<void> {
  root = mount;

  /* Fires for the initial session, for sign-in, for sign-out, and when a
     refresh fails — which is the expired-session path. One listener drives the
     whole view so the two can never disagree about who is signed in. */
  /* Whether a session has ever been seen in this page's lifetime. Without it,
     the very first visit — which delivers INITIAL_SESSION with no session —
     greets a first-time visitor with "your session has expired", which is both
     false and alarming. */
  let hadSession = false;

  /* Whether the list has already been fetched for the session now in hand.
     Recovering a stored session delivers *both* `SIGNED_IN` and
     `INITIAL_SESSION` for that one session — in that order — so treating
     "either event" as the cue to load fetched everything twice on every
     visit: two `is_admin` probes and two full selects, for one page load.
     Latching it here rather than dropping `SIGNED_IN` from the condition,
     because `SIGNED_IN` is also the only cue a fresh sign-in gives. Cleared
     on the signed-out branch below, so signing back in still refetches. */
  let loaded = false;

  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      hadSession = true;
      state.userId = session.user?.id;
      state.email = session.user?.email;
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && !loaded) {
        loaded = true;
        void loadRows();
      }
      return;
    }
    loaded = false;
    state.rows = [];
    state.expanded.clear();
    /* Signing out deliberately is not an expiry, and neither is arriving
       signed out. Only a session that existed and then went away is. */
    const expired = hadSession && event !== 'SIGNED_OUT';
    hadSession = false;
    renderLogin(expired ? 'Your session has expired. Please sign in again.' : undefined);
  });

  /* onAuthStateChange delivers INITIAL_SESSION on its own, but only once the
     stored session has been read back — a tick or two after this runs. Paint
     something in the meantime rather than an empty page. */
  const { data } = await supabase.auth.getSession();
  if (!data.session) renderLogin();
}
