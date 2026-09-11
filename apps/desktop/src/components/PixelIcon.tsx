import type { ReactNode } from "react";

type PixelIconName = "star" | "clipboard" | "flag" | "person" | "puzzle" | "bell" | "pin" | "settings" | "palette" | "book" | "sprout";

const artwork: Record<PixelIconName, ReactNode> = {
  star: <path d="M10 1h4v6h3v3h6v4h-6v3h-3v6h-4v-6H7v-3H1v-4h6V7h3Z" fill="var(--gold)" />,
  clipboard: <><path d="M6 4H3v19h18V4h-3M8 4V1h8v3h2v4H6V4Z" fill="var(--paper-bright)" /><path d="M7 12h10M7 16h10M7 20h7" /></>,
  flag: <path d="M3 23V1h3v3h10v3h6v4h-6v4H6v8Z" fill="var(--rust)" />,
  person: <><path d="M8 7a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" fill="currentColor" stroke="none" /><path d="M4 23v-5c0-4 3-7 8-7s8 3 8 7v5Z" fill="currentColor" stroke="none" /></>,
  puzzle: <path d="M3 3h7v4a3 3 0 1 0 4 0V3h7v7h-4a3 3 0 1 0 0 4h4v7h-7v-4a3 3 0 1 0-4 0v4H3v-7h4a3 3 0 1 0 0-4H3Z" fill="currentColor" stroke="none" />,
  bell: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Z" fill="currentColor" stroke="none" /><path d="M9 20h6" /></>,
  pin: <path d="m8 2 11 3-3 3-1 6 2 3-6-1-5 6 1-8-3-2 4-2 2-5Z" fill="currentColor" stroke="none" />,
  settings: <><path d="M9 1h6v4h4v4h4v6h-4v4h-4v4H9v-4H5v-4H1V9h4V5h4Z" fill="var(--paper)" /><path d="M9 9h6v6H9Z" /></>,
  palette: <><path d="M9 2h7v3h4v4h2v7h-5v5H9v-3H5v-3H2V9h3V5h4Z" fill="var(--paper-bright)" /><path d="M9 7h3v3H9ZM14 5h3v3h-3ZM15 12h3v3h-3ZM9 15h3v3H9Z" fill="currentColor" stroke="none" /></>,
  book: <><path d="m12 5-4-3H1v17h7l4 3 4-3h7V2h-7Z" fill="var(--paper-bright)" /><path d="M12 5v17M4 7h4M4 11h4M16 7h4M16 11h4" /></>,
  sprout: <path d="M11 23V12H5V9H2V3h7v3h3v5h3V6h7v7h-3v3h-6v7Z" fill="var(--mint)" />,
};

export function PixelIcon({ name }: { readonly name: PixelIconName }) {
  return <svg className={`pixel-icon pixel-icon-${name}`} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">{artwork[name]}</svg>;
}
