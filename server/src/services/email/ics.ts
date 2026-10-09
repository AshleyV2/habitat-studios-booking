const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Minimal RFC 5545 event so customers can add their session to a calendar. */
export function bookingIcs(args: { uid: string; startsAt: Date; endsAt: Date; summary: string; location?: string | null; description: string }) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ApexBook//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${args.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(args.startsAt)}`,
    `DTEND:${stamp(args.endsAt)}`,
    `SUMMARY:${escape(args.summary)}`,
    ...(args.location ? [`LOCATION:${escape(args.location)}`] : []),
    `DESCRIPTION:${escape(args.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
