import type { ReactNode } from "react";

const P: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  todo: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  library: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 17h16M8 3v14" />
    </>
  ),
  moon: <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.8 6.8 0 0 0 9.7 9.7z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  bookmark: <path d="M6.5 3.5h11v17L12 16.8l-5.5 3.7z" />,
  bookopen: (
    <>
      <path d="M2.5 5.5h6.5A3 3 0 0 1 12 8.5V21a2 2 0 0 0-2-2H2.5z" />
      <path d="M21.5 5.5H15a3 3 0 0 0-3 3V21a2 2 0 0 1 2-2h7.5z" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  sync: (
    <>
      <path d="M20 11a8 8 0 0 0-14.5-3.3M4 4.5v4h4" />
      <path d="M4 13a8 8 0 0 0 14.5 3.3M20 19.5v-4h-4" />
    </>
  ),
  download: <path d="M12 3.5v11M7 10l5 5 5-5M4.5 20.5h15" />,
  logout: <path d="M9 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2H9M15.5 17l5-5-5-5M20.5 12H9" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  sparkle: (
    <>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  back: <path d="m15 6-6 6 6 6" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />
    </>
  ),
  reset: <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  plusbox: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  dots: (
    <>
      <circle cx="12" cy="5.5" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="12" cy="18.5" r="1.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevdown: <path d="m6 9 6 6 6-6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  lines: <path d="M4 7h16M4 12h10M4 17h6" />,
  folder: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chart: <path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
};

export function Icon({ name, size = 22 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
