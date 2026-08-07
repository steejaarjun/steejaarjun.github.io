# Launch

What is left before the link goes to guests, in the order to do it. Everything
here needs a person — none of it can be finished from the code.

Status at the time of writing: the site is deployed, the database is empty, and
nothing in the production bundle logs or carries test data. The blockers below
are content and credentials, not engineering.

---

## 1. Change the admin password — do this first

The current password was shared in plain text while the admin area was being
built, so treat it as public.

1. Supabase dashboard → Authentication → Users → `steejaarjun@wedding.com` →
   reset the password.
2. Update the saved entry in Chrome (`chrome://settings/passwords`), or delete
   it — a stale saved password is what made sign-in look broken once already.
3. Sign in at `/admin` once to confirm the new one works.

The dashboard is the **only** way to reset it. `steejaarjun@wedding.com` is an
identifier rather than a mailbox — nobody here controls `wedding.com` — so the
"forgot password" email goes somewhere unreadable. Keep the new password in a
password manager; there is no other copy and no way to mail one to yourself.

## 2. Bookmark `/admin`

There is no link to it from the site and no keyboard route into it. The way in
is three clicks on the monogram, or a bookmark. Make the bookmark — it is the
route the couple will actually use.

## 3. Supply the copy that is still missing

Three things, all in `src/data/`. The site renders correctly without them; it
just says less than it could.

| Where | What is needed |
| --- | --- |
| `src/data/wedding.ts:43` | Church coordinates, as `{ lat, lng }` |
| `src/data/wedding.ts:55` | Reception coordinates, as `{ lat, lng }` |
| `src/data/dresscode.ts:37–42` | A children's dress-code group, if the couple want one. Commented out rather than guessed. Uncomment and fill in `garment` and `palette`; the component handles a fourth entry with no other change. **But see the decision below first** — a dress code for children would be the site's only statement that children are coming. |

The row that used to sit here asked the couple to approve two FAQ answers we
had written rather than been given — "Are children welcome?" and "Can we bring
someone with us?". Both have since been removed on request, so there is nothing
left to approve and the row has gone with them.

**A decision that is now open.** Between them those two answers were the only
place the site said anything about who a guest may bring. Nothing states it
now. The reply form still offers "Child under 12" beside each companion, so a
guest who opens it can work out that children are allowed, but no page says so
— and a guest who reads the invitation without opening the form has no answer
at all. That is a defensible way to leave it, and it may well be what was
wanted; it just should not be discovered by a parent on the day. If children
are welcome, the FAQ is where to say it. If they are not, the reply form's
Adult/Child radios and the commented-out group above both want removing.

Coordinates are optional in the sense that nothing breaks: while they are
`null` the map falls back to a text search on venue and area, which Google
resolves correctly for both. They were left empty deliberately — a wrong pin
sends guests to the wrong church.

## 4. Check the two things that could not be tested here

Neither could be verified from this machine. Both are quick.

**On a real iPhone, in Safari — about six minutes**

1. `/` — does the hero fill the screen with no gap under the address bar, and
   no jump when the bar collapses on scroll?
2. Open the mobile menu. The page behind it must not scroll. Close it: the
   scroll position must be where you left it.
3. Open a photo in Moments. Same two checks.
4. Close the lightbox with the swipe-down gesture rather than the ✕.
5. `/rsvp` — tap First name, Phone and the message box. **If the page zooms in
   on any of them, that field's font-size is under 16px.**
6. `/rsvp` — rotate to landscape mid-form; nothing should overlap or clip.

**With a keyboard — about four minutes**

7. `/` — press Tab once from a fresh load. "Skip to content" must appear
   visibly and jump to the content on Enter.
8. Keep tabbing the top bar. Every stop needs a focus ring you can actually
   see.
9. Tab should skip the monogram entirely. It is a `<p>` by design.
10. Open the mobile menu by keyboard: focus must move into it, stay inside, and
    return to the button on Escape.
11. `/admin` — tick two rows with Space, tab to "Delete 2 replies", confirm the
    dialog puts focus in the type-to-confirm field and that Escape cancels.

## 5. Last look before sharing the link

- `/admin` shows "No entries yet" and the counters are all zero.
- Send one real reply from a phone, on mobile data rather than wifi, and check
  it appears in `/admin` with the right name and party size.
- Delete that reply through the typed-name confirmation.
- Then share the link.

---

## Open decisions, not blockers

Two things were measured and deliberately left alone. Neither stops a launch.

- **Hero image size on mobile.** Lighthouse reports 31 KiB of waste on the hero,
  but it measures the element box and does not model `object-fit: cover`. The
  1200w rung it fetches is the correct one for the 1152px the crop actually
  needs. Dropping to 960w saves 22 KiB and makes the hero visibly softer on tall
  phones. Left at 1200w.
- **LCP of 4.2s at 6× CPU throttling.** The largest element is the couple's
  names, held invisible by the `rise` reveal animation until it runs. That is
  the page's character and only shows up under heavy throttling. Left as is.
