/**
 * Questions and answers.
 *
 * `answer` carries a little inline markup (links, emphasis) and is rendered
 * with `set:html`. That is safe here and only here: every string below is
 * authored by us and checked into the repo. Nothing from a form, a URL or a
 * guest ever reaches this field.
 */
export type FaqItem = {
  id: string;
  question: string;
  /** Trusted HTML — see the note above. */
  answer: string;
};

export const FAQ: readonly FaqItem[] = [
  {
    id: 'rsvp-by',
    question: 'When should we let you know?',
    answer:
      'Please reply by 20 August 2026. We kindly ask you to tell us whether you’ll be able to join us by then — it helps us plan seating and food.',
  },
  {
    id: 'what-to-wear',
    question: 'What should we wear?',
    // Links rather than repeating the palette: one place to change a colour.
    answer:
      'Ladies: gowns in shades of peach. Aunties and elder ladies: sarees in shades of peach. Gentlemen: beige suits. We kindly ask our female guests to avoid white and cream, as those are reserved for the bride. You’ll find the exact colours <a href="#dresscode">further up the page</a>.',
  },
  {
    id: 'parking',
    question: 'Where can we park?',
    answer:
      'Parking is available right next to the venue, so it’s easy to arrive by car.',
  },
  {
    id: 'arrival',
    question: 'What time should we arrive?',
    answer:
      'Please be seated in the church by 2:40 PM — the ceremony begins shortly after. Do allow time for parking and the short walk, so you can settle in calmly before the service starts.',
  },
  // "Can we take photos?" was removed on request. It was the only place the
  // church's no-phones-during-the-ceremony rule appeared, and that rule is now
  // stated nowhere on the site — not here, not in the Schedule, not in the
  // Venue section. Flagged when it was removed; restoring it means restoring
  // this entry or saying it somewhere else.

  // "Are children welcome?" was removed on request, and with it the last
  // sentence anywhere on the site that answered the question. Its companion,
  // "Can we bring someone with us?", had already gone the same way, and the
  // review note that used to stand here covered only those two.
  //
  // What remains is an implication rather than a statement: the reply form
  // still offers "Child under 12" beside each companion, so a guest who opens
  // it can infer that children may be brought, and the summary on the success
  // screen still prints "(child)" after a name. That was left in place
  // deliberately — see the note below — but it is an inference, and inferring
  // is not being told. A guest who reads only this page now has no answer.
  //
  // If the couple want children mentioned again, this entry is the place for
  // it. If they want the opposite — children not invited — the reply form is
  // the thing to change, and `src/data/dresscode.ts` still carries a
  // commented-out children's group that would want deleting with it.

  {
    id: 'help',
    question: 'Who can we ask if something is unclear?',
    answer:
      'Our brothers are happy to help with anything at all — you’ll find their numbers at the <a href="#contact">bottom of this page</a>.',
  },
];
