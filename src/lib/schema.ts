/**
 * The JSON-LD `Event` for the wedding.
 *
 * Derived from src/data/wedding.ts rather than written out again — the times
 * and the venues are already stated in three places (the Schedule, the Venues,
 * the .ics) and a fourth hand-typed copy is a fourth thing to forget when
 * something moves.
 *
 * Modelled as ONE Event with the Mass as the event proper and the Reception as
 * a `subEvent`. Two sibling top-level Events would be the other reading, but a
 * guest is invited to one wedding that happens to have two parts, and a search
 * result offering two competing entries for the same day misrepresents that.
 *
 * `eventAttendanceMode` is offline and `eventStatus` scheduled. Both are
 * defaults a human would assume, and both are exactly the kind of thing that
 * silently degrades a rich result when omitted.
 */
import {
  EVENTS,
  WEDDING_DATE,
  utcOffset,
  type WeddingEvent,
} from '../data/wedding';

/** '2026-09-06T15:00:00+05:30' — ISO 8601 with a real offset, as schema.org asks. */
function isoLocal(time: string): string {
  return `${WEDDING_DATE}T${time}:00${utcOffset()}`;
}

function place(event: WeddingEvent) {
  const [locality, region, country] = event.area.split(',').map((s) => s.trim());
  return {
    '@type': 'Place',
    name: event.venue,
    address: {
      '@type': 'PostalAddress',
      addressLocality: locality,
      addressRegion: region,
      addressCountry: country ?? 'India',
    },
    /* `hasMap` rather than `geo`: the coordinates in wedding.ts are
       deliberately null until the couple confirms them, and a guessed pin
       sends people to the wrong church. A map link is honest and useful. */
    hasMap: event.mapsLink,
  };
}

export function weddingEventSchema(imageUrl: string, pageUrl: string) {
  const [mass, reception] = EVENTS;

  const shared = {
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    organizer: { '@type': 'Person', name: 'Steeja & Arjun' },
    image: [imageUrl],
  };

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: 'The wedding of Steeja & Arjun',
    description:
      'Steeja and Arjun are getting married on Sunday, 6 September 2026 in Kerala.',
    startDate: isoLocal(mass.start),
    endDate: isoLocal(reception.end),
    url: pageUrl,
    location: place(mass),
    ...shared,
    subEvent: [
      {
        '@type': 'Event',
        name: mass.title,
        startDate: isoLocal(mass.start),
        endDate: isoLocal(mass.end),
        location: place(mass),
        ...shared,
      },
      {
        '@type': 'Event',
        name: reception.title,
        startDate: isoLocal(reception.start),
        endDate: isoLocal(reception.end),
        location: place(reception),
        ...shared,
      },
    ],
  };
}
