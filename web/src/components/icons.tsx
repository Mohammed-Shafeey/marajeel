import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number; flip?: boolean };

/** Minimal stroke icon set. `flip` marks direction-bearing icons that mirror in RTL. */
function I({ size = 22, flip, children, className, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${flip ? 'flip-rtl' : ''} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconCalendar = (p: P) => (<I {...p}><rect x="3" y="4.5" width="18" height="16" rx="1" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></I>);
export const IconUsers = (p: P) => (<I {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M16.5 14.5c2.6.2 4.4 2 5 4.5" /></I>);
export const IconTrophy = (p: P) => (<I {...p}><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M9.5 20h5M12 14v6" /></I>);
export const IconStar = (p: P) => (<I {...p}><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8L12 3Z" /></I>);
export const IconSliders = (p: P) => (<I {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></I>);
export const IconPlus = (p: P) => (<I {...p}><path d="M12 5v14M5 12h14" /></I>);
export const IconMinus = (p: P) => (<I {...p}><path d="M5 12h14" /></I>);
export const IconChevron = (p: P) => (<I flip {...p}><path d="m9 6 6 6-6 6" /></I>);
export const IconBack = (p: P) => (<I flip {...p}><path d="M15 6 9 12l6 6" /></I>);
export const IconShuffle = (p: P) => (<I {...p}><path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21M3 17h3.5c1.5 0 2.5-.6 3.3-1.6M14.2 8.6c.8-1 1.8-1.6 3.3-1.6H21M18 4l3 3-3 3M18 14l3 3-3 3" /></I>);
export const IconScale = (p: P) => (<I {...p}><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0L5 7ZM19 7l-3 7a3.5 3.5 0 0 0 6 0l-3-7Z" /></I>);
export const IconCheck = (p: P) => (<I {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></I>);
export const IconX = (p: P) => (<I {...p}><path d="M6 6l12 12M18 6 6 18" /></I>);
export const IconSync = (p: P) => (<I {...p}><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 13a8 8 0 0 0 14.5 4.5L20 16M4 4v4h4M20 20v-4h-4" /></I>);
export const IconTrash = (p: P) => (<I {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></I>);
export const IconEdit = (p: P) => (<I {...p}><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" /></I>);
export const IconCamera = (p: P) => (<I {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" /><circle cx="12" cy="13" r="3.5" /></I>);
export const IconLock = (p: P) => (<I {...p}><rect x="5" y="11" width="14" height="9" rx="1" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></I>);
export const IconSwap = (p: P) => (<I {...p}><path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" /></I>);
export const IconBall = (p: P) => (<I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 3c-1 4 0 7 3 9M3.5 9.5C7 9 10 10 12 12M12 12c-2 2-3 5-2.5 8.7M12 12c3.5 0 6.5 1.5 8.3 3.8M15 3.6C14 7 15 9.5 20 11.5" /></I>);
export const IconLink = (p: P) => (<I {...p}><path d="M9 7H6a5 5 0 0 0 0 10h3M15 7h3a5 5 0 0 1 0 10h-3M8 12h8" /></I>);
export const IconDownload = (p: P) => (<I {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></I>);
export const IconGrid = (p: P) => (<I {...p}><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 12h18M12 3v18" /></I>);
export const IconList = (p: P) => (<I {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></I>);
