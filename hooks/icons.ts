// The icons for each type of item: thin line drawings in a quiet gray, like
// the app's own panels, drawn where a surface draws SVG (the desktop, VS
// Code, phones). The terminal has no SVG and gets a plain glyph instead.
import type { ItemType } from '../types'

// A gray that reads on dark and light alike, set as an attribute so it holds
// even where a surface drops the style; the media queries sharpen it where
// the surface tells the drawing which scheme it is in.
const GRAY = '#8c8c8c'
const STYLE =
  '<style>@media (prefers-color-scheme:dark){*{stroke:#a8a8a8}}@media (prefers-color-scheme:light){*{stroke:#6f6f6f}}</style>'

function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${GRAY}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${STYLE}${body}</svg>`
}

const DRAWINGS: Record<ItemType, string> = {
  // A circle with a question mark.
  question: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.2.9-1.2 1.7v.4"/><path d="M12 17h.01"/>',
  ),
  // A way that splits in two.
  decision: svg('<path d="M12 21v-7"/><path d="M12 14 6.5 8.5"/><path d="M12 14l5.5-5.5"/><path d="M6 12V8h4"/><path d="M18 12V8h-4"/>'),
  // A shield with a tick.
  approval: svg('<path d="M12 3 19 6v5c0 4.4-2.9 8-7 10-4.1-2-7-5.6-7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  // An eye.
  review: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  // A clipboard with lines.
  task: svg('<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M9 10h6"/><path d="M9 14h6"/><path d="M9 18h3"/>'),
  // A flask.
  test: svg('<path d="M9 3h6"/><path d="M10 3v6.5L5 18.3A1.8 1.8 0 0 0 6.6 21h10.8a1.8 1.8 0 0 0 1.6-2.7L14 9.5V3"/><path d="M7.4 15h9.2"/>'),
}

/** The drawing for a type of item, as SVG markup. */
export function iconSvg(type: ItemType): string {
  return DRAWINGS[type]
}

/** What stands for the icon where no SVG is drawn. */
export const ICON_GLYPH: Record<ItemType, string> = {
  question: '?',
  decision: '⑂',
  approval: '◇',
  review: '◎',
  task: '□',
  test: '△',
}
