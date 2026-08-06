// Display metadata for the icon_key taxonomy, shared by web and desktop (and
// mirrored in the mobile app's src/lib/categories.ts — keep the three in step).
//
// A stable colour per icon_key, so a slice keeps its colour when the date range
// changes the ranking. Drawn from a seven-hue set validated for colour-blind
// separation (worst adjacent dE 34.7) against the white card surface, anchored
// on Bitcoin orange so the sat stack stays orange everywhere.
//
// Hues are grouped by meaning rather than assigned round-robin — getting around
// (rust), eating out (violet), keeping the lights on (teal), shelter & travel
// (blue), growing money (green), retail & fun (pink). Bitcoin orange is
// reserved; 'other' takes a neutral because a residual bucket shouldn't compete
// for a hue.

const HUE = {
  blue: '#2D6A9F',
  teal: '#00998A',
  orange: '#F7931A',
  violet: '#9B51E0',
  green: '#6E9418',
  pink: '#D4548A',
  rust: '#B35C1E',
  neutral: '#8C857A',
} as const

export const ICON_COLORS: Record<string, string> = {
  bitcoin: HUE.orange,
  other: HUE.neutral,
  'other-income': HUE.neutral,

  // getting around
  car: HUE.rust,
  fuel: HUE.rust,
  transport: HUE.teal,

  // screens & subscriptions
  software: HUE.violet,

  // eating & drinking out
  bar: HUE.violet,
  coffee: HUE.rust,
  dining: HUE.violet,
  fastfood: HUE.rust,
  games: HUE.violet,

  // keeping the lights on
  bills: HUE.teal,
  phone: HUE.blue,
  health: HUE.teal,
  pharmacy: HUE.teal,

  // shelter & travel
  home: HUE.blue,
  hotel: HUE.blue,
  travel: HUE.blue,

  // earning a living
  business: HUE.blue,
  freelance: HUE.blue,
  salary: HUE.green,

  // growing money
  investment: HUE.green,
  savings: HUE.green,
  refund: HUE.teal,

  // everything else you buy
  charity: HUE.pink,
  clothing: HUE.violet,
  education: HUE.blue,
  fitness: HUE.green,
  gift: HUE.pink,
  grocery: HUE.green,
  media: HUE.pink,
  pets: HUE.green,
  shopping: HUE.pink,

  // added 2026-08-01: obligations, vices and the everyday gaps
  cash: HUE.green,
  childcare: HUE.green,
  fees: HUE.pink,
  gambling: HUE.violet,
  'home-improvement': HUE.blue,
  insurance: HUE.teal,
  loan: HUE.violet,
  parking: HUE.rust,
  'personal-care': HUE.pink,
  taxes: HUE.blue,
  tobacco: HUE.rust,
}

export const iconColor = (key: string): string => ICON_COLORS[key] ?? HUE.neutral

// A 10% tint of a slice colour, for the round chip behind its glyph.
export const washFor = (color: string): string => `${color}1A`
