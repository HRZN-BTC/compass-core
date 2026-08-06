// Shareable spending-breakdown card — the image and the caption that ride
// together into a share sheet. Web and desktop both draw the PNG here; the
// mobile app mirrors the same layout in RN views (react-native-view-shot can't
// consume a canvas), so keep the two in step the way categories.ts already is.
//
// Everything renders client-side. No breakdown figure is ever posted to a
// server to be turned into an image — the whole point of the local-first pivot
// is that the user's spending never leaves the device unless they share it.

import { fmtFiat } from './currency'

const SATS_PER_BTC = 1e8

// Beyond eight rows the legend stops being readable at thumbnail size and the
// caption stops being a caption. The remainder collapses into one summary line
// in both, so the image and the text never disagree about what was shown.
const MAX_ROWS = 8

export type ShareDenom = 'sats' | 'btc'

export type ShareSlice = {
  /** Category code ('b' | 'n' | 'd' | 'f') or icon_key. Only used to spot Bitcoin. */
  code: string
  label: string
  usd: number
  sats: number
  color: string
}

export type ShareCardInput = {
  /** Calendar-concrete period: "July 2026", "Q3 2026", "Jul 27 – Aug 2", "2026". */
  periodLabel: string
  slices: ShareSlice[]
  totalUsd: number
  totalSats: number
  denom: ShareDenom
  /** Percentages instead of currency, for sharing the shape without the numbers. */
  hideAmounts: boolean
  /** What a slice is on the face being shared — "category" or "icon". */
  sliceNoun?: string
}

/** Where the caption points people. Kept bare — no tracking params on a shared link. */
export const SHARE_LINK = 'compassbtc.app'
export const SHARE_URL = `https://${SHARE_LINK}`

/** The passport's tagline, as the thing people can actually search and follow. */
export const SHARE_HASHTAG = '#YourFinancialLifeInBitcoin'

// The card is a fixed light-theme artifact regardless of anything the app is
// wearing, so a shared image always looks like the same product. Canvas can't
// read CSS custom properties anyway — these are compass.css's :root values.
const C = {
  paper: '#FAF8F5',
  card: '#FFFFFF',
  ink: '#1A1714',
  ink2: '#57534C',
  ink3: '#9C968C',
  hair: 'rgba(26,23,20,0.09)',
  sink: '#F2EFEA',
  btcInk: '#B96C08',
  btc: '#F7931A',
  neg: '#C2453A',
}

const SANS = '"Helvetica Neue","Helvetica","Arial",system-ui,-apple-system,sans-serif'

// Slice colours arrive straight off the donut, where Wasteful is a CSS var.
const VAR_HEX: Record<string, string> = {
  '--neg': C.neg,
  '--pos': '#1F8A5B',
  '--btc': '#F7931A',
  '--ink': C.ink,
  '--ink-2': C.ink2,
  '--ink-3': C.ink3,
}
function resolveColor(c: string): string {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(c || '')
  return m ? VAR_HEX[m[1]] || C.ink3 : c || C.ink3
}

const fmtSats = (sats: number) => Math.round(sats).toLocaleString('en-US')
const fmtBtc = (btc: number) => Number(btc).toFixed(4)

/** "0.0489 BTC" or "4,890,000 sats", matching the user's Sats-or-BTC preference. */
export function fmtDenomAmount(sats: number, denom: ShareDenom): string {
  return denom === 'btc' ? `${fmtBtc(sats / SATS_PER_BTC)} BTC` : `${fmtSats(sats)} sats`
}

/** Bitcoin reads as "stacked" in prose — it's the one slice that isn't spending. */
function captionLabel(s: ShareSlice): string {
  return s.code === 'b' ? 'Bitcoin stacked' : s.label
}

// Sub-half-percent slices round to 0%, which reads as "nothing" for a line item
// that is plainly on the chart — same rule the mobile legend already uses.
function pctText(usd: number, total: number): string {
  if (total <= 0) return '0%'
  const pct = (usd / total) * 100
  return pct > 0 && pct < 0.5 ? '<1%' : `${Math.round(pct)}%`
}

export function buildShareCaption(input: ShareCardInput): string {
  const { periodLabel, denom, hideAmounts, totalUsd } = input
  const slices = input.slices.filter((s) => s.usd > 0)
  // Same cap as the card's legend — a fifteen-line post doesn't get read, and
  // the two would look like different data if only one of them truncated.
  const rest = Math.max(slices.length - MAX_ROWS, 0)
  const lines = slices.slice(0, MAX_ROWS).map((s) =>
    hideAmounts
      ? `${captionLabel(s)}: ${pctText(s.usd, totalUsd)}`
      : `${captionLabel(s)}: ${fmtFiat(s.usd)} (${fmtDenomAmount(s.sats, denom)})`,
  )
  if (rest > 0) lines.push(`+ ${rest} more`)
  return [
    `My spending breakdown for ${periodLabel}`,
    '',
    ...lines,
    '',
    `See yours today at ${SHARE_LINK}`,
    '',
    SHARE_HASHTAG,
  ].join('\n')
}

export function shareFileName(periodLabel: string): string {
  const slug = periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `compass-breakdown-${slug || 'spending'}.png`
}

/* ── canvas drawing ───────────────────────────────────────────────────────── */

const W = 1080
const PAD = 84
const DONUT = 460
const RING = 46
const ROW_H = 96

function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  opts: { size: number; weight?: number; color?: string; align?: CanvasTextAlign; spacing?: number; italic?: boolean },
) {
  ctx.font = `${opts.italic ? 'italic ' : ''}${opts.weight ?? 400} ${opts.size}px ${SANS}`
  ctx.fillStyle = opts.color ?? C.ink
  ctx.textAlign = opts.align ?? 'left'
  ctx.textBaseline = 'alphabetic'
  // letterSpacing is Chrome/Safari-only; the fallback is simply no tracking,
  // which costs a little polish and nothing else.
  const anyCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if (opts.spacing != null) anyCtx.letterSpacing = `${opts.spacing}px`
  ctx.fillText(str, x, y)
  if (opts.spacing != null) anyCtx.letterSpacing = '0px'
}

// The true-north mark from public/icon-true-north-mark.svg, drawn on a 0-100
// grid centred at (cx, cy) and scaled to `size`. Same construction the Bitcoin
// tab's share card uses — the two cards should stamp an identical logo.
function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const k = size / 100
  const ox = cx - 50 * k
  const oy = cy - 50 * k
  const M = (x: number, y: number): [number, number] => [ox + x * k, oy + y * k]
  const poly = (pts: [number, number][], fill: string) => {
    ctx.beginPath()
    pts.forEach(([x, y], i) => {
      const [px, py] = M(x, y)
      if (i) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    })
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }
  const ring = (r: number, col: string, lw: number) => {
    const [rcx, rcy] = M(50, 50)
    ctx.beginPath()
    ctx.arc(rcx, rcy, r * k, 0, Math.PI * 2)
    ctx.strokeStyle = col
    ctx.lineWidth = lw * k
    ctx.stroke()
  }
  ring(43, '#C8C3BC', 1.4)
  ring(31, '#D5D1CB', 1)
  const [tx, ty] = M(50, 8.25)
  ctx.fillStyle = '#8A847C'
  ctx.fillRect(tx - 1.2 * k, ty - 3.25 * k, 2.4 * k, 6.5 * k)
  poly([[50, 16], [62, 50], [50, 50]], '#F7931A')
  poly([[50, 16], [38, 50], [50, 50]], '#D97D0C')
  poly([[50, 84], [62, 50], [50, 50]], '#1A1714')
  poly([[50, 84], [38, 50], [50, 50]], '#3A332D')
  const [pcx, pcy] = M(50, 50)
  ctx.beginPath()
  ctx.arc(pcx, pcy, 5.2 * k, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.strokeStyle = '#1A1714'
  ctx.lineWidth = 1.7 * k
  ctx.stroke()
}

function ellipsize(ctx: CanvasRenderingContext2D, str: string, max: number): string {
  if (ctx.measureText(str).width <= max) return str
  let s = str
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s}…`
}

/**
 * The card's pixel dimensions for a given slice count — the same numbers
 * renderShareCard draws at. Exported so a preview can reserve the right box
 * before the first blob exists, and hold it while a redraw is in flight;
 * otherwise the preview collapses to its placeholder and springs back on every
 * toggle. Height is the only thing that varies, and only with the row count —
 * showing percentages instead of amounts does not change it.
 */
export function shareCardSize(sliceCount: number): { width: number; height: number } {
  const shown = Math.min(sliceCount, MAX_ROWS)
  const rest = Math.max(sliceCount - MAX_ROWS, 0)
  const legendTop = PAD + 210 + DONUT + 56
  const legendH = shown * ROW_H + (rest > 0 ? 54 : 0)
  // 150 = the footer block (40 gap + rule + 46 to the baseline) plus enough
  // breathing room under it that the mark doesn't sit on the crop line.
  return { width: W, height: Math.round(legendTop + legendH + 150) }
}

/**
 * Draw the card and hand back a PNG. Browser-only (web + the desktop webview);
 * returns null anywhere there's no DOM rather than throwing, so a caller on the
 * server can fall back to the caption alone.
 */
export async function renderShareCard(input: ShareCardInput): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const { periodLabel, totalUsd, totalSats, denom, hideAmounts } = input
  const slices = input.slices.filter((s) => s.usd > 0)
  const shown = slices.slice(0, MAX_ROWS)
  const rest = slices.length - shown.length

  const legendTop = PAD + 210 + DONUT + 56
  const { height: H } = shareCardSize(slices.length)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2

  // ── header
  text(ctx, 'MY SPENDING BREAKDOWN', cx, PAD + 46, {
    size: 25, weight: 700, color: C.ink3, align: 'center', spacing: 3.2,
  })
  text(ctx, periodLabel, cx, PAD + 122, {
    size: 58, weight: 700, color: C.ink, align: 'center', spacing: -1.6,
  })

  // ── donut. Mirrors the in-app ring: one stroked arc per slice on a sink
  // track, 3° of paper between neighbours, starting at twelve o'clock.
  const dTop = PAD + 210
  const dcy = dTop + DONUT / 2
  const r = (DONUT - RING) / 2
  const circ = 2 * Math.PI * r
  const total = slices.reduce((a, s) => a + s.usd, 0) || 1
  const gap = (circ * 3) / 360

  ctx.lineWidth = RING
  ctx.lineCap = 'butt'
  ctx.strokeStyle = C.sink
  ctx.beginPath()
  ctx.arc(cx, dcy, r, 0, Math.PI * 2)
  ctx.stroke()

  let acc = 0
  for (const s of slices) {
    const frac = s.usd / total
    // A sliver still gets a visible tick rather than collapsing to nothing.
    const len = Math.max(circ * frac - gap, 2)
    const start = -Math.PI / 2 + acc * Math.PI * 2
    ctx.strokeStyle = resolveColor(s.color)
    ctx.beginPath()
    ctx.arc(cx, dcy, r, start, start + (len / circ) * Math.PI * 2)
    ctx.stroke()
    acc += frac
  }

  // ── donut centre
  text(ctx, periodLabel.toUpperCase(), cx, dcy - 44, {
    size: 24, weight: 700, color: C.ink3, align: 'center', spacing: 2.4,
  })
  if (hideAmounts) {
    // With the totals withheld the centre has nothing to report but the shape
    // itself, so it counts the slices instead of leaving a hole in the hole.
    const n = slices.length
    const noun = input.sliceNoun || 'category'
    text(ctx, String(n), cx, dcy + 34, { size: 76, weight: 700, color: C.ink, align: 'center', spacing: -2.5 })
    text(ctx, n === 1 ? noun : noun === 'category' ? 'categories' : `${noun}s`, cx, dcy + 78, {
      size: 27, weight: 700, color: C.btcInk, align: 'center',
    })
  } else {
    text(ctx, fmtFiat(totalUsd), cx, dcy + 26, {
      size: 72, weight: 700, color: C.ink, align: 'center', spacing: -2.5,
    })
    text(ctx, fmtDenomAmount(totalSats, denom), cx, dcy + 74, {
      size: 29, weight: 700, color: C.btcInk, align: 'center',
    })
  }

  // ── legend
  let y = legendTop
  for (const s of shown) {
    ctx.fillStyle = C.hair
    ctx.fillRect(PAD, y, W - PAD * 2, 1)

    const midY = y + ROW_H / 2
    ctx.fillStyle = resolveColor(s.color)
    ctx.beginPath()
    ctx.arc(PAD + 13, midY, 13, 0, Math.PI * 2)
    ctx.fill()

    if (hideAmounts) {
      const right = pctText(s.usd, total)
      ctx.font = `700 36px ${SANS}`
      const rightW = ctx.measureText(right).width
      ctx.font = `500 36px ${SANS}`
      const label = ellipsize(ctx, s.label, W - PAD * 2 - 46 - rightW - 40)
      text(ctx, label, PAD + 46, midY + 13, { size: 36, weight: 500, color: C.ink2 })
      text(ctx, right, W - PAD, midY + 13, { size: 36, weight: 700, color: C.ink, align: 'right' })
    } else {
      const fiat = fmtFiat(s.usd)
      const sub = fmtDenomAmount(s.sats, denom)
      ctx.font = `700 36px ${SANS}`
      const fiatW = ctx.measureText(fiat).width
      ctx.font = `600 26px ${SANS}`
      const subW = ctx.measureText(sub).width
      ctx.font = `500 36px ${SANS}`
      const label = ellipsize(ctx, s.label, W - PAD * 2 - 46 - Math.max(fiatW, subW) - 40)
      text(ctx, label, PAD + 46, midY + 4, { size: 36, weight: 500, color: C.ink2 })
      text(ctx, fiat, W - PAD, midY - 4, { size: 36, weight: 700, color: C.ink, align: 'right' })
      text(ctx, sub, W - PAD, midY + 32, { size: 26, weight: 600, color: C.btcInk, align: 'right' })
    }
    y += ROW_H
  }
  if (rest > 0) {
    ctx.fillStyle = C.hair
    ctx.fillRect(PAD, y, W - PAD * 2, 1)
    text(ctx, `+ ${rest} more`, PAD + 46, y + 38, { size: 30, weight: 500, color: C.ink3 })
    y += 54
  }

  // ── footer: mark + domain left, tagline right. Mirrors the Compass Passport's
  // footer so a shared breakdown and a shared passport read as one product.
  ctx.fillStyle = C.hair
  ctx.fillRect(PAD, y + 40, W - PAD * 2, 1)
  const fy = y + 40 + 46
  drawCompass(ctx, PAD + 22, fy, 44)
  text(ctx, 'www.compassbtc.app', PAD + 56, fy + 11, { size: 30, weight: 600, color: C.ink, spacing: -0.4 })

  const tagHead = 'Your Financial Life, in '
  const tagTail = 'Bitcoin'
  ctx.font = `italic 500 27px ${SANS}`
  const headW = ctx.measureText(tagHead).width
  ctx.font = `italic 700 27px ${SANS}`
  const tailW = ctx.measureText(tagTail).width
  const tagX = W - PAD - (headW + tailW)
  text(ctx, tagHead, tagX, fy + 10, { size: 27, weight: 500, color: C.ink3, italic: true })
  text(ctx, tagTail, tagX + headW, fy + 10, { size: 27, weight: 700, color: C.btc, italic: true })

  return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}
