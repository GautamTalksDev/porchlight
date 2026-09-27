/** Porchlight's line icons: 24px grid, 1.75 stroke, round joins. Decorative by default. */
import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
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

export const IconPhone = () => (
  <Icon>
    <path d="M5 4h3.2l1.6 4.2-2 1.3a11 11 0 0 0 6.7 6.7l1.3-2 4.2 1.6V19a1.6 1.6 0 0 1-1.7 1.6A16 16 0 0 1 3.4 5.7 1.6 1.6 0 0 1 5 4Z" />
  </Icon>
);
export const IconWalk = () => (
  <Icon>
    <circle cx="13" cy="4.5" r="1.8" />
    <path d="m9 21 2.2-6 2.8 2.4V21" />
    <path d="M7 11.5 10 8.5l3.6 1 2 3.2 2.4.8" />
    <path d="m11.2 15 1-5.6" />
  </Icon>
);
export const IconCheck = () => (
  <Icon>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const IconClose = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const IconMenu = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </Icon>
);
export const IconShield = () => (
  <Icon>
    <path d="M12 3.5 5 6v5.5c0 4.3 3 7.7 7 9 4-1.3 7-4.7 7-9V6l-7-2.5Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Icon>
);
export const IconBolt = () => (
  <Icon>
    <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />
  </Icon>
);
export const IconMove = () => (
  <Icon>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v4.4h-4.4" />
  </Icon>
);
export const IconEye = () => (
  <Icon>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
);
export const IconBulb = () => (
  <Icon>
    <path d="M9 17.5h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2v.5h5V16c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z" />
  </Icon>
);
export const IconSiren = () => (
  <Icon>
    <path d="M6 18v-5a6 6 0 0 1 12 0v5" />
    <path d="M4 21h16M12 2.5V4M4.2 6.2l1.1 1.1M19.8 6.2l-1.1 1.1" />
  </Icon>
);
export const IconUplink = () => (
  <Icon>
    <path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.6 3.8 3.8 0 0 1-.4 7.4" />
    <path d="M12 21v-8M9 15.5 12 12.5l3 3" />
  </Icon>
);
export const IconMegaphone = () => (
  <Icon>
    <path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z" />
    <path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
);
export const IconGauge = () => (
  <Icon>
    <path d="M4.5 17a8.5 8.5 0 1 1 15 0" />
    <path d="m12 13 3.5-4" />
    <circle cx="12" cy="13.2" r="1.2" />
  </Icon>
);
export const IconFeed = () => (
  <Icon>
    <path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8" />
    <circle cx="6" cy="18" r="1.3" />
  </Icon>
);
export const IconSound = ({ on }: { on: boolean }) => (
  <Icon>
    <path d="M4 10v4h3.5L12 18V6L7.5 10H4Z" />
    {on ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="m16 9.5 5 5M21 9.5l-5 5" />}
  </Icon>
);
export const IconFilm = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="m10 9.5 4.5 2.5-4.5 2.5v-5Z" />
  </Icon>
);
export const IconExit = () => (
  <Icon>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" />
  </Icon>
);
export const IconReset = () => (
  <Icon>
    <path d="M4 12a8 8 0 1 0 2.3-5.6" />
    <path d="M4 4v4.4h4.4" />
  </Icon>
);
export const IconReplay = () => (
  <Icon>
    <path d="M7 6.5 3.5 10 7 13.5" />
    <path d="M3.5 10H14a6 6 0 0 1 0 12h-3" />
  </Icon>
);
export const IconHome = () => (
  <Icon>
    <path d="M4 11 12 4l8 7v9H4v-9Z" />
    <path d="M10 20v-5h4v5" />
  </Icon>
);
export const IconInfo = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.2" />
  </Icon>
);
