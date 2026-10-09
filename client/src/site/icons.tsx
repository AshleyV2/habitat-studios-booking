import type { ReactNode } from 'react';

/*
 * Line icons (24×24, 1.75 stroke, round joins) for the website builder and for the icons
 * studios can put on feature cards. Drawn inline: no icon font, no external requests.
 */

const P = ({ d }: { d: string }) => <path d={d} />;

const ICONS: Record<string, ReactNode> = {
  // Editor actions
  back: <P d="M19 12H5M12 19l-7-7 7-7" />,
  up: <P d="M12 19V5M5 12l7-7 7 7" />,
  down: <P d="M12 5v14M19 12l-7 7-7-7" />,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><P d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  trash: <P d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" />,
  eye: <><P d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <P d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  grip: <>{[6, 12, 18].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor" />))}</>,
  plus: <P d="M12 5v14M5 12h14" />,
  close: <P d="M18 6L6 18M6 6l12 12" />,
  undo: <P d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4" />,
  redo: <P d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h4" />,
  desktop: <><rect x="2" y="4" width="20" height="13" rx="2" /><P d="M8 21h8M12 17v4" /></>,
  tablet: <><rect x="5" y="2" width="14" height="20" rx="2" /><P d="M11 18h2" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><P d="M11 18h2" /></>,
  external: <P d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  link: <P d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  listBullet: <P d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  listNumber: <P d="M10 6h11M10 12h11M10 18h11M4 4v4M3 18h3l-3 3h3M3 12h2.5a.5.5 0 0 1 0 1H4" />,
  quote: <P d="M4 18c2.5 0 5-1.5 5-6V6H4v6h4M15 18c2.5 0 5-1.5 5-6V6h-5v6h4" />,
  heading: <P d="M6 4v16M18 4v16M6 12h12" />,
  search: <><circle cx="11" cy="11" r="7" /><P d="M21 21l-4.3-4.3" /></>,
  // Section types
  hero: <><rect x="3" y="4" width="18" height="16" rx="2" /><P d="M7 10h10M7 14h6" /></>,
  text: <P d="M4 6h16M4 11h16M4 16h10" />,
  buttons: <><rect x="3" y="8" width="18" height="8" rx="4" /><P d="M9 12h6" /></>,
  spacer: <P d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" />,
  divider: <P d="M3 12h18" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><P d="M21 15l-5-5L5 21" /></>,
  imageText: <><rect x="3" y="5" width="8" height="14" rx="1.5" /><P d="M14 8h7M14 12h7M14 16h5" /></>,
  gallery: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>,
  video: <><rect x="2" y="5" width="20" height="14" rx="2" /><P d="M10 9l5 3-5 3z" /></>,
  logos: <><circle cx="6" cy="12" r="3" /><circle cx="18" cy="12" r="3" /><rect x="9.5" y="9" width="5" height="6" rx="1" /></>,
  features: <><rect x="3" y="5" width="5" height="14" rx="1" /><rect x="9.5" y="5" width="5" height="14" rx="1" /><rect x="16" y="5" width="5" height="14" rx="1" /></>,
  stats: <P d="M4 20V11M10 20V5M16 20v-7M2 20h20" />,
  testimonials: <P d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5" />,
  faq: <><circle cx="12" cy="12" r="9" /><P d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3M12 17h.01" /></>,
  cta: <P d="M5 12h14M13 5l7 7-7 7" />,
  rooms: <P d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  equipment: <><P d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  hours: <><circle cx="12" cy="12" r="9" /><P d="M12 7v5l3 2" /></>,
  contact: <><rect x="3" y="5" width="18" height="14" rx="2" /><P d="M3 7l9 6 9-6" /></>,
  map: <><P d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  // Extra icons for feature cards
  music: <><P d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  mic: <P d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v4M8 22h8" />,
  speaker: <><rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="14" r="4" /><P d="M12 6h.01" /></>,
  headphones: <P d="M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" />,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><P d="M16 2v4M8 2v4M3 10h18" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><P d="M12 7v5l3 2" /></>,
  star: <P d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />,
  check: <P d="M20 6L9 17l-5-5" />,
  users: <><circle cx="9" cy="8" r="4" /><P d="M2 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7" /></>,
  car: <P d="M5 17h14M5 17a2 2 0 1 1-4 0v-5l2-5a2 2 0 0 1 1.9-1.4h14.2A2 2 0 0 1 21 7l2 5v5a2 2 0 1 1-4 0M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M3 12h18" />,
  coffee: <P d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2" />,
  wifi: <P d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01" />,
  shield: <P d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" />,
  bolt: <P d="M13 2L3 14h9l-1 8 10-12h-9z" />,
  heart: <P d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className, label }: { name: string; size?: number; className?: string; label?: string }) {
  const body = ICONS[name];
  if (!body) return null;
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {body}
    </svg>
  );
}
