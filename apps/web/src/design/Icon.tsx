import type { SVGProps } from 'react';

/**
 * One consistent outline icon family (24px grid, 1.75 stroke). Directional icons are mirrored in RTL
 * by the `dir` attribute on the root via CSS (see `.icon--dir`); non-directional icons never flip.
 */
const paths: Record<string, string> = {
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15.5 8.5l-2 5-5 2 2-5 5-2z',
  heart: 'M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 6.1-8 11-8 11z',
  cart: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.3a1 1 0 0 0 1-.8L21 8H7 M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z M10 20a2 2 0 0 0 4 0',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  printer: 'M7 8V4h10v4 M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M7 14h10v6H7z',
  bluetooth: 'M7 7l10 10-5 4V3l5 4L7 17',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  logout: 'M10 4H5v16h5 M14 8l4 4-4 4 M18 12H9',
  store: 'M4 10l1-5h14l1 5 M4 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 4 0 M5 12v8h14v-8 M10 20v-5h4v5',
  utensils: 'M7 3v8a2 2 0 0 0 2 2v8 M5 3v6 M11 3v6 M17 3c-2 0-3 2-3 5v3h3v10',
  basket: 'M4 10h16l-1.5 9a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1L4 10z M8 10l3-6 M16 10l-3-6 M9 14v3 M15 14v3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  truck: 'M3 6h11v10H3z M14 10h4l3 3v3h-7 M6 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  bag: 'M6 8h12l1 12H5L6 8z M9 8V6a3 3 0 0 1 6 0v2',
  alert: 'M12 3l10 18H2L12 3z M12 10v4 M12 17.5v.5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8v.5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2 20a7 7 0 0 1 14 0 M16 4a3.5 3.5 0 0 1 0 7 M22 20a7 7 0 0 0-5-6.7',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.5 M3 12h.5 M3 18h.5',
  edit: 'M4 20h4l11-11-4-4L4 16v4z M13 7l4 4',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  copy: 'M9 9h11v11H9z M4 15V4h11',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  refresh: 'M4 12a8 8 0 0 1 14-5.3L20 9 M20 4v5h-5 M20 12a8 8 0 0 1-14 5.3L4 15 M4 20v-5h5',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18',
  volume: 'M4 10v4h4l5 4V6L8 10H4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11',
  volumeOff: 'M4 10v4h4l5 4V6L8 10H4z M16 10l4 4 M20 10l-4 4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  house: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9z',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z M3 7V5h13v2 M17 14h.5',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z',
  scale: 'M12 3v18 M5 21h14 M12 6l-6 8h12l-6-8z M6 14a3 3 0 0 0 6 0 M12 14a3 3 0 0 0 6 0',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
  wifiOff: 'M3 3l18 18 M8.5 16.5a5 5 0 0 1 7 0 M5 13a10 10 0 0 1 4-2.5 M12 20h.5 M19 13a10 10 0 0 0-8-3',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z M9 12l2 2 4-4',
  external: 'M14 4h6v6 M20 4l-9 9 M19 14v6H5V6h6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v2 M12 20v2 M4 12H2 M22 12h-2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5',
  more: 'M6 12h.5 M12 12h.5 M18 12h.5',
  tag: 'M3 12l9-9h9v9l-9 9-9-9z M15 8h.5',
  building: 'M4 21V5l8-2v18 M12 9h8v12 M8 8h.5 M8 12h.5 M8 16h.5 M16 13h.5 M16 17h.5',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, directional, ...rest }: { name: IconName; size?: number; directional?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest['aria-label'] ? undefined : true}
      focusable="false"
      className={directional ? 'icon icon--dir' : 'icon'}
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** Leaf mark in a rounded green shape — a real vector asset with a translated accessible label. */
export function BrandMark({ size = 32, label }: { size?: number; label: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={label}>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#20583B" />
      <path d="M9 23c0-8 5-13 14-13-1 8-5 13-13 13z" fill="#FFFEFA" />
      <path d="M10 22c3-4 6-7 10-9" stroke="#20583B" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}
