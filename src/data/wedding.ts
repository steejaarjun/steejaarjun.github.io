/**
 * Single source of truth for the day itself. Imported by Schedule.astro,
 * Venue.astro and the /wedding.ics endpoint — nothing about the date, the
 * times or the venues is written twice.
 */

/** Sunday. */
export const WEDDING_DATE = '2026-09-06';

/** India Standard Time, +05:30. India observes no daylight saving. */
export const TZ = 'Asia/Kolkata';

export type Coords = { lat: number; lng: number };

export type WeddingEvent = {
  id: string;
  title: string;
  /** 24-hour 'HH:mm', local to TZ. Never rendered in this form — see formatTime. */
  start: string;
  end: string;
  venue: string;
  area: string;
  mapsLink: string;
  /**
   * TODO: not yet supplied. While this is null the map falls back to a text
   * query on "venue, area", which Google resolves well for both of these.
   * Deliberately left empty rather than guessed — a wrong pin sends guests to
   * the wrong church.
   */
  coords: Coords | null;
  note: string;
};

export const EVENTS: readonly WeddingEvent[] = [
  {
    id: 'mass',
    title: 'Wedding Mass',
    start: '15:00',
    end: '17:00',
    venue: 'Ss. Gervasis & Prothasis Syro-Malabar Church',
    area: 'Akaparambu, Kerala, India',
    mapsLink: 'https://maps.app.goo.gl/qStCN1M2eFjjUjmz7',
    coords: null, // TODO: fill in { lat, lng }
    note: 'Please be seated by 2:40 PM.',
  },
  {
    id: 'reception',
    title: 'Wedding Reception',
    start: '18:00',
    end: '23:00',
    venue: 'One Kochi',
    area: 'Nedumbassery, Kerala, India',
    mapsLink:
      'https://www.google.com/maps/search/?api=1&query=One+Kochi%2C+Nedumbassery',
    coords: null, // TODO: fill in { lat, lng }
    note: 'Dinner and dancing. Parking is available right next to the venue.',
  },
];

/**
 * The zone's UTC offset on the wedding date, as '+05:30'. Read from the zone
 * rather than hard-coded, so the .ics stays correct if TZ is ever changed to a
 * zone that does observe daylight saving.
 */
export function utcOffset(timeZone: string = TZ, on: string = WEDDING_DATE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${on}T12:00:00Z`));
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  return name.replace('GMT', '') || '+00:00';
}

/** The absolute instant of an event boundary, independent of the build machine. */
export function instantOf(time: string): Date {
  return new Date(`${WEDDING_DATE}T${time}:00${utcOffset()}`);
}

/**
 * '15:00' -> '3:00 PM'. Every time on the page is written this way: it matches
 * the printed invitation, and a good share of the guest list will not thank us
 * for 24-hour clock arithmetic.
 */
export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** 'Sunday, 6 September 2026', derived rather than repeated. */
export const WEDDING_DATE_LABEL = (() => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', // the date string is a plain calendar date, not an instant
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(new Date(`${WEDDING_DATE}T00:00:00Z`));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')}`;
})();

/** What the map facade loads, and what "Copy address" puts on the clipboard. */
export function addressOf(event: WeddingEvent): string {
  return `${event.venue}, ${event.area}`;
}

export function mapEmbedSrc(event: WeddingEvent): string {
  const query = event.coords
    ? `${event.coords.lat},${event.coords.lng}`
    : encodeURIComponent(addressOf(event));
  return `https://www.google.com/maps?q=${query}&z=16&output=embed`;
}
