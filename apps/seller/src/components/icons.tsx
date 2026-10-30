import type { ReactNode, SVGProps } from 'react';

/**
 * Thin-line icons drawn for the seller portal (1.6 stroke, round caps), so
 * no icon font or package is needed. They are decorative: every one is
 * aria-hidden and the button or link around it carries the words.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPhone = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
    <path d="M10.5 18.5h3" />
  </Svg>
);

export const IconMail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.6" />
    <path d="m3.8 6.6 7.1 5.3a1.8 1.8 0 0 0 2.2 0l7.1-5.3" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Svg>
);

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.4 3.2" />
    <path d="M6.6 6.7C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 5-1.5" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m3 3 18 18" />
  </Svg>
);

export const IconPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.4" />
  </Svg>
);

export const IconScooter = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="17" r="2.5" />
    <circle cx="18" cy="17" r="2.5" />
    <path d="M8.5 17h6.2l2.3-6.5H20" />
    <path d="M14.5 6.5h2l1.4 4" />
    <path d="M3.5 13.5h7l1.5 3.5" />
  </Svg>
);

export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5h12A1.5 1.5 0 0 0 20 18V10a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 1 4 7Z" />
    <path d="M4 7a2.5 2.5 0 0 1 2.5-2.5H16v4" />
    <circle cx="16" cy="14" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconBox = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2L12 3Z" />
    <path d="m4 7.2 8 4.3 8-4.3" />
    <path d="M12 11.5V21" />
  </Svg>
);

export const IconReceipt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h12v18l-2.4-1.5L13.2 21 12 20.2 10.8 21l-2.4-1.5L6 21V3Z" />
    <path d="M9 8h6M9 11.5h6M9 15h3.5" />
  </Svg>
);

export const IconStore = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5V20h16V9.5" />
    <path d="M3 9.5 5 4h14l2 5.5a2.6 2.6 0 0 1-4.5 1.6 2.9 2.9 0 0 1-4.5 0 2.9 2.9 0 0 1-4.5 0A2.6 2.6 0 0 1 3 9.5Z" />
    <path d="M10 20v-5h4v5" />
  </Svg>
);

export const IconSignOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
    <path d="M10 12h10" />
    <path d="m16.5 8.5 3.5 3.5-3.5 3.5" />
  </Svg>
);

export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h2l1.5-2h6l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V8.5Z" />
    <circle cx="12" cy="13" r="3.6" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconCheckCircle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.2 12.3 2.6 2.6 5-5.4" />
  </Svg>
);

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5" />
    <circle cx="12" cy="16.2" r="0.6" fill="currentColor" />
  </Svg>
);

export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 9v6M14 9v6" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.4" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
);

export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);

export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.6" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20 4v4.5h-4.5" />
  </Svg>
);

export const IconTruck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 6.5h11v9.5h-11z" />
    <path d="M13.5 9.5h4l3 3.4V16h-7" />
    <circle cx="7" cy="17.5" r="1.9" />
    <circle cx="17" cy="17.5" r="1.9" />
  </Svg>
);

export const IconTrendUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 16 5.5-5.5 3.5 3.5L20 7" />
    <path d="M14.5 7H20v5.5" />
  </Svg>
);

export const IconTrendDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 8 5.5 5.5 3.5-3.5L20 17" />
    <path d="M14.5 17H20v-5.5" />
  </Svg>
);

export const IconMinus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const IconBank = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 9.5 12 4.5l8.5 5" />
    <path d="M5.5 10v7.5M10 10v7.5M14 10v7.5M18.5 10v7.5" />
    <path d="M3.5 20h17" />
  </Svg>
);

export const IconCash = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6.5" width="19" height="11" rx="2.4" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9.5v5M18 9.5v5" />
  </Svg>
);

export const IconSpark = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z" />
    <path d="M18.5 16.5v4M16.5 18.5h4" />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15L6 16.5Z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </Svg>
);

/** Shelves: the My stock tab. */
export const IconStock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.6" />
    <path d="M3.5 12h17M12 3.5V12M8 12v8.5M16 12v8.5" />
  </Svg>
);

/** A shopping bag: the Orders tab. */
export const IconBag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 8h14l-1 12H6L5 8Z" />
    <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </Svg>
);
