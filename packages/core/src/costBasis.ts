// Cost-basis math for the Bitcoin tab. Aggregates the user's category='bitcoin'
// transactions (each carries amount_usd + the BTC/USD price frozen on its txn
// date) into the numbers the page shows: average buy price, totals, unrealized
// P/L, and the cumulative stack over time for chart hovers.

import type { TxnRow } from './domain'
import { SATS_PER_BTC } from './price'

export type CostBasis = {
  buyCount: number
  totalUsd: number
  totalSats: number
  totalBtc: number
  // null when there are no buys (avoid rendering a fake $0 basis)
  avgPriceUsd: number | null
  currentValueUsd: number
  unrealizedUsd: number
  unrealizedPct: number | null
  firstBuyIso: string | null
}

export type BuyPoint = {
  // Stable per-buy identity for React keys and chart/list selection. Nothing
  // derived from the buy's contents works here: two $5 buys on the same day are
  // ordinary, and a date-based key would make them the same buy.
  id: string
  t: number // ms epoch of txn_date
  usd: number
  priceUsd: number
  sats: number
  cumSats: number // running stack including this buy
  iso: string
  merchant: string | null
}

const isBuy = (t: TxnRow) => t.c === 'b' && t.u > 0

// Sats for one buy at its frozen price; unstamped rows (priceUsd null) fall
// back to the live price — same convention as usdToSatsAt in both apps.
const satsFor = (t: TxnRow, livePriceUsd: number): number => {
  const price = t.priceUsd && t.priceUsd > 0 ? t.priceUsd : livePriceUsd
  return price > 0 ? Math.round((t.u / price) * SATS_PER_BTC) : 0
}

export function computeCostBasis(txns: TxnRow[], livePriceUsd: number): CostBasis {
  let totalUsd = 0
  let totalSats = 0
  let buyCount = 0
  let firstBuyIso: string | null = null
  for (const t of txns) {
    if (!isBuy(t)) continue
    buyCount++
    totalUsd += t.u
    totalSats += satsFor(t, livePriceUsd)
    if (!firstBuyIso || t.iso < firstBuyIso) firstBuyIso = t.iso
  }
  const totalBtc = totalSats / SATS_PER_BTC
  // Every figure below the stack size is only knowable once we have one. Buys
  // with no resolvable price (no frozen btc_price_usd and a live price not yet
  // fetched) sum to zero sats, which used to report avgPriceUsd null alongside
  // a fully-fabricated -100% loss: currentValue 0 against the real totalUsd.
  // One guard for all of them, so the tab reads "not yet" rather than "wiped
  // out" while the price is still in flight.
  const known = totalBtc > 0
  const avgPriceUsd = known ? totalUsd / totalBtc : null
  const currentValueUsd = known ? totalBtc * livePriceUsd : 0
  const unrealizedUsd = known ? currentValueUsd - totalUsd : 0
  const unrealizedPct = known && totalUsd > 0 ? (unrealizedUsd / totalUsd) * 100 : null
  return {
    buyCount,
    totalUsd,
    totalSats,
    totalBtc,
    avgPriceUsd,
    currentValueUsd,
    unrealizedUsd,
    unrealizedPct,
    firstBuyIso,
  }
}

// Chart-ready buys, ascending by date with a running cumulative stack. Only
// rows with a frozen price are plottable (an unstamped row's dot would sit at
// today's price on a historical date), but every buy still counts toward the
// running stack so hover totals match the stats.
export function buildBuyPoints(txns: TxnRow[], livePriceUsd: number): BuyPoint[] {
  const buys = txns.filter(isBuy).slice()
  buys.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0))
  const out: BuyPoint[] = []
  let cum = 0
  for (const t of buys) {
    const sats = satsFor(t, livePriceUsd)
    cum += sats
    if (!(t.priceUsd && t.priceUsd > 0)) continue
    const ms = Date.parse(t.iso + 'T00:00:00Z')
    if (!Number.isFinite(ms)) continue
    out.push({
      id: t.id,
      t: ms,
      usd: t.u,
      priceUsd: t.priceUsd,
      sats,
      cumSats: cum,
      iso: t.iso,
      merchant: t.m || null,
    })
  }
  return out
}

// Stack size (sats) as of a moment — for the crosshair's "Your stack" rows.
// BuyPoints are ascending; linear scan is fine at personal-finance scale.
export function stackSatsAt(buys: BuyPoint[], tMs: number): number {
  let s = 0
  for (const b of buys) {
    if (b.t > tMs) break
    s = b.cumSats
  }
  return s
}
